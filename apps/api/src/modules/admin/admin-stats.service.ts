import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CONTENT_STATUSES, type AdminStatsDTO, type ContentStatus } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  alertMatches, analyticsEvents, attemptAnswers, attempts, competitionFacts, competitions, examSubjects, lessons, notifications, payments,
  phases, positions, questionReports, questions, subscriptions, syllabusNodes, users, waitlist,
} from '../../db/schema';

const FUNNEL_EVENTS = ['landing_view', 'diagnostic_start', 'diagnostic_done', 'signup', 'paywall_view', 'checkout_start', 'paid'] as const;
type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
const MIN_TOPIC_ANSWERS = 20;

export interface AdminStatsExtended extends AdminStatsDTO {
  /** Every funnel step over the last 30 days and where each number came from. */
  funnelDetail: { steps: Record<FunnelEvent, number>; source: Record<FunnelEvent, 'events' | 'tables' | 'none'> };
  content: AdminStatsDTO['content'] & { lessons: Record<ContentStatus, number>; editionsNeedingVerification: number };
  revenue: AdminStatsDTO['revenue'] & { pendingManualWithProof: number; paidLast30d: number };
  /** Reach of "a concours matches your profile" alerts. */
  alerts: { pendingEditions: number; matchesLast30d: number; notifiedLast30d: number; usersWithAlertsEnabled: number };
  generatedAt: string;
}

/** GET /admin/stats — one round of aggregate queries, each a single scan with FILTER clauses. */
@Injectable()
export class AdminStatsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async stats(): Promise<AdminStatsExtended> {
    const [u, premium, rev, qStatus, lStatus, facts, reports, funnel, weak, wl, alerts] = await Promise.all([
      this.one<{ total: number; registered: number; guests: number; active7d: number }>(sql`
        select count(*)::int as total,
               count(*) filter (where not ${users.isGuest})::int as registered,
               count(*) filter (where ${users.isGuest})::int as guests,
               count(*) filter (where ${users.lastActiveAt} > now() - interval '7 days')::int as active7d
        from ${users} where ${users.deletedAt} is null`),
      this.one<{ n: number }>(sql`
        select count(distinct ${subscriptions.userId})::int as n from ${subscriptions}
        join ${users} on ${users.id} = ${subscriptions.userId}
        where ${subscriptions.status} = 'ACTIVE' and ${subscriptions.endsAt} > now() and ${users.deletedAt} is null`),
      this.one<{ last30d: string | null; total: string | null; paid30d: number; pendingManual: number; pendingProof: number }>(sql`
        select sum(${payments.amountMillimes}) filter (where ${payments.status} = 'PAID' and ${payments.paidAt} > now() - interval '30 days') as last30d,
               sum(${payments.amountMillimes}) filter (where ${payments.status} = 'PAID') as total,
               count(*) filter (where ${payments.status} = 'PAID' and ${payments.paidAt} > now() - interval '30 days')::int as "paid30d",
               count(*) filter (where ${payments.status} = 'PENDING' and ${payments.provider} = 'MANUAL')::int as "pendingManual",
               count(*) filter (where ${payments.status} = 'PENDING' and ${payments.provider} = 'MANUAL' and ${payments.manualReference} is not null)::int as "pendingProof"
        from ${payments}`),
      this.rows<{ status: ContentStatus; n: number }>(sql`select ${questions.status} as status, count(*)::int as n from ${questions} group by 1`),
      this.rows<{ status: ContentStatus; n: number }>(sql`select ${lessons.status} as status, count(*)::int as n from ${lessons} group by 1`),
      this.one<{ eligibility: number; phases: number; subjects: number; facts: number; editions: number }>(sql`
        select
          (select count(*) from ${positions} where ${positions.eligibilityNeedsVerification} and ${positions.status} <> 'ARCHIVED')::int as eligibility,
          (select count(*) from ${phases} join ${positions} on ${positions.id} = ${phases.positionId} where ${phases.needsVerification} and ${positions.status} <> 'ARCHIVED')::int as phases,
          (select count(*) from ${examSubjects} join ${positions} on ${positions.id} = ${examSubjects.positionId} where ${examSubjects.needsVerification} and ${positions.status} <> 'ARCHIVED')::int as subjects,
          (select count(*) from ${competitionFacts} where ${competitionFacts.needsVerification} and ${competitionFacts.status} <> 'ARCHIVED')::int as facts,
          (select count(*) from ${competitions} where ${competitions.needsVerification} and ${competitions.contentStatus} <> 'ARCHIVED')::int as editions`),
      this.one<{ n: number }>(sql`select count(*)::int as n from ${questionReports} where ${questionReports.status} = 'OPEN'`),
      this.funnel(),
      this.rows<{ key: string; title_ar: string; title_fr: string; answers: number; wrong: number }>(sql`
        select ${syllabusNodes.key} as key, ${syllabusNodes.titleAr} as title_ar, ${syllabusNodes.titleFr} as title_fr,
               count(*)::int as answers, count(*) filter (where not ${attemptAnswers.isCorrect})::int as wrong
        from ${attemptAnswers}
        join ${questions} on ${questions.id} = ${attemptAnswers.questionId}
        join ${syllabusNodes} on ${syllabusNodes.id} = ${questions.topicId}
        group by ${syllabusNodes.id}
        having count(*) >= ${MIN_TOPIC_ANSWERS}
        order by (count(*) filter (where not ${attemptAnswers.isCorrect}))::float / count(*) desc, count(*) desc
        limit 10`),
      this.one<{ n: number }>(sql`select count(*)::int as n from ${waitlist}`),
      this.one<{ pending: number; matches: number; notified: number; enabled: number }>(sql`
        select
          (select count(*) from ${competitions} where ${competitions.contentStatus} = 'PUBLISHED' and ${competitions.status} in ('OPEN','ANNOUNCED')
             and ${competitions.alertsSentAt} is null and (${competitions.registrationDeadline} is null or ${competitions.registrationDeadline} >= ${tunisToday()}))::int as pending,
          (select count(*) from ${alertMatches} where ${alertMatches.createdAt} > now() - interval '30 days')::int as matches,
          (select count(*) from ${notifications} where ${notifications.type} = 'CONCOURS_MATCH' and ${notifications.createdAt} > now() - interval '30 days')::int as notified,
          (select count(*) from user_profiles p join ${users} on ${users.id} = p.user_id where p.alerts_enabled and ${users.deletedAt} is null)::int as enabled`),
    ]);

    const statusMap = (rows: { status: ContentStatus; n: number }[]) => {
      const out = Object.fromEntries(CONTENT_STATUSES.map((s) => [s, 0])) as Record<ContentStatus, number>;
      for (const r of rows) out[r.status] = Number(r.n);
      return out;
    };
    const factsTotal = Number(facts.eligibility) + Number(facts.phases) + Number(facts.subjects) + Number(facts.facts) + Number(facts.editions);

    return {
      users: { total: Number(u.total), registered: Number(u.registered), guests: Number(u.guests), active7d: Number(u.active7d), premium: Number(premium.n) },
      revenue: {
        last30dMillimes: Number(rev.last30d ?? 0), totalMillimes: Number(rev.total ?? 0), pendingManual: Number(rev.pendingManual),
        pendingManualWithProof: Number(rev.pendingProof), paidLast30d: Number(rev.paid30d),
      },
      content: {
        questions: statusMap(qStatus), lessons: statusMap(lStatus), factsNeedingVerification: factsTotal,
        editionsNeedingVerification: Number(facts.editions), openReports: Number(reports.n),
      },
      funnel: {
        visitors: funnel.steps.landing_view,
        diagnostic: funnel.steps.diagnostic_start,
        registered: funnel.steps.signup,
        paid: funnel.steps.paid,
      },
      funnelDetail: funnel,
      weakTopics: weak.map((w) => ({
        key: w.key, title_ar: w.title_ar, title_fr: w.title_fr, answers: Number(w.answers),
        errorRate: Math.round((Number(w.wrong) / Number(w.answers)) * 1000) / 1000,
      })),
      waitlist: Number(wl.n),
      alerts: { pendingEditions: Number(alerts.pending), matchesLast30d: Number(alerts.matches), notifiedLast30d: Number(alerts.notified), usersWithAlertsEnabled: Number(alerts.enabled) },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Funnel over the last 30 days from analytics_events (distinct people per step: user id, else the client's anonymous id).
   * A step with no events yet (tracking not wired, ad blockers) falls back to the equivalent table count.
   */
  private async funnel(): Promise<AdminStatsExtended['funnelDetail']> {
    const names = FUNNEL_EVENTS.map((n) => sql`${n}`);
    const rows = await this.rows<{ name: FunnelEvent; n: number }>(sql`
      select ${analyticsEvents.name} as name,
             count(distinct coalesce(${analyticsEvents.userId}::text, ${analyticsEvents.props}->>'anonId', ${analyticsEvents.props}->>'visitorId', ${analyticsEvents.id}::text))::int as n
      from ${analyticsEvents}
      where ${analyticsEvents.createdAt} > now() - interval '30 days' and ${analyticsEvents.name} in (${sql.join(names, sql`, `)})
      group by 1`);
    const fromEvents = new Map(rows.map((r) => [r.name, Number(r.n)]));
    const fb = await this.one<{ visitors: number; diag_start: number; diag_done: number; signups: number; checkout: number; paid: number }>(sql`
      select
        (select count(*) from ${users} where ${users.createdAt} > now() - interval '30 days')::int as visitors,
        (select count(distinct ${attempts.userId}) from ${attempts} where ${attempts.kind} = 'DIAGNOSTIC' and ${attempts.startedAt} > now() - interval '30 days')::int as diag_start,
        (select count(distinct ${attempts.userId}) from ${attempts} where ${attempts.kind} = 'DIAGNOSTIC' and ${attempts.submittedAt} > now() - interval '30 days')::int as diag_done,
        (select count(*) from ${users} where not ${users.isGuest} and ${users.createdAt} > now() - interval '30 days')::int as signups,
        (select count(distinct ${payments.userId}) from ${payments} where ${payments.createdAt} > now() - interval '30 days')::int as checkout,
        (select count(distinct ${payments.userId}) from ${payments} where ${payments.status} = 'PAID' and ${payments.paidAt} > now() - interval '30 days')::int as paid`);
    const fallback: Record<FunnelEvent, number | null> = {
      landing_view: fb.visitors, diagnostic_start: fb.diag_start, diagnostic_done: fb.diag_done, signup: fb.signups,
      paywall_view: null, checkout_start: fb.checkout, paid: fb.paid,
    };
    const steps = {} as Record<FunnelEvent, number>;
    const source = {} as Record<FunnelEvent, 'events' | 'tables' | 'none'>;
    for (const name of FUNNEL_EVENTS) {
      const ev = fromEvents.get(name) ?? 0;
      const tb = fallback[name];
      if (ev > 0) [steps[name], source[name]] = [ev, 'events'];
      else if (tb != null && Number(tb) > 0) [steps[name], source[name]] = [Number(tb), 'tables'];
      else [steps[name], source[name]] = [0, 'none'];
    }
    return { steps, source };
  }

  private async rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    const res = await this.db.execute(query);
    return res.rows as T[];
  }

  private async one<T>(query: ReturnType<typeof sql>): Promise<T> {
    return ((await this.rows<T>(query))[0] ?? {}) as T;
  }
}

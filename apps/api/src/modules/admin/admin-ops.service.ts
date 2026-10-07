import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { BroadcastInput, type UserRole } from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  alertMatches, attempts, auditLogs, competitionFamilies, enrollments, follows, notifications, payments, plans, questionReports, questions,
  subscriptions, syllabusNodes, userProfiles, userStats, users, waitlist,
} from '../../db/schema';
import { EntitlementsService } from '../billing/entitlements.service';
import { PaymentsService } from '../billing/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  assertUuid, badRequest, conflict, isSafeLink, likeAny, notFound, paging, type AuditQuery, type PaymentsQuery, type ReportPatchInput,
  type ReportsQuery, type UserPatchInput, type UsersQuery, type WaitlistQuery,
} from './admin.util';
import { peopleByIds } from './content-loaders';

export type BroadcastBody = z.infer<typeof BroadcastInput>;

const BROADCAST_BATCH = 1000;
const BROADCASTS_PER_HOUR = 10;
/** Audit entries editors may not read (money and accounts are ADMIN business). */
const ADMIN_ONLY_AUDIT = ['payment', 'subscription', 'user', 'notification', 'waitlist'];

/** Fixed-window limiter for expensive admin actions (one API instance; a speed bump, not a quota). */
class Limiter {
  private readonly hits = new Map<string, { n: number; resetAt: number }>();
  hit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const b = this.hits.get(key);
    if (!b || b.resetAt <= now) {
      this.hits.set(key, { n: 1, resetAt: now + windowMs });
      return true;
    }
    b.n++;
    return b.n <= limit;
  }
}

const activePremiumSql = (userCol: SQL | typeof users.id) =>
  sql`exists (select 1 from ${subscriptions} where ${subscriptions.userId} = ${userCol} and ${subscriptions.status} = 'ACTIVE' and ${subscriptions.endsAt} > now())`;

/** Support & operations: question reports, users, manual payments, broadcasts, waitlist and the audit trail. */
@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger('AdminOps');
  private readonly limiter = new Limiter();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly entitlements: EntitlementsService,
    private readonly payments: PaymentsService,
  ) {}

  // ───────────── Question reports ─────────────

  async reports(q: ReportsQuery) {
    const { page, pageSize, offset } = paging(q.page, q.pageSize, 50, 100);
    const where = and(
      q.status !== 'ALL' ? eq(questionReports.status, q.status) : undefined,
      q.questionId ? eq(questionReports.questionId, q.questionId) : undefined,
    );
    const [rows, [{ total }], byReason] = await Promise.all([
      this.db
        .select({
          r: questionReports,
          q: { id: questions.id, stem: questions.stem, status: questions.status, type: questions.type, domain: questions.domain, version: questions.version },
          topicKey: syllabusNodes.key,
          reporterName: users.name,
          openForQuestion: sql<number>`(select count(*)::int from ${questionReports} r2 where r2.question_id = ${questionReports.questionId} and r2.status = 'OPEN')`,
        })
        .from(questionReports)
        .innerJoin(questions, eq(questions.id, questionReports.questionId))
        .innerJoin(syllabusNodes, eq(syllabusNodes.id, questions.topicId))
        .leftJoin(users, eq(users.id, questionReports.userId))
        .where(where)
        .orderBy(desc(questionReports.createdAt), asc(questionReports.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(questionReports).where(where),
      this.db.select({ reason: questionReports.reason, n: sql<number>`count(*)::int` }).from(questionReports).where(where).groupBy(questionReports.reason),
    ]);
    return {
      items: rows.map(({ r, q: qq, ...x }) => ({
        id: r.id, reason: r.reason, comment: r.comment, status: r.status, createdAt: r.createdAt.toISOString(),
        // Reporter's display name only: staff fix content, they do not need the reporter's contact details here.
        reporter: r.userId ? { id: r.userId, name: x.reporterName ?? null } : null,
        question: { ...qq, topicKey: x.topicKey, openReports: Number(x.openForQuestion) },
      })),
      total: Number(total),
      page,
      pageSize,
      byReason: Object.fromEntries(byReason.map((b) => [b.reason, Number(b.n)])),
    };
  }

  async updateReport(id: string, input: ReportPatchInput, actorId: string): Promise<{ updated: number; notified: number }> {
    assertUuid(id);
    const [report] = await this.db.select().from(questionReports).where(eq(questionReports.id, id)).limit(1);
    if (!report) throw notFound();
    const targets = input.applyToQuestion
      ? await this.db.select().from(questionReports).where(and(eq(questionReports.questionId, report.questionId), or(eq(questionReports.id, id), eq(questionReports.status, 'OPEN'))))
      : [report];
    const changed = targets.filter((t) => t.status !== input.status);
    if (!changed.length) return { updated: 0, notified: 0 };

    await this.db.update(questionReports).set({ status: input.status }).where(inArray(questionReports.id, changed.map((t) => t.id)));
    for (const t of changed) await this.audit.review('report', t.id, t.status, input.status, actorId);
    await this.audit.log(actorId, 'report.update', 'report', id, { status: input.status, questionId: report.questionId, ids: changed.map((t) => t.id) });

    let notified = 0;
    if (input.status === 'RESOLVED' && input.notifyReporter !== false) {
      notified = await this.thankReporters(changed.filter((t) => t.userId).map((t) => ({ reportId: t.id, userId: t.userId!, questionId: t.questionId })));
    }
    return { updated: changed.length, notified };
  }

  /** Closing the loop keeps people reporting errors: "the question you reported was fixed". */
  private async thankReporters(list: { reportId: string; userId: string; questionId: string }[]): Promise<number> {
    if (!list.length) return 0;
    const locales = await this.db.select({ id: users.id, locale: users.locale }).from(users).where(and(inArray(users.id, list.map((l) => l.userId)), isNull(users.deletedAt)));
    const localeOf = new Map(locales.map((u) => [u.id, u.locale === 'fr' ? 'fr' : 'ar']));
    let sent = 0;
    for (const item of list) {
      const locale = localeOf.get(item.userId);
      if (!locale) continue;
      try {
        const id = await this.notifications.notify(item.userId, {
          type: 'SYSTEM',
          ...(locale === 'fr'
            ? { title: 'Merci pour votre signalement', body: 'La question que vous avez signalée a été vérifiée et corrigée. Votre aide améliore la préparation de tous.' }
            : { title: 'شكراً على تبليغك', body: 'تمّت مراجعة السؤال الذي أبلغت عنه وتصحيحه. مساهمتك تحسّن جودة التحضير للجميع.' }),
          url: null,
          channels: ['IN_APP', 'PUSH'],
          dedupeKey: `report:${item.reportId}`,
          data: { questionId: item.questionId, reportId: item.reportId },
        });
        if (id) sent++;
      } catch (e) {
        this.logger.warn(`report thanks to ${item.userId} failed: ${(e as Error).message}`);
      }
    }
    return sent;
  }

  // ───────────── Users ─────────────

  async users(q: UsersQuery) {
    const { page, pageSize, offset } = paging(q.page, q.pageSize, 50, 100);
    const pattern = likeAny(q.q);
    const exact = q.q?.trim();
    const where = and(
      isNull(users.deletedAt),
      q.includeGuests ? undefined : eq(users.isGuest, false),
      q.role ? eq(users.role, q.role) : undefined,
      q.premium === true ? activePremiumSql(users.id) : q.premium === false ? sql`not ${activePremiumSql(users.id)}` : undefined,
      pattern
        ? or(ilike(users.email, pattern), ilike(users.name, pattern), ilike(users.phone, pattern), sql`upper(${users.referralCode}) = upper(${exact})`, sql`${users.id}::text = ${exact}`)
        : undefined,
    );
    const premium = sql<{ planCode: string; endsAt: string } | null>`(
      select json_build_object('planCode', ${plans.code}, 'endsAt', ${subscriptions.endsAt})
      from ${subscriptions} join ${plans} on ${plans.id} = ${subscriptions.planId}
      where ${subscriptions.userId} = ${users.id} and ${subscriptions.status} = 'ACTIVE' and ${subscriptions.endsAt} > now()
      order by ${subscriptions.endsAt} desc limit 1)`;
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          u: { id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, isGuest: users.isGuest, locale: users.locale, createdAt: users.createdAt, lastActiveAt: users.lastActiveAt, emailVerifiedAt: users.emailVerifiedAt },
          premium,
          xp: userStats.xpTotal, streak: userStats.streakCurrent, answered: userStats.questionsAnswered,
        })
        .from(users)
        .leftJoin(userStats, eq(userStats.userId, users.id))
        .where(where)
        .orderBy(desc(users.createdAt), asc(users.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
    ]);
    return {
      items: rows.map((r) => this.userDto(r.u, r.premium, { xp: r.xp ?? 0, streak: r.streak ?? 0, answered: r.answered ?? 0 })),
      total: Number(total),
      page,
      pageSize,
    };
  }

  /** Support view of one account: why did (not) this person get an alert, what did they pay, what are they preparing. */
  async user(id: string) {
    assertUuid(id);
    const [u] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw notFound();
    const [[profile], [stats], ent, enr, fol, pays, [att], [alerts], [notif]] = await Promise.all([
      this.db.select().from(userProfiles).where(eq(userProfiles.userId, id)).limit(1),
      this.db.select().from(userStats).where(eq(userStats.userId, id)).limit(1),
      this.entitlements.get(id),
      this.db.select({ familySlug: competitionFamilies.slug, isPrimary: enrollments.isPrimary, targetExamDate: enrollments.targetExamDate, createdAt: enrollments.createdAt })
        .from(enrollments).innerJoin(competitionFamilies, eq(competitionFamilies.id, enrollments.familyId)).where(eq(enrollments.userId, id)),
      this.db.select({ familySlug: competitionFamilies.slug }).from(follows).innerJoin(competitionFamilies, eq(competitionFamilies.id, follows.familyId)).where(eq(follows.userId, id)),
      this.db.select({ p: payments, planCode: plans.code }).from(payments).innerJoin(plans, eq(plans.id, payments.planId)).where(eq(payments.userId, id)).orderBy(desc(payments.createdAt)).limit(20),
      this.db.select({ total: count(), submitted: sql<number>`count(*) filter (where ${attempts.submittedAt} is not null)::int` }).from(attempts).where(eq(attempts.userId, id)),
      this.db.select({ n: count(), last: sql<Date | null>`max(${alertMatches.createdAt})` }).from(alertMatches).where(eq(alertMatches.userId, id)),
      this.db.select({ n: count(), unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)::int` }).from(notifications).where(eq(notifications.userId, id)),
    ]);
    return {
      ...this.userDto(u, ent.premium ? { planCode: ent.planCode ?? '', endsAt: ent.endsAt ?? '' } : null, { xp: stats?.xpTotal ?? 0, streak: stats?.streakCurrent ?? 0, answered: stats?.questionsAnswered ?? 0 }),
      deletedAt: u.deletedAt?.toISOString() ?? null,
      referralCode: u.referralCode,
      profile: profile ? {
        diplomaLevel: profile.diplomaLevel, specialties: profile.specialties, governorate: profile.governorate, gender: profile.gender,
        hasBirthDate: !!profile.birthDate, alertsEnabled: profile.alertsEnabled, alertFields: profile.alertFields, alertChannels: profile.alertChannels,
        dailyReminderHour: profile.dailyReminderHour,
      } : null,
      enrollments: enr.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      follows: fol.map((f) => f.familySlug),
      payments: pays.map(({ p, planCode }) => ({ id: p.id, planCode, amountMillimes: p.amountMillimes, provider: p.provider, status: p.status, manualReference: p.manualReference, createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null })),
      activity: { attempts: Number(att?.total ?? 0), submittedAttempts: Number(att?.submitted ?? 0) },
      alerts: { matches: Number(alerts?.n ?? 0), lastMatchAt: alerts?.last ? new Date(alerts.last).toISOString() : null },
      notifications: { total: Number(notif?.n ?? 0), unread: Number(notif?.unread ?? 0) },
    };
  }

  async updateUser(id: string, input: UserPatchInput, actorId: string) {
    assertUuid(id);
    const [u] = await this.db.select({ id: users.id, role: users.role, isGuest: users.isGuest, deletedAt: users.deletedAt, locale: users.locale }).from(users).where(eq(users.id, id)).limit(1);
    if (!u || u.deletedAt) throw notFound();
    if (u.isGuest) throw badRequest('GUEST_ACCOUNT');

    if (input.role !== undefined && input.role !== u.role) {
      // Locking yourself out (or leaving the platform without an admin) is never what was meant.
      if (id === actorId) throw badRequest('CANNOT_CHANGE_OWN_ROLE');
      if (u.role === 'ADMIN') {
        const [{ admins }] = await this.db.select({ admins: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, 'ADMIN'), isNull(users.deletedAt), ne(users.id, id)));
        if (Number(admins) === 0) throw conflict('LAST_ADMIN');
      }
      await this.db.update(users).set({ role: input.role }).where(eq(users.id, id));
      await this.audit.log(actorId, 'user.role', 'user', id, { from: u.role, to: input.role satisfies UserRole });
    }

    let granted: { days: number; planCode: string; endsAt: string | null } | null = null;
    if (input.grantDays !== undefined) {
      const planCode = input.planCode ?? 'PREMIUM_MONTH';
      await this.entitlements.grantDays(id, input.grantDays, 'ADMIN_GRANT', planCode);
      const ent = await this.entitlements.get(id);
      granted = { days: input.grantDays, planCode: ent.planCode ?? planCode, endsAt: ent.endsAt };
      await this.audit.log(actorId, 'user.grant_days', 'user', id, { days: input.grantDays, planCode, endsAt: ent.endsAt });
      await this.notifyGrant(id, u.locale, input.grantDays).catch((e: unknown) => this.logger.warn(`grant notification failed: ${(e as Error).message}`));
    }
    const [row] = (await this.users({ q: id, includeGuests: true, page: 1, pageSize: 1 })).items;
    return { ...row, granted };
  }

  private async notifyGrant(userId: string, locale: string, days: number): Promise<void> {
    const fr = locale === 'fr';
    await this.notifications.notify(userId, {
      type: 'SUBSCRIPTION',
      title: fr ? 'Accès Premium offert' : 'تم تفعيل الاشتراك المميز',
      body: fr ? `L’équipe Concours TN vous a offert ${days} jour${days > 1 ? 's' : ''} d’accès Premium.` : `أهداك فريق Concours TN ${days} ${days === 1 ? 'يوماً' : days === 2 ? 'يومين' : days <= 10 ? 'أيام' : 'يوماً'} من الاشتراك المميز.`,
      url: '/app/billing',
      dedupeKey: `grant:${Date.now()}`,
      data: { days, source: 'ADMIN_GRANT' },
    });
  }

  private userDto(
    u: { id: string; name: string | null; email: string | null; phone: string | null; role: UserRole; isGuest: boolean; locale: string; createdAt: Date; lastActiveAt: Date | null; emailVerifiedAt: Date | null },
    premium: { planCode: string; endsAt: string } | null,
    stats: { xp: number; streak: number; answered: number },
  ) {
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, isGuest: u.isGuest, locale: u.locale,
      emailVerified: !!u.emailVerifiedAt, createdAt: u.createdAt.toISOString(), lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
      premium: premium ? { active: true, planCode: premium.planCode, endsAt: premium.endsAt ? new Date(premium.endsAt).toISOString() : null } : { active: false, planCode: null, endsAt: null },
      stats,
    };
  }

  // ───────────── Payments ─────────────

  async paymentsList(q: PaymentsQuery) {
    const { page, pageSize, offset } = paging(q.page, q.pageSize, 50, 100);
    const where = and(q.status ? eq(payments.status, q.status) : undefined, q.provider ? eq(payments.provider, q.provider) : undefined);
    const [rows, [{ total }], [summary]] = await Promise.all([
      this.paymentRows(where).orderBy(
        // Manual transfers waiting with a proof first: they are the ones a human must act on.
        sql`case when ${payments.status} = 'PENDING' and ${payments.provider} = 'MANUAL' and ${payments.manualReference} is not null then 0 else 1 end`,
        desc(payments.createdAt),
      ).limit(pageSize).offset(offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(payments).where(where),
      this.db.select({
        pendingManual: sql<number>`count(*) filter (where ${payments.status} = 'PENDING' and ${payments.provider} = 'MANUAL')::int`,
        pendingManualWithProof: sql<number>`count(*) filter (where ${payments.status} = 'PENDING' and ${payments.provider} = 'MANUAL' and ${payments.manualReference} is not null)::int`,
      }).from(payments),
    ]);
    return {
      items: rows.map((r) => this.paymentDto(r)),
      total: Number(total),
      page,
      pageSize,
      summary: { pendingManual: Number(summary?.pendingManual ?? 0), pendingManualWithProof: Number(summary?.pendingManualWithProof ?? 0) },
    };
  }

  async approvePayment(id: string, actorId: string) {
    const p = await this.manualPayment(id);
    if (p.status === 'PAID') throw conflict('ALREADY_PAID');
    if (p.status === 'REFUNDED') throw conflict('PAYMENT_REFUNDED');
    await this.payments.markPaid(id, { actorId });
    await this.audit.log(actorId, 'payment.approve', 'payment', id, { userId: p.userId, amountMillimes: p.amountMillimes, manualReference: p.manualReference, previousStatus: p.status });
    return this.payment(id);
  }

  async rejectPayment(id: string, reason: string | undefined, actorId: string) {
    const p = await this.manualPayment(id);
    if (p.status !== 'PENDING') throw conflict('NOT_PENDING', { status: p.status });
    const why = reason?.trim() || 'REJECTED_BY_ADMIN';
    await this.payments.markFailed(id, why);
    await this.audit.log(actorId, 'payment.reject', 'payment', id, { userId: p.userId, reason: why, manualReference: p.manualReference });
    return this.payment(id);
  }

  private async manualPayment(id: string) {
    assertUuid(id);
    const [p] = await this.db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!p) throw notFound();
    // Card/wallet payments are confirmed by their provider (webhooks, reconciliation), never by hand.
    if (p.provider !== 'MANUAL') throw badRequest('NOT_MANUAL');
    return p;
  }

  private async payment(id: string) {
    const [r] = await this.paymentRows(eq(payments.id, id)).limit(1);
    if (!r) throw notFound();
    return this.paymentDto(r);
  }

  private paymentRows(where: SQL | undefined) {
    return this.db
      .select({ p: payments, planCode: plans.code, planNameAr: plans.nameAr, planNameFr: plans.nameFr, userName: users.name, userEmail: users.email, userPhone: users.phone })
      .from(payments)
      .innerJoin(plans, eq(plans.id, payments.planId))
      .innerJoin(users, eq(users.id, payments.userId))
      .where(where)
      .$dynamic();
  }

  private paymentDto(r: { p: typeof payments.$inferSelect; planCode: string; planNameAr: string; planNameFr: string; userName: string | null; userEmail: string | null; userPhone: string | null }) {
    const raw = (r.p.raw ?? {}) as Record<string, unknown>;
    return {
      id: r.p.id, amountMillimes: r.p.amountMillimes, currency: r.p.currency, provider: r.p.provider, providerRef: r.p.providerRef, status: r.p.status,
      promoCode: r.p.promoCode, manualReference: r.p.manualReference, failureReason: typeof raw.failureReason === 'string' ? raw.failureReason : null,
      createdAt: r.p.createdAt.toISOString(), paidAt: r.p.paidAt?.toISOString() ?? null,
      plan: { code: r.planCode, name_ar: r.planNameAr, name_fr: r.planNameFr },
      user: { id: r.p.userId, name: r.userName, email: r.userEmail, phone: r.userPhone },
    };
  }

  // ───────────── Broadcast ─────────────

  /**
   * SYSTEM notification to a segment: people enrolled in / following a family, or any family of a field, optionally premium
   * only. Without a segment: every registered account plus guests who follow or prepare a concours (anonymous visitors who
   * left are not an audience). The same message to the same segment is sent once per day (double-click safe).
   */
  async broadcast(input: BroadcastBody, actorId: string, opts: { dryRun?: boolean } = {}): Promise<{ sent: number; audience: number; dedupeKey: string; dryRun: boolean }> {
    if (input.url && !isSafeLink(input.url)) throw badRequest('INVALID_URL');
    const seg = input.segment ?? {};
    let familyId: string | null = null;
    if (seg.familySlug) {
      const [fam] = await this.db.select({ id: competitionFamilies.id }).from(competitionFamilies).where(eq(competitionFamilies.slug, seg.familySlug)).limit(1);
      if (!fam) throw badRequest('UNKNOWN_FAMILY');
      familyId = fam.id;
    }
    // `familyIds` is a parenthesised id list or sub-select, reused in both EXISTS clauses.
    const interestedIn = (familyIds: SQL) => sql`(
      exists (select 1 from ${enrollments} where ${enrollments.userId} = ${users.id} and ${enrollments.familyId} in ${familyIds})
      or exists (select 1 from ${follows} where ${follows.userId} = ${users.id} and ${follows.familyId} in ${familyIds}))`;
    const engaged = sql`(exists (select 1 from ${enrollments} where ${enrollments.userId} = ${users.id}) or exists (select 1 from ${follows} where ${follows.userId} = ${users.id}))`;
    const audienceWhere = and(
      isNull(users.deletedAt),
      familyId ? interestedIn(sql`(${familyId}::uuid)`) : undefined,
      seg.field ? interestedIn(sql`(select ${competitionFamilies.id} from ${competitionFamilies} where ${competitionFamilies.field} = ${seg.field})`) : undefined,
      seg.premiumOnly ? activePremiumSql(users.id) : undefined,
      !familyId && !seg.field && !seg.premiumOnly ? or(eq(users.isGuest, false), engaged) : undefined,
    );

    const dedupeKey = `broadcast:${createHash('sha256')
      .update(JSON.stringify([input.title.trim(), input.body.trim(), input.url ?? null, seg.familySlug ?? null, seg.field ?? null, !!seg.premiumOnly, tunisToday()]))
      .digest('hex')
      .slice(0, 20)}`;

    if (opts.dryRun) {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(audienceWhere);
      return { sent: 0, audience: Number(n), dedupeKey, dryRun: true };
    }
    if (!this.limiter.hit(`broadcast:${actorId}`, BROADCASTS_PER_HOUR, 3_600_000)) throw new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);

    let cursor: string | null = null;
    let audience = 0;
    let sent = 0;
    for (;;) {
      const batch: { id: string }[] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(audienceWhere, cursor ? gt(users.id, cursor) : undefined))
        .orderBy(asc(users.id))
        .limit(BROADCAST_BATCH);
      if (!batch.length) break;
      audience += batch.length;
      sent += await this.notifications.notifyMany(batch.map((b) => b.id), {
        type: 'SYSTEM',
        title: input.title.trim(),
        body: input.body.trim(),
        url: input.url ?? null,
        dedupeKey,
        data: { broadcast: dedupeKey, segment: seg },
      });
      if (batch.length < BROADCAST_BATCH) break;
      cursor = batch[batch.length - 1].id;
    }
    await this.audit.log(actorId, 'notification.broadcast', 'notification', dedupeKey, { title: input.title, segment: seg, url: input.url ?? null, audience, sent });
    return { sent, audience, dedupeKey, dryRun: false };
  }

  // ───────────── Waitlist ─────────────

  async waitlist(q: WaitlistQuery) {
    const { page, pageSize, offset } = paging(q.page, q.pageSize, 100, 500);
    const where = q.familySlug ? eq(waitlist.familySlug, q.familySlug) : undefined;
    const [rows, [stats], byWillingness, byFamily] = await Promise.all([
      this.db.select().from(waitlist).where(where).orderBy(desc(waitlist.createdAt), asc(waitlist.id)).limit(pageSize).offset(offset),
      this.db.select({
        total: sql<number>`count(*)::int`,
        last7d: sql<number>`count(*) filter (where ${waitlist.createdAt} > now() - interval '7 days')::int`,
        last30d: sql<number>`count(*) filter (where ${waitlist.createdAt} > now() - interval '30 days')::int`,
        withEmail: sql<number>`count(*) filter (where ${waitlist.email} is not null)::int`,
        withPhone: sql<number>`count(*) filter (where ${waitlist.phone} is not null)::int`,
      }).from(waitlist).where(where),
      this.db.select({ willingness: waitlist.willingness, n: sql<number>`count(*)::int` }).from(waitlist).where(where).groupBy(waitlist.willingness),
      this.db.select({ familySlug: waitlist.familySlug, n: sql<number>`count(*)::int` }).from(waitlist).where(where).groupBy(waitlist.familySlug).orderBy(sql`count(*) desc`).limit(50),
    ]);
    return {
      items: rows.map((r) => ({ id: r.id, email: r.email, phone: r.phone, familySlug: r.familySlug, willingness: r.willingness, utm: r.utm, createdAt: r.createdAt.toISOString() })),
      total: Number(stats?.total ?? 0),
      page,
      pageSize,
      counts: {
        total: Number(stats?.total ?? 0), last7d: Number(stats?.last7d ?? 0), last30d: Number(stats?.last30d ?? 0),
        withEmail: Number(stats?.withEmail ?? 0), withPhone: Number(stats?.withPhone ?? 0),
        byWillingness: Object.fromEntries(byWillingness.map((b) => [b.willingness ?? 'unknown', Number(b.n)])),
        byFamily: byFamily.map((b) => ({ familySlug: b.familySlug, count: Number(b.n) })),
      },
    };
  }

  /** CSV export (UTF-8 with BOM so Excel opens Arabic correctly). Cells are escaped against formula injection. */
  async waitlistCsv(q: WaitlistQuery, actorId: string): Promise<string> {
    const where = q.familySlug ? eq(waitlist.familySlug, q.familySlug) : undefined;
    const rows = await this.db.select().from(waitlist).where(where).orderBy(desc(waitlist.createdAt)).limit(50_000);
    const cell = (v: unknown) => {
      let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['created_at', 'email', 'phone', 'family_slug', 'willingness', 'utm'].join(',')];
    for (const r of rows) lines.push([r.createdAt.toISOString(), r.email, r.phone, r.familySlug, r.willingness, r.utm].map(cell).join(','));
    await this.audit.log(actorId, 'waitlist.export', 'waitlist', null, { rows: rows.length, familySlug: q.familySlug ?? null });
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  // ───────────── Audit ─────────────

  async auditLog(q: AuditQuery, role: UserRole) {
    const limit = q.limit ?? 100;
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(and(
        q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
        q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
        q.actorId ? eq(auditLogs.actorId, q.actorId) : undefined,
        q.action ? or(eq(auditLogs.action, q.action), sql`${auditLogs.action} like ${`${q.action.replace(/[\\%_]/g, (c) => `\\${c}`)}.%`}`) : undefined,
        q.before ? lt(auditLogs.createdAt, new Date(q.before)) : undefined,
        role === 'ADMIN' ? undefined : sql`${auditLogs.entityType} not in (${sql.join(ADMIN_ONLY_AUDIT.map((t) => sql`${t}`), sql`, `)})`,
      ))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit);
    const people = await peopleByIds(this.db, rows.map((r) => r.actorId));
    return {
      items: rows.map((r) => ({
        id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId, diff: r.diff, createdAt: r.createdAt.toISOString(),
        actor: r.actorId ? people.get(r.actorId) ?? { id: r.actorId, name: null } : null,
      })),
      nextBefore: rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null,
    };
  }
}


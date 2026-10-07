import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  checkEligibility, shouldAlert, type EditionDTO, type EligibilityResult, type EligibilityRules, type Field,
} from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  alertMatches, competitionFamilies, competitions, enrollments, follows, positions, sources, userProfiles, users,
} from '../../db/schema';
import { VISIBLE_STATUSES, effectiveStatus, provenance, toCandidateProfile, type SourceRow } from '../catalog/catalog.util';
import { concoursMatchMessage, concoursUpdateMessage, type EditionFacts } from './alert-messages';
import { NotificationsService } from './notifications.service';
import { BATCH_SIZE, DELIVERY_CONCURRENCY, UUID_RE, asLocale, chunks, errorMessage, mapLimit } from './notifications.util';

interface TargetPosition {
  id: string;
  slug: string;
  titleAr: string;
  titleFr: string;
  rules: EligibilityRules;
}

/** Everything needed to match one edition against users, loaded once per run. */
export interface CompetitionContext {
  id: string;
  familyId: string;
  familySlug: string;
  field: Field;
  edition: EditionFacts;
  /** Age reference date: registration deadline, else exam date, else today. */
  refDate: string;
  positions: TargetPosition[];
}

interface AudienceRow {
  id: string;
  locale: string;
  /** Follows or is enrolled in the family (gets deadline reminders already). */
  follows: boolean;
  birthDate: string | null;
  gender: string | null;
  diplomaLevel: string | null;
  specialties: string[] | null;
  heightCm: number | null;
  maritalStatus: string | null;
  nationality: string | null;
}

interface KeptPosition {
  positionId: string | null;
  slug: string | null;
  title_ar: string;
  title_fr: string;
  result: EligibilityResult;
}

export interface AlertItem {
  competition: EditionDTO;
  positionSlug: string | null;
  positionTitle_ar: string | null;
  positionTitle_fr: string | null;
  eligibility: EligibilityResult;
  createdAt: string;
}

/** When a family has no (targeted) position on file, nothing can be checked: a match "to verify", never "eligible". */
const UNKNOWN_RULES: EligibilityResult = { status: 'PARTIAL', checks: [], rules_unverified: true, other_ar: [], other_fr: [] };

/**
 * CONTRACT (owned by the notifications module) — "notify people when a concours matches their profile":
 * - matchCompetition(competitionId) → for every user with alerts enabled (and matching alert_fields, or following the family),
 *   run checkEligibility (@ctn/shared) against each relevant position; for ELIGIBLE/PARTIAL results insert alert_matches and
 *   send ONE CONCOURS_MATCH notification per user and edition (dedupeKey `match:<competitionId>`). Sets
 *   competitions.alerts_sent_at. Returns { matchedUsers, notified }.
 * - matchUser(userId) → run all OPEN/ANNOUNCED competitions against one user (after profile update / registration).
 *
 * Audience of an edition (non-deleted users):
 *   - alerts_enabled AND (the family's field is in alert_fields, OR alert_fields is empty and the profile has a birth date
 *     or diploma — an empty profile "matches" nothing), or
 *   - follows / is enrolled in the family (an explicit subscription to that family).
 * Only PUBLISHED editions are announced: nothing reaches users' phones before a human reviewed it.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger('AlertsService');
  private readonly inflight = new Map<string, Promise<{ matchedUsers: number; notified: number }>>();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  async matchCompetition(competitionId: string): Promise<{ matchedUsers: number; notified: number }> {
    if (!UUID_RE.test(competitionId)) return { matchedUsers: 0, notified: 0 };
    // Admin "notify" + hourly cron on the same edition share one run.
    const running = this.inflight.get(competitionId);
    if (running) return running;
    const run = this.runCompetition(competitionId).finally(() => this.inflight.delete(competitionId));
    this.inflight.set(competitionId, run);
    return run;
  }

  async matchUser(userId: string): Promise<{ matched: number }> {
    if (!UUID_RE.test(userId)) return { matched: 0 };
    const contexts = await this.loadContexts();
    let matched = 0;
    for (const ctx of contexts) {
      const rows = await this.audience(ctx, { userId });
      if (!rows.length) continue;
      const r = await this.processUsers(ctx, rows);
      matched += r.matchedUsers;
    }
    return { matched };
  }

  /** Alerts of a user, newest first, joined with edition / family / position (GET /me/alerts). */
  async listForUser(userId: string, limit = 50): Promise<AlertItem[]> {
    const rows = await this.db
      .select({
        m: alertMatches,
        c: competitions,
        familySlug: competitionFamilies.slug,
        familyNameAr: competitionFamilies.nameAr,
        familyNameFr: competitionFamilies.nameFr,
        field: competitionFamilies.field,
        positionSlug: positions.slug,
        positionTitleAr: positions.titleAr,
        positionTitleFr: positions.titleFr,
        src: {
          id: sources.id, title: sources.title, url: sources.url, sourceType: sources.sourceType,
          publicationDate: sources.publicationDate, lastVerifiedAt: sources.lastVerifiedAt,
        },
      })
      .from(alertMatches)
      .innerJoin(competitions, eq(competitions.id, alertMatches.competitionId))
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, competitions.familyId))
      .leftJoin(positions, eq(positions.id, alertMatches.positionId))
      .leftJoin(sources, eq(sources.id, competitions.sourceId))
      .where(and(
        eq(alertMatches.userId, userId),
        inArray(competitions.contentStatus, VISIBLE_STATUSES),
        inArray(competitionFamilies.status, VISIBLE_STATUSES),
      ))
      .orderBy(desc(alertMatches.createdAt), asc(positions.orderIndex), asc(positions.slug))
      .limit(Math.min(Math.max(limit, 1), 200));
    const today = tunisToday();
    return rows.map((r) => {
      const src = r.src?.id ? (r.src as SourceRow) : null;
      const e = r.c;
      return {
        competition: {
          ...provenance(src, e.confidence, e.needsVerification),
          id: e.id, familySlug: r.familySlug, familyName_ar: r.familyNameAr, familyName_fr: r.familyNameFr, field: r.field,
          year: e.year, sessionLabel: e.sessionLabel, status: effectiveStatus(e, today),
          registrationOpen: e.registrationOpen, registrationDeadline: e.registrationDeadline, examDate: e.examDate,
          positionsCount: e.positionsCount, candidatesCount: e.candidatesCount, positionSlugs: e.positionSlugs,
          announcementUrl: e.announcementUrl ?? src?.url ?? null,
        },
        positionSlug: r.positionSlug ?? null,
        positionTitle_ar: r.positionTitleAr ?? null,
        positionTitle_fr: r.positionTitleFr ?? null,
        eligibility: r.m.eligibility as EligibilityResult,
        createdAt: r.m.createdAt.toISOString(),
      };
    });
  }

  /**
   * CONCOURS_UPDATE for an edition users care about (dates moved, results published…): followers, enrolled users and
   * users it was matched to. Call it after a human-reviewed change; `key` makes the same update idempotent.
   */
  async notifyCompetitionUpdate(competitionId: string, summary: { ar: string; fr: string }, key?: string): Promise<number> {
    if (!UUID_RE.test(competitionId)) return 0;
    const [ctx] = await this.loadContexts(eq(competitions.id, competitionId), { anyStatus: true });
    if (!ctx) return 0;
    const updateKey = key ?? createHash('sha256').update(`${summary.ar}\n${summary.fr}`).digest('hex').slice(0, 16);
    let sent = 0;
    for await (const batch of this.interestedUsers(ctx.familyId, ctx.id)) {
      for (const locale of ['ar', 'fr'] as const) {
        const ids = batch.filter((u) => asLocale(u.locale) === locale).map((u) => u.id);
        if (!ids.length) continue;
        sent += await this.notifications.notifyMany(ids, {
          type: 'CONCOURS_UPDATE',
          ...concoursUpdateMessage(locale, ctx.edition, summary),
          url: `/concours/${ctx.familySlug}`,
          dedupeKey: `update:${ctx.id}:${updateKey}`,
          data: { competitionId: ctx.id, familySlug: ctx.familySlug },
        });
      }
    }
    return sent;
  }

  /**
   * Users interested in a family's editions: followers and enrolled users, plus (when `competitionId` is given) users
   * that edition was matched to. Yields batches of {id, locale}, keyset-paginated by id.
   */
  async *interestedUsers(familyId: string, competitionId?: string): AsyncGenerator<{ id: string; locale: string }[]> {
    const interest: SQL[] = [
      sql`exists (select 1 from ${follows} where ${follows.userId} = ${users.id} and ${follows.familyId} = ${familyId})`,
      sql`exists (select 1 from ${enrollments} where ${enrollments.userId} = ${users.id} and ${enrollments.familyId} = ${familyId})`,
    ];
    if (competitionId) {
      interest.push(sql`exists (select 1 from ${alertMatches} where ${alertMatches.userId} = ${users.id} and ${alertMatches.competitionId} = ${competitionId})`);
    }
    let cursor: string | null = null;
    for (;;) {
      const rows: { id: string; locale: string }[] = await this.db
        .select({ id: users.id, locale: users.locale })
        .from(users)
        .where(and(isNull(users.deletedAt), cursor ? gt(users.id, cursor) : undefined, or(...interest)))
        .orderBy(asc(users.id))
        .limit(BATCH_SIZE);
      if (!rows.length) return;
      yield rows;
      if (rows.length < BATCH_SIZE) return;
      cursor = rows[rows.length - 1].id;
    }
  }

  /**
   * Editions that can be announced: PUBLISHED, visible family, OPEN/ANNOUNCED and a registration deadline not yet past
   * (or unknown). `anyStatus` lifts the status/deadline filter (updates about closed editions).
   */
  async loadContexts(where?: SQL, opts: { anyStatus?: boolean } = {}): Promise<CompetitionContext[]> {
    const today = tunisToday();
    const rows = await this.db
      .select({
        c: competitions,
        familySlug: competitionFamilies.slug,
        field: competitionFamilies.field,
        familyNameAr: competitionFamilies.nameAr,
        familyNameFr: competitionFamilies.nameFr,
      })
      .from(competitions)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, competitions.familyId))
      .where(and(
        eq(competitions.contentStatus, 'PUBLISHED'),
        inArray(competitionFamilies.status, VISIBLE_STATUSES),
        opts.anyStatus ? undefined : inArray(competitions.status, ['OPEN', 'ANNOUNCED']),
        opts.anyStatus ? undefined : or(isNull(competitions.registrationDeadline), gte(competitions.registrationDeadline, today)),
        where,
      ))
      .orderBy(asc(competitions.registrationDeadline));
    if (!rows.length) return [];

    const familyIds = [...new Set(rows.map((r) => r.c.familyId))];
    const posRows = await this.db
      .select()
      .from(positions)
      .where(and(inArray(positions.familyId, familyIds), inArray(positions.status, VISIBLE_STATUSES)))
      .orderBy(asc(positions.orderIndex), asc(positions.slug));

    return rows.map(({ c, ...f }) => {
      const wanted = new Set(c.positionSlugs ?? []);
      const targeted = posRows.filter((p) => p.familyId === c.familyId && (wanted.size === 0 || wanted.has(p.slug)));
      return {
        id: c.id,
        familyId: c.familyId,
        familySlug: f.familySlug,
        field: f.field,
        refDate: c.registrationDeadline ?? c.examDate ?? today,
        edition: {
          familyName_ar: f.familyNameAr,
          familyName_fr: f.familyNameFr,
          status: effectiveStatus(c, today),
          registrationOpen: c.registrationOpen,
          registrationDeadline: c.registrationDeadline,
          examDate: c.examDate,
          needsVerification: c.needsVerification,
        },
        positions: targeted.map((p) => ({
          id: p.id,
          slug: p.slug,
          titleAr: p.titleAr,
          titleFr: p.titleFr,
          // Same convention as the public catalog: the column is the source of truth for "rules to verify".
          rules: { ...((p.eligibility ?? {}) as EligibilityRules), needs_verification: p.eligibilityNeedsVerification },
        })),
      };
    });
  }

  // ───────────── Internals ─────────────

  private async runCompetition(competitionId: string): Promise<{ matchedUsers: number; notified: number }> {
    const [ctx] = await this.loadContexts(eq(competitions.id, competitionId));
    if (!ctx) return { matchedUsers: 0, notified: 0 };
    let cursor: string | null = null;
    let matchedUsers = 0;
    let notified = 0;
    let failures = 0;
    for (;;) {
      const rows = await this.audience(ctx, { after: cursor });
      if (!rows.length) break;
      const r = await this.processUsers(ctx, rows);
      matchedUsers += r.matchedUsers;
      notified += r.notified;
      failures += r.failures;
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    // A partial failure leaves alerts_sent_at empty so the hourly job retries (dedupe keys prevent double sends).
    if (!failures) await this.db.update(competitions).set({ alertsSentAt: new Date() }).where(eq(competitions.id, ctx.id));
    this.logger.log(`edition ${ctx.id} (${ctx.familySlug}): ${matchedUsers} matching users, ${notified} notified${failures ? `, ${failures} failed` : ''}`);
    return { matchedUsers, notified };
  }

  private async audience(ctx: CompetitionContext, opts: { after?: string | null; userId?: string }): Promise<AudienceRow[]> {
    const followsFamily = sql<boolean>`(exists (select 1 from ${follows} where ${follows.userId} = ${users.id} and ${follows.familyId} = ${ctx.familyId})
      or exists (select 1 from ${enrollments} where ${enrollments.userId} = ${users.id} and ${enrollments.familyId} = ${ctx.familyId}))`;
    const profileMatch = sql`(${userProfiles.alertsEnabled} and (
      ${ctx.field} = any(${userProfiles.alertFields})
      or (cardinality(${userProfiles.alertFields}) = 0 and (${userProfiles.birthDate} is not null or ${userProfiles.diplomaLevel} is not null))))`;
    const rows = await this.db
      .select({
        id: users.id,
        locale: users.locale,
        follows: followsFamily,
        birthDate: userProfiles.birthDate,
        gender: userProfiles.gender,
        diplomaLevel: userProfiles.diplomaLevel,
        specialties: userProfiles.specialties,
        heightCm: userProfiles.heightCm,
        maritalStatus: userProfiles.maritalStatus,
        nationality: userProfiles.nationality,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(
        isNull(users.deletedAt),
        opts.userId ? eq(users.id, opts.userId) : undefined,
        opts.after ? gt(users.id, opts.after) : undefined,
        sql`(${profileMatch} or ${followsFamily})`,
      ))
      .orderBy(asc(users.id))
      .limit(BATCH_SIZE);
    return rows.map((r) => ({ ...r, follows: !!r.follows }));
  }

  private evaluate(ctx: CompetitionContext, row: AudienceRow): KeptPosition[] {
    if (!ctx.positions.length) return [{ positionId: null, slug: null, title_ar: '', title_fr: '', result: UNKNOWN_RULES }];
    const profile = toCandidateProfile(row);
    return ctx.positions
      .map((p) => ({ positionId: p.id, slug: p.slug, title_ar: p.titleAr, title_fr: p.titleFr, result: checkEligibility(p.rules, profile, ctx.refDate) }))
      .filter((k) => shouldAlert(k.result));
  }

  private async processUsers(ctx: CompetitionContext, rows: AudienceRow[]): Promise<{ matchedUsers: number; notified: number; failures: number }> {
    const evaluated = rows.map((row) => ({ row, kept: this.evaluate(ctx, row) }));
    await this.saveMatches(ctx.id, evaluated.map((e) => ({ userId: e.row.id, kept: e.kept })));

    const matched = evaluated.filter((e) => e.kept.length > 0);
    const outcomes = await mapLimit(matched, DELIVERY_CONCURRENCY, async ({ row, kept }) => {
      try {
        const locale = asLocale(row.locale);
        const best = kept.some((k) => k.result.status === 'ELIGIBLE') ? 'ELIGIBLE' : 'PARTIAL';
        const id = await this.notifications.notify(row.id, {
          type: 'CONCOURS_MATCH',
          ...concoursMatchMessage(locale, ctx.edition, kept, { suggestFollow: !row.follows }),
          url: `/concours/${ctx.familySlug}`,
          dedupeKey: `match:${ctx.id}`,
          pushUrgency: 'high',
          pushTtlSeconds: 3 * 86_400,
          data: {
            competitionId: ctx.id,
            familySlug: ctx.familySlug,
            positionSlugs: kept.map((k) => k.slug).filter(Boolean),
            eligibility: best,
            rulesUnverified: kept.some((k) => k.result.rules_unverified),
            datesUnverified: ctx.edition.needsVerification,
          },
        });
        if (id) {
          await this.db
            .update(alertMatches)
            .set({ notificationId: id })
            .where(and(eq(alertMatches.userId, row.id), eq(alertMatches.competitionId, ctx.id), isNull(alertMatches.notificationId)));
        }
        return id ? 'notified' : 'deduped';
      } catch (e) {
        this.logger.warn(`CONCOURS_MATCH for ${row.id} / ${ctx.id} failed: ${errorMessage(e)}`);
        return 'failed';
      }
    });
    return {
      matchedUsers: matched.length,
      notified: outcomes.filter((o) => o === 'notified').length,
      failures: outcomes.filter((o) => o === 'failed').length,
    };
  }

  /**
   * Makes alert_matches mirror the latest evaluation for these users: upserts kept positions (refreshing the stored
   * eligibility) and removes positions they no longer qualify for (profile or rules changed).
   */
  private async saveMatches(competitionId: string, evaluated: { userId: string; kept: KeptPosition[] }[]): Promise<void> {
    for (const group of chunks(evaluated, 100)) {
      const userIds = group.map((g) => g.userId);
      const keep = group.flatMap((g) => g.kept.map((k) => ({ userId: g.userId, positionId: k.positionId, eligibility: k.result })));
      const keepPairs = keep.map((k) => sql`(${k.userId}::uuid, ${k.positionId}::uuid)`);
      await this.db.delete(alertMatches).where(and(
        eq(alertMatches.competitionId, competitionId),
        inArray(alertMatches.userId, userIds),
        keepPairs.length
          ? sql`not exists (select 1 from (values ${sql.join(keepPairs, sql`, `)}) as k(u, p)
              where k.u = ${alertMatches.userId} and k.p is not distinct from ${alertMatches.positionId})`
          : undefined,
      ));

      const withPosition = keep.filter((k) => k.positionId);
      if (withPosition.length) {
        await this.db
          .insert(alertMatches)
          .values(withPosition.map((k) => ({ userId: k.userId, competitionId, positionId: k.positionId, eligibility: k.eligibility })))
          .onConflictDoUpdate({
            target: [alertMatches.userId, alertMatches.competitionId, alertMatches.positionId],
            set: { eligibility: sql`excluded.eligibility` },
          });
      }

      // NULL position ids are not covered by the unique index: upsert them by hand.
      const familyLevel = keep.filter((k) => !k.positionId);
      if (familyLevel.length) {
        const existing = new Set(
          (await this.db
            .select({ userId: alertMatches.userId })
            .from(alertMatches)
            .where(and(
              eq(alertMatches.competitionId, competitionId),
              isNull(alertMatches.positionId),
              inArray(alertMatches.userId, familyLevel.map((k) => k.userId)),
            ))).map((r) => r.userId),
        );
        const fresh = familyLevel.filter((k) => !existing.has(k.userId));
        if (fresh.length) {
          await this.db.insert(alertMatches).values(fresh.map((k) => ({ userId: k.userId, competitionId, positionId: null, eligibility: k.eligibility })));
        }
      }
    }
  }
}

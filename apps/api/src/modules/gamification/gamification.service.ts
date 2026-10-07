import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { BADGES, levelFromXp, updateStreak, type GamificationDTO, type LeaderboardDTO } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { attempts, competitionFamilies, userBadges, userStats, users, xpEvents } from '../../db/schema';
import { DAILY_GOAL_XP, LEADERBOARD_SIZE, displayedStreak, freezesAfter, leaderboardName, rankRows } from './gamification.util';
import { tunisMidnightUtc, tunisParts, tunisWeekStartUtc } from './tunis-time';

export type BadgeCode = (typeof BADGES)[number]['code'];
export type LeaderboardPeriod = 'week' | 'all';

const BADGE_ORDER: BadgeCode[] = BADGES.map((b) => b.code);
const MOCK_80_THRESHOLD = 0.8 - 1e-6; // scores are stored as float4
const TOP_CACHE_MS = 30_000;

interface TopRow { userId: string; name: string | null; xp: number }

/**
 * CONTRACT (owned by the gamification module):
 * - awardXp(userId, amount, reason, familyId?) → inserts xp_events, increments user_stats.xp_total; returns new total.
 * - touchStreak(userId) → updates streak for today (Africa/Tunis) using @ctn/shared updateStreak; returns current streak.
 * - checkBadges(userId) → awards any newly earned badges (see BADGES in @ctn/shared), returns the new badge codes.
 * - incrementAnswered(userId, n) → user_stats.questions_answered += n.
 */
@Injectable()
export class GamificationService {
  private readonly topCache = new Map<string, { at: number; rows: TopRow[] }>();

  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────── Write side (called by practice / learning) ─────────────

  async awardXp(userId: string, amount: number, reason: string, familyId?: string | null): Promise<number> {
    const xp = Math.trunc(Number(amount));
    if (!Number.isFinite(xp) || xp === 0) return this.xpTotal(userId);
    return this.db.transaction(async (tx) => {
      await tx.insert(xpEvents).values({ userId, familyId: familyId ?? null, amount: xp, reason: String(reason).slice(0, 60) });
      const [row] = await tx
        .insert(userStats)
        .values({ userId, xpTotal: Math.max(0, xp) })
        .onConflictDoUpdate({ target: userStats.userId, set: { xpTotal: sql`greatest(0, ${userStats.xpTotal} + ${xp}::int)` } })
        .returning({ xpTotal: userStats.xpTotal });
      return row.xpTotal;
    });
  }

  /**
   * Marks today (Africa/Tunis) as active. Compare-and-set on last_active_date so concurrent answers count once.
   * Every 7-day milestone earns a streak freeze (max 3 in reserve).
   */
  async touchStreak(userId: string, today = tunisToday()): Promise<number> {
    await this.ensureStats(userId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = await this.stats(userId);
      if (!s) return 0;
      // A clock running behind must never reset a streak.
      if (s.lastActiveDate && s.lastActiveDate >= today) return s.streakCurrent;
      const next = updateStreak(
        { current: s.streakCurrent, longest: s.streakLongest, lastActive: s.lastActiveDate, freezes: s.streakFreezes },
        today,
      );
      const updated = await this.db
        .update(userStats)
        .set({
          streakCurrent: next.current,
          streakLongest: next.longest,
          streakFreezes: freezesAfter(s.streakCurrent, next.current, next.freezes),
          lastActiveDate: today,
        })
        .where(and(
          eq(userStats.userId, userId),
          s.lastActiveDate ? eq(userStats.lastActiveDate, s.lastActiveDate) : isNull(userStats.lastActiveDate),
        ))
        .returning({ current: userStats.streakCurrent });
      if (updated.length) return updated[0].current;
    }
    return (await this.stats(userId))?.streakCurrent ?? 0;
  }

  async incrementAnswered(userId: string, n: number): Promise<void> {
    const count = Math.trunc(Number(n));
    if (!Number.isFinite(count) || count <= 0) return;
    await this.db
      .insert(userStats)
      .values({ userId, questionsAnswered: count })
      .onConflictDoUpdate({ target: userStats.userId, set: { questionsAnswered: sql`${userStats.questionsAnswered} + ${count}::int` } });
  }

  /** Idempotent: awards every badge whose rule now holds and returns only the codes awarded by this call. */
  async checkBadges(userId: string): Promise<string[]> {
    const owned = new Set(
      (await this.db.select({ code: userBadges.code }).from(userBadges).where(eq(userBadges.userId, userId))).map((b) => b.code),
    );
    if (BADGE_ORDER.every((c) => owned.has(c))) return [];

    const s = await this.stats(userId);
    const [agg] = await this.db
      .select({
        diagnostic: sql<boolean | null>`bool_or(${attempts.kind} = 'DIAGNOSTIC')`,
        mock: sql<boolean | null>`bool_or(${attempts.kind} = 'MOCK')`,
        mock80: sql<boolean | null>`bool_or(${attempts.kind} = 'MOCK' and ${attempts.score} >= ${MOCK_80_THRESHOLD})`,
      })
      .from(attempts)
      .where(and(eq(attempts.userId, userId), isNotNull(attempts.submittedAt), inArray(attempts.kind, ['DIAGNOSTIC', 'MOCK'])));

    const longest = Math.max(s?.streakLongest ?? 0, s?.streakCurrent ?? 0);
    const answered = s?.questionsAnswered ?? 0;
    const earned: Record<BadgeCode, boolean> = {
      FIRST_STEP: !!agg?.diagnostic,
      STREAK_7: longest >= 7,
      STREAK_30: longest >= 30,
      Q_100: answered >= 100,
      Q_1000: answered >= 1000,
      FIRST_MOCK: !!agg?.mock,
      MOCK_80: !!agg?.mock80,
      MISTAKE_HUNTER: (s?.mistakesFixed ?? 0) >= 50,
    };
    const toAward = BADGE_ORDER.filter((c) => earned[c] && !owned.has(c));
    if (!toAward.length) return [];
    const inserted = await this.db
      .insert(userBadges)
      .values(toAward.map((code) => ({ userId, code })))
      .onConflictDoNothing()
      .returning({ code: userBadges.code });
    const fresh = new Set(inserted.map((r) => r.code));
    return toAward.filter((c) => fresh.has(c));
  }

  // ───────────── Read side (endpoints) ─────────────

  async summary(userId: string, now = new Date()): Promise<GamificationDTO> {
    const today = tunisParts(now).date;
    const [s, badges, [todayRow]] = await Promise.all([
      this.stats(userId),
      this.db
        .select({ code: userBadges.code, awardedAt: userBadges.awardedAt })
        .from(userBadges)
        .where(eq(userBadges.userId, userId))
        .orderBy(asc(userBadges.awardedAt), asc(userBadges.code)),
      this.db
        .select({ xp: sql<number>`coalesce(sum(${xpEvents.amount}), 0)::int` })
        .from(xpEvents)
        .where(and(eq(xpEvents.userId, userId), gte(xpEvents.createdAt, tunisMidnightUtc(today)))),
    ]);
    const xp = s?.xpTotal ?? 0;
    const lvl = levelFromXp(xp);
    const freezes = s?.streakFreezes ?? 1;
    return {
      xp,
      level: lvl.level,
      levelProgress: { current: lvl.current, next: lvl.next },
      streak: {
        current: s ? displayedStreak(s.streakCurrent, s.lastActiveDate, freezes, today) : 0,
        longest: s?.streakLongest ?? 0,
        freezes,
      },
      badges: badges.map((b) => ({ code: b.code, awardedAt: b.awardedAt.toISOString() })),
      todayXp: Math.max(0, Number(todayRow?.xp ?? 0)),
      dailyGoalXp: DAILY_GOAL_XP,
    };
  }

  /**
   * Top 20 registered, non-deleted users. `week` = XP earned since Monday 00:00 Africa/Tunis; a family scope counts only
   * XP earned while practising that family (xp_events.family_id). Guests are never listed and get `me: null`.
   */
  async leaderboard(
    me: { id: string; isGuest: boolean },
    opts: { period: LeaderboardPeriod; familySlug?: string | null },
    now = new Date(),
  ): Promise<LeaderboardDTO> {
    let familyId: string | null = null;
    if (opts.familySlug) {
      const [f] = await this.db
        .select({ id: competitionFamilies.id })
        .from(competitionFamilies)
        .where(eq(competitionFamilies.slug, opts.familySlug))
        .limit(1);
      if (!f) throw new NotFoundException('NOT_FOUND');
      familyId = f.id;
    }
    const since = opts.period === 'week' ? tunisWeekStartUtc(now) : null;
    const top = rankRows(await this.topRows(since, familyId));

    let mine: LeaderboardDTO['me'] = null;
    if (!me.isGuest) {
      const myXp = await this.xpFor(me.id, since, familyId);
      if (myXp > 0) mine = { rank: (await this.countAbove(myXp, since, familyId)) + 1, xp: myXp };
    }
    return {
      period: opts.period,
      familySlug: opts.familySlug ?? null,
      top: top.map((r) => ({ rank: r.rank, name: leaderboardName(r.name), xp: r.xp, isMe: r.userId === me.id })),
      me: mine,
    };
  }

  // ───────────── Internals ─────────────

  private async stats(userId: string) {
    const [s] = await this.db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1);
    return s ?? null;
  }

  private async ensureStats(userId: string): Promise<void> {
    await this.db.insert(userStats).values({ userId }).onConflictDoNothing();
  }

  private async xpTotal(userId: string): Promise<number> {
    return (await this.stats(userId))?.xpTotal ?? 0;
  }

  private registered(): SQL[] {
    return [eq(users.isGuest, false), isNull(users.deletedAt)];
  }

  /** Event-based scope (a time window and/or a family); null for both means all-time totals from user_stats. */
  private eventConds(since: Date | null, familyId: string | null): SQL[] {
    const conds: SQL[] = [];
    if (since) conds.push(gte(xpEvents.createdAt, since));
    if (familyId) conds.push(eq(xpEvents.familyId, familyId));
    return conds;
  }

  private async topRows(since: Date | null, familyId: string | null): Promise<TopRow[]> {
    const key = `${since?.toISOString() ?? 'all'}|${familyId ?? '*'}`;
    const hit = this.topCache.get(key);
    if (hit && Date.now() - hit.at < TOP_CACHE_MS) return hit.rows;

    let rows: TopRow[];
    if (!since && !familyId) {
      rows = await this.db
        .select({ userId: users.id, name: users.name, xp: userStats.xpTotal })
        .from(userStats)
        .innerJoin(users, eq(users.id, userStats.userId))
        .where(and(gt(userStats.xpTotal, 0), ...this.registered()))
        .orderBy(desc(userStats.xpTotal), asc(users.createdAt))
        .limit(LEADERBOARD_SIZE);
    } else {
      const total = sql`sum(${xpEvents.amount})`;
      rows = (
        await this.db
          .select({ userId: xpEvents.userId, name: users.name, xp: sql<number>`${total}::int` })
          .from(xpEvents)
          .innerJoin(users, eq(users.id, xpEvents.userId))
          .where(and(...this.eventConds(since, familyId), ...this.registered()))
          .groupBy(xpEvents.userId, users.name)
          .having(sql`${total} > 0`)
          .orderBy(desc(total), asc(sql`max(${xpEvents.createdAt})`))
          .limit(LEADERBOARD_SIZE)
      ).map((r) => ({ ...r, xp: Number(r.xp) }));
    }
    if (this.topCache.size > 200) this.topCache.clear();
    this.topCache.set(key, { at: Date.now(), rows });
    return rows;
  }

  private async xpFor(userId: string, since: Date | null, familyId: string | null): Promise<number> {
    if (!since && !familyId) return this.xpTotal(userId);
    const [r] = await this.db
      .select({ xp: sql<number>`coalesce(sum(${xpEvents.amount}), 0)::int` })
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, userId), ...this.eventConds(since, familyId)));
    return Number(r?.xp ?? 0);
  }

  private async countAbove(xp: number, since: Date | null, familyId: string | null): Promise<number> {
    if (!since && !familyId) {
      const [r] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(userStats)
        .innerJoin(users, eq(users.id, userStats.userId))
        .where(and(gt(userStats.xpTotal, xp), ...this.registered()));
      return Number(r?.n ?? 0);
    }
    const better = this.db
      .select({ userId: xpEvents.userId })
      .from(xpEvents)
      .innerJoin(users, eq(users.id, xpEvents.userId))
      .where(and(...this.eventConds(since, familyId), ...this.registered()))
      .groupBy(xpEvents.userId)
      .having(sql`sum(${xpEvents.amount}) > ${xp}::int`)
      .as('better');
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(better);
    return Number(r?.n ?? 0);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Locale } from '@ctn/shared';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { competitions, emailOutbox, notifications, subscriptions, userStats, users } from '../../db/schema';
import { displayedStreak } from '../gamification/gamification.util';
import { TUNIS_TZ, addDaysIso, diffDaysIso, tunisMidnightUtc, tunisParts } from '../gamification/tunis-time';
import {
  deadlineMessage, examMessage, registrationOpensMessage, streakAtRiskMessage, studyReminderMessage, subscriptionEndingMessage,
  subscriptionExpiredMessage, weeklyDigestMessage, type Message,
} from './alert-messages';
import { AlertsService, type CompetitionContext } from './alerts.service';
import { NotificationsService, type NotifyInput } from './notifications.service';
import { BATCH_SIZE, DELIVERY_CONCURRENCY, asLocale, errorMessage, mapLimit } from './notifications.util';

/** Concours alerts found during the night wait until morning: no phone buzzing at 3 a.m. (Africa/Tunis). */
export const ALERT_HOURS = { from: 8, to: 21 } as const;
export const DEADLINE_OFFSETS = [7, 2, 0] as const;
export const EXAM_OFFSETS = [7, 1] as const;
export const SUBSCRIPTION_WARNING_DAYS = 3;
/** Data minimisation: in-app notifications are kept a year, the email log three months. */
export const RETENTION_DAYS = { notifications: 365, emailOutbox: 90 } as const;
const HOUR_S = 3600;
const DAY_MS = 86_400_000;

/**
 * Scheduled notifications. Every handler is a thin wrapper (CRON_ENABLED switch + no overlapping runs) around a public
 * `run*` method that tests and admin tools can call directly. All dedupe keys carry the date they are about, so a
 * re-run (or a second API instance) never sends the same reminder twice, while a moved deadline gets fresh reminders.
 */
@Injectable()
export class NotificationsCron {
  private readonly logger = new Logger('NotificationsCron');
  private readonly running = new Set<string>();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly alerts: AlertsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Schedules ─────────────

  @Cron('0 * * * *', { name: 'notifications-alert-matching', timeZone: TUNIS_TZ })
  async hourlyAlertMatching(): Promise<void> {
    const { hour } = tunisParts();
    if (hour < ALERT_HOURS.from || hour > ALERT_HOURS.to) return;
    await this.exclusive('alert-matching', () => this.runPendingAlerts());
  }

  @Cron('0 8 * * *', { name: 'notifications-daily-reminders', timeZone: TUNIS_TZ })
  async dailyReminders(): Promise<void> {
    await this.exclusive('daily-reminders', async () => {
      const today = tunisParts().date;
      await this.runRegistrationOpens(today);
      await this.runDeadlineReminders(today);
      await this.runExamReminders(today);
      await this.runSubscriptionEndingSoon();
    });
  }

  @Cron('2 * * * *', { name: 'notifications-study-reminders', timeZone: TUNIS_TZ })
  async hourlyStudyReminders(): Promise<void> {
    await this.exclusive('study-reminders', () => this.runStudyReminders());
  }

  @Cron('0 20 * * *', { name: 'notifications-streak-at-risk', timeZone: TUNIS_TZ })
  async eveningStreakAtRisk(): Promise<void> {
    await this.exclusive('streak-at-risk', () => this.runStreakAtRisk());
  }

  @Cron('0 1 * * *', { name: 'notifications-subscriptions', timeZone: TUNIS_TZ })
  async nightlySubscriptions(): Promise<void> {
    await this.exclusive('subscriptions', async () => {
      await this.runSubscriptionExpiry();
      await this.runCleanup();
    });
  }

  /** Sunday 18:00: weekly recap for users who practised during the week. */
  @Cron('0 18 * * 0', { name: 'notifications-weekly-digest', timeZone: TUNIS_TZ })
  async sundayDigest(): Promise<void> {
    await this.exclusive('weekly-digest', () => this.runWeeklyDigest());
  }

  // ───────────── Jobs ─────────────

  /** Concours alerts for every announceable edition whose alerts were never sent. */
  async runPendingAlerts(): Promise<{ competitions: number; notified: number }> {
    const pending = await this.alerts.loadContexts(isNull(competitions.alertsSentAt));
    let notified = 0;
    for (const ctx of pending) {
      try {
        notified += (await this.alerts.matchCompetition(ctx.id)).notified;
      } catch (e) {
        this.logger.error(`alert matching for ${ctx.id} failed: ${errorMessage(e)}`);
      }
    }
    return { competitions: pending.length, notified };
  }

  /** DEADLINE_REMINDER at D-7, D-2 and D-0 of the registration deadline, for followed/enrolled families. */
  async runDeadlineReminders(today = tunisParts().date): Promise<number> {
    const dates = DEADLINE_OFFSETS.map((d) => addDaysIso(today, d));
    const contexts = await this.alerts.loadContexts(inArray(competitions.registrationDeadline, dates));
    let sent = 0;
    for (const ctx of contexts) {
      const deadline = ctx.edition.registrationDeadline as string;
      const daysLeft = diffDaysIso(today, deadline);
      sent += await this.toFollowers(ctx, false, (l) => deadlineMessage(l, ctx.edition, daysLeft), {
        type: 'DEADLINE_REMINDER',
        dedupeKey: `deadline:${ctx.id}:${deadline}:D${daysLeft}`,
        pushUrgency: daysLeft <= 2 ? 'high' : 'normal',
        pushTtlSeconds: daysLeft === 0 ? 12 * HOUR_S : 24 * HOUR_S,
      });
    }
    return sent;
  }

  /** EXAM_REMINDER at D-7 and D-1 of the exam date (announced, open or closed editions — not mere estimates). */
  async runExamReminders(today = tunisParts().date): Promise<number> {
    const dates = EXAM_OFFSETS.map((d) => addDaysIso(today, d));
    const contexts = await this.alerts.loadContexts(
      and(inArray(competitions.examDate, dates), inArray(competitions.status, ['ANNOUNCED', 'OPEN', 'CLOSED'])),
      { anyStatus: true },
    );
    let sent = 0;
    for (const ctx of contexts) {
      const examDate = ctx.edition.examDate as string;
      const daysLeft = diffDaysIso(today, examDate);
      sent += await this.toFollowers(ctx, false, (l) => examMessage(l, ctx.edition, daysLeft), {
        type: 'EXAM_REMINDER',
        dedupeKey: `exam:${ctx.id}:${examDate}:D${daysLeft}`,
        pushTtlSeconds: 24 * HOUR_S,
      });
    }
    return sent;
  }

  /**
   * "Registration opens today" for editions announced on an earlier day: followers, enrolled users and users the edition
   * was matched to (they were told about it while registration was not open yet).
   */
  async runRegistrationOpens(today = tunisParts().date): Promise<number> {
    const contexts = await this.alerts.loadContexts(and(
      eq(competitions.registrationOpen, today),
      isNotNull(competitions.alertsSentAt),
      lt(competitions.alertsSentAt, tunisMidnightUtc(today)),
    ));
    let sent = 0;
    for (const ctx of contexts) {
      sent += await this.toFollowers(ctx, true, (l) => registrationOpensMessage(l, ctx.edition), {
        type: 'CONCOURS_UPDATE',
        dedupeKey: `opens:${ctx.id}:${today}`,
        pushUrgency: 'high',
      });
    }
    return sent;
  }

  /** STUDY_REMINDER for users whose daily_reminder_hour is the current Tunis hour and who have not practised today. */
  async runStudyReminders(now = new Date()): Promise<number> {
    const { date: today, hour } = tunisParts(now);
    let cursor = '00000000-0000-0000-0000-000000000000';
    let sent = 0;
    for (;;) {
      const res = await this.db.execute<{
        id: string; locale: string; streak_current: number | null; streak_freezes: number | null; last_active_date: string | null;
        family_name_ar: string | null; family_name_fr: string | null; exam_date: string | null;
      }>(sql`
        select u.id, u.locale, s.streak_current, s.streak_freezes, s.last_active_date::text as last_active_date,
               f.name_ar as family_name_ar, f.name_fr as family_name_fr, e.exam_date::text as exam_date
        from user_profiles p
        join users u on u.id = p.user_id
        left join user_stats s on s.user_id = u.id
        left join lateral (
          select en.family_id,
                 coalesce(
                   case when en.target_exam_date >= ${today}::date then en.target_exam_date end,
                   (select min(c.exam_date) from competitions c
                     where c.family_id = en.family_id and c.exam_date >= ${today}::date and c.content_status = 'PUBLISHED')
                 ) as exam_date
          from enrollments en
          where en.user_id = u.id
          order by en.is_primary desc, en.created_at desc
          limit 1
        ) e on true
        left join competition_families f on f.id = e.family_id
        where u.deleted_at is null
          and p.daily_reminder_hour = ${hour}
          and (s.last_active_date is null or s.last_active_date < ${today}::date)
          and u.id > ${cursor}::uuid
        order by u.id
        limit ${BATCH_SIZE}`);
      const rows = res.rows;
      if (!rows.length) break;
      const results = await mapLimit(rows, DELIVERY_CONCURRENCY, async (r) => {
        const l = asLocale(r.locale);
        const streak = displayedStreak(r.streak_current ?? 0, r.last_active_date, r.streak_freezes ?? 0, today);
        const msg = studyReminderMessage(l, {
          streak,
          familyName: l === 'ar' ? r.family_name_ar : r.family_name_fr,
          daysToExam: r.exam_date ? diffDaysIso(today, r.exam_date) : null,
        });
        return this.safeNotify(r.id, {
          type: 'STUDY_REMINDER', ...msg, url: '/app', dedupeKey: `study:${today}`,
          channels: ['IN_APP', 'PUSH'], pushTtlSeconds: 6 * HOUR_S,
        });
      });
      sent += results.filter(Boolean).length;
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    return sent;
  }

  /** STREAK_AT_RISK at 20:00 for streaks ≥ 3 days that today's inactivity would cost (a freeze or the streak). */
  async runStreakAtRisk(today = tunisParts().date): Promise<number> {
    const yesterday = addDaysIso(today, -1);
    const dayBefore = addDaysIso(today, -2);
    let cursor: string | null = null;
    let sent = 0;
    for (;;) {
      const rows: { id: string; locale: string; streak: number; freezes: number; lastActive: string | null }[] = await this.db
        .select({ id: users.id, locale: users.locale, streak: userStats.streakCurrent, freezes: userStats.streakFreezes, lastActive: userStats.lastActiveDate })
        .from(userStats)
        .innerJoin(users, eq(users.id, userStats.userId))
        .where(and(
          isNull(users.deletedAt),
          gte(userStats.streakCurrent, 3),
          or(eq(userStats.lastActiveDate, yesterday), and(eq(userStats.lastActiveDate, dayBefore), gt(userStats.streakFreezes, 0))),
          cursor ? gt(users.id, cursor) : undefined,
        ))
        .orderBy(asc(users.id))
        .limit(BATCH_SIZE);
      if (!rows.length) break;
      const results = await mapLimit(rows, DELIVERY_CONCURRENCY, (r) => {
        const msg = streakAtRiskMessage(asLocale(r.locale), { streak: r.streak, freezeWillBeUsed: r.lastActive === yesterday && r.freezes > 0 });
        return this.safeNotify(r.id, {
          type: 'STREAK_AT_RISK', ...msg, url: '/app', dedupeKey: `streak:${today}`,
          channels: ['IN_APP', 'PUSH'], pushTtlSeconds: 4 * HOUR_S, pushUrgency: 'high',
          data: { streak: r.streak },
        });
      });
      sent += results.filter(Boolean).length;
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    return sent;
  }

  /**
   * Marks ended subscriptions EXPIRED and tells users who have no other running subscription. Runs at night, so it goes
   * to the inbox and email only — no push.
   */
  async runSubscriptionExpiry(now = new Date()): Promise<{ expired: number; notified: number }> {
    const expired = await this.db
      .update(subscriptions)
      .set({ status: 'EXPIRED' })
      .where(and(eq(subscriptions.status, 'ACTIVE'), lt(subscriptions.endsAt, now)))
      .returning({ id: subscriptions.id, userId: subscriptions.userId });
    if (!expired.length) return { expired: 0, notified: 0 };

    const userIds = [...new Set(expired.map((s) => s.userId))];
    const stillPremium = new Set(
      (await this.db
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(and(inArray(subscriptions.userId, userIds), eq(subscriptions.status, 'ACTIVE'), gt(subscriptions.endsAt, now)))).map((r) => r.userId),
    );
    const locales = await this.localesOf(userIds);
    const lastByUser = new Map(expired.map((s) => [s.userId, s.id]));
    const results = await mapLimit([...lastByUser], DELIVERY_CONCURRENCY, ([userId, subId]) => {
      if (stillPremium.has(userId) || !locales.has(userId)) return Promise.resolve(false);
      return this.safeNotify(userId, {
        type: 'SUBSCRIPTION', ...subscriptionExpiredMessage(locales.get(userId) as Locale), url: '/app/billing',
        dedupeKey: `sub-expired:${subId}`, data: { subscriptionId: subId }, channels: ['IN_APP', 'EMAIL'],
      });
    });
    const notified = results.filter(Boolean).length;
    this.logger.log(`subscriptions expired: ${expired.length}, notified: ${notified}`);
    return { expired: expired.length, notified };
  }

  /** One heads-up when a user's last running subscription ends within 3 days. */
  async runSubscriptionEndingSoon(now = new Date()): Promise<number> {
    const horizon = new Date(now.getTime() + SUBSCRIPTION_WARNING_DAYS * 86_400_000);
    const ending = await this.db
      .select({ id: subscriptions.id, userId: subscriptions.userId, endsAt: subscriptions.endsAt })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(and(
        isNull(users.deletedAt),
        eq(subscriptions.status, 'ACTIVE'),
        gt(subscriptions.endsAt, now),
        lte(subscriptions.endsAt, horizon),
        sql`not exists (select 1 from ${subscriptions} later where later.user_id = ${subscriptions.userId}
              and later.status = 'ACTIVE' and later.ends_at > ${subscriptions.endsAt})`,
      ));
    if (!ending.length) return 0;
    const locales = await this.localesOf(ending.map((s) => s.userId));
    const results = await mapLimit(ending, DELIVERY_CONCURRENCY, (s) => {
      const l = locales.get(s.userId);
      if (!l) return Promise.resolve(false);
      const daysLeft = Math.max(1, Math.ceil((s.endsAt.getTime() - now.getTime()) / 86_400_000));
      return this.safeNotify(s.userId, {
        type: 'SUBSCRIPTION', ...subscriptionEndingMessage(l, daysLeft, tunisParts(s.endsAt).date), url: '/app/billing',
        dedupeKey: `sub-ending:${s.id}`, data: { subscriptionId: s.id, endsAt: s.endsAt.toISOString() },
      });
    });
    return results.filter(Boolean).length;
  }

  /**
   * Weekly recap (in-app, push and — if the user allows it — email) for users with XP in the last 7 days: questions,
   * XP, streak and the closest registration deadline among followed/enrolled families.
   */
  async runWeeklyDigest(now = new Date()): Promise<number> {
    const today = tunisParts(now).date;
    const since = new Date(now.getTime() - 7 * DAY_MS);
    let cursor = '00000000-0000-0000-0000-000000000000';
    let sent = 0;
    for (;;) {
      const res = await this.db.execute<{
        id: string; locale: string; xp: number; answered: number;
        streak_current: number | null; streak_freezes: number | null; last_active_date: string | null;
        next_name_ar: string | null; next_name_fr: string | null; next_deadline: string | null;
      }>(sql`
        select u.id, u.locale,
               (select coalesce(sum(x.amount), 0)::int from xp_events x where x.user_id = u.id and x.created_at >= ${since}) as xp,
               (select count(*)::int from attempt_answers aa join attempts a on a.id = aa.attempt_id
                 where a.user_id = u.id and aa.answered_at >= ${since}) as answered,
               s.streak_current, s.streak_freezes, s.last_active_date::text as last_active_date,
               nd.name_ar as next_name_ar, nd.name_fr as next_name_fr, nd.deadline::text as next_deadline
        from users u
        left join user_stats s on s.user_id = u.id
        left join lateral (
          select f.name_ar, f.name_fr, c.registration_deadline as deadline
          from competitions c join competition_families f on f.id = c.family_id
          where c.status in ('OPEN', 'ANNOUNCED') and c.content_status = 'PUBLISHED'
            and c.registration_deadline >= ${today}::date
            and (exists (select 1 from follows fo where fo.user_id = u.id and fo.family_id = c.family_id)
              or exists (select 1 from enrollments en where en.user_id = u.id and en.family_id = c.family_id))
          order by c.registration_deadline asc
          limit 1
        ) nd on true
        where u.deleted_at is null
          and exists (select 1 from xp_events x where x.user_id = u.id and x.created_at >= ${since})
          and u.id > ${cursor}::uuid
        order by u.id
        limit ${BATCH_SIZE}`);
      const rows = res.rows;
      if (!rows.length) break;
      const results = await mapLimit(rows, DELIVERY_CONCURRENCY, (r) => {
        if (Number(r.xp) <= 0) return Promise.resolve(false);
        const msg = weeklyDigestMessage(asLocale(r.locale), {
          xp: Number(r.xp),
          answered: Number(r.answered),
          streak: displayedStreak(r.streak_current ?? 0, r.last_active_date, r.streak_freezes ?? 0, today),
          nextDeadline: r.next_deadline && r.next_name_ar && r.next_name_fr
            ? { familyName_ar: r.next_name_ar, familyName_fr: r.next_name_fr, date: r.next_deadline }
            : null,
        });
        return this.safeNotify(r.id, {
          type: 'SYSTEM', ...msg, url: '/app', dedupeKey: `weekly:${today}`, pushTtlSeconds: 12 * HOUR_S,
          pushUrgency: 'low', data: { kind: 'WEEKLY_DIGEST', xp: Number(r.xp), answered: Number(r.answered) },
        });
      });
      sent += results.filter(Boolean).length;
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    return sent;
  }

  /** Deletes notifications older than a year and email log rows older than 90 days, in small batches. */
  async runCleanup(now = new Date()): Promise<{ notifications: number; emails: number }> {
    const purge = async (table: typeof notifications | typeof emailOutbox, before: Date): Promise<number> => {
      let total = 0;
      for (;;) {
        const res = await this.db.execute<{ n: number }>(sql`
          with doomed as (select id from ${table} where created_at < ${before} limit 5000),
               gone as (delete from ${table} where id in (select id from doomed) returning 1)
          select count(*)::int as n from gone`);
        const n = Number(res.rows[0]?.n ?? 0);
        total += n;
        if (n < 5000) return total;
      }
    };
    return {
      notifications: await purge(notifications, new Date(now.getTime() - RETENTION_DAYS.notifications * DAY_MS)),
      emails: await purge(emailOutbox, new Date(now.getTime() - RETENTION_DAYS.emailOutbox * DAY_MS)),
    };
  }

  // ───────────── Helpers ─────────────

  /** Sends a per-locale message to the users interested in an edition (one notifyMany per batch and locale). */
  private async toFollowers(
    ctx: CompetitionContext,
    includeMatched: boolean,
    message: (l: Locale) => Message,
    base: Omit<NotifyInput, 'title' | 'body'>,
  ): Promise<number> {
    let sent = 0;
    try {
      for await (const batch of this.alerts.interestedUsers(ctx.familyId, includeMatched ? ctx.id : undefined)) {
        for (const l of ['ar', 'fr'] as const) {
          const ids = batch.filter((u) => asLocale(u.locale) === l).map((u) => u.id);
          if (!ids.length) continue;
          sent += await this.notifications.notifyMany(ids, {
            url: `/concours/${ctx.familySlug}`,
            data: { competitionId: ctx.id, familySlug: ctx.familySlug },
            ...base,
            ...message(l),
          });
        }
      }
    } catch (e) {
      this.logger.error(`${base.type} for ${ctx.id} failed: ${errorMessage(e)}`);
    }
    return sent;
  }

  private async safeNotify(userId: string, input: NotifyInput): Promise<boolean> {
    try {
      return !!(await this.notifications.notify(userId, input));
    } catch (e) {
      this.logger.warn(`${input.type} for ${userId} failed: ${errorMessage(e)}`);
      return false;
    }
  }

  private async localesOf(userIds: string[]): Promise<Map<string, Locale>> {
    if (!userIds.length) return new Map();
    const rows = await this.db
      .select({ id: users.id, locale: users.locale })
      .from(users)
      .where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
    return new Map(rows.map((r) => [r.id, asLocale(r.locale)]));
  }

  /** CRON_ENABLED switch, no overlapping runs of the same job, and errors logged instead of crashing the scheduler. */
  private async exclusive(name: string, job: () => Promise<unknown>): Promise<void> {
    if (!env().CRON_ENABLED) return;
    if (this.running.has(name)) {
      this.logger.warn(`${name}: previous run still in progress, skipped`);
      return;
    }
    this.running.add(name);
    try {
      await job();
    } catch (e) {
      this.logger.error(`${name} failed: ${errorMessage(e)}`);
    } finally {
      this.running.delete(name);
    }
  }
}

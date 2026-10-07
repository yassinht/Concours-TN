import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import { users } from '../../db/schema';
import type { Tx } from './auth.util';

/**
 * Folds a guest account (diagnostic taken before signing in) into an existing registered account, then removes the guest.
 * Every statement is scoped to (guestId → targetId) and runs in one transaction, so a failure leaves both accounts intact.
 */
@Injectable()
export class GuestMergeService {
  private readonly logger = new Logger('GuestMerge');

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Merges `guestId` into `targetId` when `guestId` really is a guest row (never a registered account, whatever the JWT says).
   * Returns true when learning activity was moved.
   */
  async mergeGuestInto(guestId: string, targetId: string): Promise<boolean> {
    if (guestId === targetId) return false;
    const [guest] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, guestId), eq(users.isGuest, true)))
      .limit(1);
    if (!guest) return false;

    return this.db.transaction(async (tx) => {
      const active = await this.hasActivity(tx, guestId);
      if (active) await this.moveActivity(tx, guestId, targetId);
      await this.removeGuest(tx, guestId);
      return active;
    });
  }

  private async hasActivity(tx: Tx, g: string): Promise<boolean> {
    const r = await tx.execute<{ active: boolean }>(sql`
      select (
        exists (select 1 from attempts where user_id = ${g})
        or exists (select 1 from xp_events where user_id = ${g})
        or exists (select 1 from mastery where user_id = ${g})
        or exists (select 1 from user_question_state where user_id = ${g})
        or exists (select 1 from enrollments where user_id = ${g})
        or exists (select 1 from follows where user_id = ${g})
        or exists (select 1 from physical_logs where user_id = ${g})
        or exists (select 1 from user_document_checks where user_id = ${g})
        or exists (select 1 from push_subscriptions where user_id = ${g})
        or exists (select 1 from payments where user_id = ${g})
        or exists (select 1 from subscriptions where user_id = ${g})
        or exists (select 1 from user_profiles where user_id = ${g}
                   and (birth_date is not null or diploma_level is not null or gender is not null or cardinality(specialties) > 0))
      ) as active`);
    return !!r.rows[0]?.active;
  }

  private async moveActivity(tx: Tx, g: string, t: string): Promise<void> {
    // Attempts (attempt_answers follow through attempt_id) and plain per-user logs.
    await tx.execute(sql`update attempts set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update xp_events set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update weakness_events set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update physical_logs set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update question_reports set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update analytics_events set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update push_subscriptions set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update subscriptions set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update payments set user_id = ${t} where user_id = ${g}`);
    await tx.execute(sql`update referrals set referrer_id = ${t} where referrer_id = ${g}`);

    // Mastery: per topic keep the row backed by more attempts.
    await tx.execute(sql`
      delete from mastery m using mastery gm
      where m.user_id = ${t} and gm.user_id = ${g} and gm.node_id = m.node_id and gm.attempts > m.attempts`);
    await tx.execute(sql`
      update mastery set user_id = ${t}
      where user_id = ${g} and node_id not in (select node_id from mastery where user_id = ${t})`);

    // Mistakes notebook / spaced repetition: add counters, keep the most recent answer state, OR the bookmarks.
    await tx.execute(sql`
      insert into user_question_state (user_id, question_id, times_seen, times_wrong, last_correct, last_answered_at, next_review_at, bookmarked)
      select ${t}, question_id, times_seen, times_wrong, last_correct, last_answered_at, next_review_at, bookmarked
      from user_question_state where user_id = ${g}
      on conflict (user_id, question_id) do update set
        times_seen = user_question_state.times_seen + excluded.times_seen,
        times_wrong = user_question_state.times_wrong + excluded.times_wrong,
        bookmarked = user_question_state.bookmarked or excluded.bookmarked,
        last_correct = case when excluded.last_answered_at is not null
            and (user_question_state.last_answered_at is null or excluded.last_answered_at > user_question_state.last_answered_at)
          then excluded.last_correct else user_question_state.last_correct end,
        next_review_at = case when excluded.last_answered_at is not null
            and (user_question_state.last_answered_at is null or excluded.last_answered_at > user_question_state.last_answered_at)
          then excluded.next_review_at else user_question_state.next_review_at end,
        last_answered_at = greatest(user_question_state.last_answered_at, excluded.last_answered_at)`);

    // Gamification totals: sum XP and counters, keep the best streaks.
    await tx.execute(sql`insert into user_stats (user_id) values (${t}) on conflict (user_id) do nothing`);
    await tx.execute(sql`
      update user_stats ts set
        xp_total = ts.xp_total + gs.xp_total,
        streak_current = greatest(ts.streak_current, gs.streak_current),
        streak_longest = greatest(ts.streak_longest, gs.streak_longest),
        last_active_date = greatest(ts.last_active_date, gs.last_active_date),
        questions_answered = ts.questions_answered + gs.questions_answered,
        mistakes_fixed = ts.mistakes_fixed + gs.mistakes_fixed
      from user_stats gs
      where ts.user_id = ${t} and gs.user_id = ${g}`);
    await tx.execute(sql`
      insert into user_badges (user_id, code, created_at)
      select ${t}, code, created_at from user_badges where user_id = ${g}
      on conflict (user_id, code) do nothing`);

    // Free-tier usage keeps counting (signing in must not reset today's quota).
    await tx.execute(sql`
      insert into usage_counters (user_id, date, questions, tutor)
      select ${t}, date, questions, tutor from usage_counters where user_id = ${g}
      on conflict (user_id, date) do update set
        questions = usage_counters.questions + excluded.questions,
        tutor = usage_counters.tutor + excluded.tutor`);

    // Enrollments: the account's own enrollment wins per family; a moved one stays primary only if the account has none.
    await tx.execute(sql`
      update enrollments set user_id = ${t},
        is_primary = is_primary and not exists (select 1 from enrollments e2 where e2.user_id = ${t} and e2.is_primary)
      where user_id = ${g} and family_id not in (select family_id from enrollments where user_id = ${t})`);
    await tx.execute(sql`
      insert into follows (user_id, family_id, created_at)
      select ${t}, family_id, created_at from follows where user_id = ${g}
      on conflict (user_id, family_id) do nothing`);
    await tx.execute(sql`
      update study_plan_days set user_id = ${t}
      where user_id = ${g} and date not in (select date from study_plan_days where user_id = ${t})`);
    await tx.execute(sql`
      update readiness_snapshots r set user_id = ${t}
      where r.user_id = ${g} and not exists (
        select 1 from readiness_snapshots o where o.user_id = ${t} and o.family_id = r.family_id and o.date = r.date)`);
    await tx.execute(sql`
      insert into user_document_checks (user_id, fact_id, created_at)
      select ${t}, fact_id, created_at from user_document_checks where user_id = ${g}
      on conflict (user_id, fact_id) do nothing`);

    // Notifications & concours matches already computed for the guest.
    await tx.execute(sql`
      update notifications n set user_id = ${t}
      where n.user_id = ${g} and (n.dedupe_key is null or not exists (
        select 1 from notifications o where o.user_id = ${t} and o.dedupe_key = n.dedupe_key))`);
    await tx.execute(sql`
      update alert_matches a set user_id = ${t}
      where a.user_id = ${g} and not exists (
        select 1 from alert_matches o where o.user_id = ${t} and o.competition_id = a.competition_id
          and o.position_id is not distinct from a.position_id)`);

    // Eligibility profile: fill only what the account has not set yet.
    await tx.execute(sql`insert into user_profiles (user_id) values (${t}) on conflict (user_id) do nothing`);
    await tx.execute(sql`
      update user_profiles tp set
        birth_date = coalesce(tp.birth_date, gp.birth_date),
        gender = coalesce(tp.gender, gp.gender),
        diploma_level = coalesce(tp.diploma_level, gp.diploma_level),
        specialties = case when cardinality(tp.specialties) = 0 then gp.specialties else tp.specialties end,
        governorate = coalesce(tp.governorate, gp.governorate),
        height_cm = coalesce(tp.height_cm, gp.height_cm),
        marital_status = coalesce(tp.marital_status, gp.marital_status),
        updated_at = now()
      from user_profiles gp
      where tp.user_id = ${t} and gp.user_id = ${g}`);
  }

  /** Hard-deletes the guest (cascades leftovers). Falls back to a soft delete if an unexpected FK still references it. */
  private async removeGuest(tx: Tx, g: string): Promise<void> {
    await tx.execute(sql`update audit_logs set actor_id = null where actor_id = ${g}`);
    try {
      await tx.transaction(async (sp) => {
        await sp.delete(users).where(and(eq(users.id, g), eq(users.isGuest, true)));
      });
    } catch (e) {
      this.logger.warn(`guest ${g} could not be hard-deleted, soft-deleting: ${e instanceof Error ? e.message : String(e)}`);
      await tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, g));
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { levelFromXp, type MeDTO } from '@ctn/shared';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import { attempts, enrollments, userProfiles, userStats, users } from '../../db/schema';
import { daysBetween, tunisToday } from '../../common/dates';
import { EntitlementsService } from '../billing/entitlements.service';
import { asLocale } from './auth.util';

const FREE_PREMIUM: MeDTO['premium'] = { active: false, planCode: null, endsAt: null };
const LAST_ACTIVE_THROTTLE = sql`interval '10 minutes'`;

export type UserRow = typeof users.$inferSelect;

@Injectable()
export class MeService {
  private readonly logger = new Logger('MeService');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Active (not deleted) user row, or null. */
  async findActive(userId: string): Promise<UserRow | null> {
    const [u] = await this.db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
    return u ?? null;
  }

  /** MeDTO for an active user, or null when the account no longer exists / was deleted. */
  async build(userId: string): Promise<MeDTO | null> {
    const u = await this.findActive(userId);
    return u ? this.buildFor(u) : null;
  }

  async buildFor(u: UserRow): Promise<MeDTO> {
    const [premium, statsRow, profileRow, enrollmentRow, diagnosticRow] = await Promise.all([
      this.premium(u.id),
      this.db.select().from(userStats).where(eq(userStats.userId, u.id)).limit(1),
      this.db
        .select({ birthDate: userProfiles.birthDate, diplomaLevel: userProfiles.diplomaLevel })
        .from(userProfiles)
        .where(and(eq(userProfiles.userId, u.id), or(isNotNull(userProfiles.birthDate), isNotNull(userProfiles.diplomaLevel))))
        .limit(1),
      this.db.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.userId, u.id)).limit(1),
      this.db
        .select({ id: attempts.id })
        .from(attempts)
        .where(and(eq(attempts.userId, u.id), eq(attempts.kind, 'DIAGNOSTIC'), isNotNull(attempts.submittedAt)))
        .limit(1),
    ]);
    const s = statsRow[0];
    const xp = s?.xpTotal ?? 0;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isGuest: u.isGuest,
      locale: asLocale(u.locale),
      referralCode: u.referralCode,
      premium,
      stats: { xp, level: levelFromXp(xp).level, streak: s ? displayedStreak(s.streakCurrent, s.lastActiveDate, s.streakFreezes) : 0 },
      onboarding: {
        hasProfile: profileRow.length > 0,
        hasEnrollment: enrollmentRow.length > 0,
        diagnosticDone: diagnosticRow.length > 0,
      },
    };
  }

  /** Bumps users.last_active_at at most once every 10 minutes (single conditional UPDATE). */
  async touchLastActive(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(and(eq(users.id, userId), or(isNull(users.lastActiveAt), sql`${users.lastActiveAt} < now() - ${LAST_ACTIVE_THROTTLE}`)));
  }

  private async premium(userId: string): Promise<MeDTO['premium']> {
    try {
      const e = await this.entitlements.get(userId);
      if (!e?.premium) return FREE_PREMIUM;
      return { active: true, planCode: e.planCode ?? null, endsAt: e.endsAt ?? null };
    } catch (err) {
      // Billing may be unavailable (or not implemented yet): never block auth on it.
      this.logger.debug(`entitlements unavailable for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      return FREE_PREMIUM;
    }
  }
}

/**
 * user_stats.streak_current is only rewritten when the user is next active, so a streak that was broken days ago would
 * still show. Display 0 once the streak can no longer be continued (one missed day is forgiven when a freeze is left).
 */
export function displayedStreak(current: number, lastActiveDate: string | null, freezes: number, today = tunisToday()): number {
  if (!lastActiveDate || current <= 0) return 0;
  const gap = daysBetween(lastActiveDate, today);
  if (gap <= 1) return current;
  if (gap === 2 && freezes > 0) return current;
  return 0;
}

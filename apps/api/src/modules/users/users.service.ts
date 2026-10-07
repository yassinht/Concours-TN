import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  REFERRAL_REWARD_DAYS, type DiplomaLevel, type Field, type Gender, type NotificationChannel, type ProfileDTO, type ProfileInput,
} from '@ctn/shared';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import {
  alertMatches, analyticsEvents, attemptAnswers, attempts, authTokens, enrollments, follows, mastery, notifications, payments,
  physicalLogs, pushSubscriptions, questionReports, readinessSnapshots, referrals, studyPlanDays, subscriptions, usageCounters,
  userBadges, userDocumentChecks, userProfiles, userQuestionState, userStats, users, waitlist, weaknessEvents, xpEvents,
} from '../../db/schema';
import { AuditService } from '../../common/audit.service';
import { AlertsTrigger } from '../auth/alerts-trigger.service';
import { appUrl, asLocale, isRealIsoDate } from '../auth/auth.util';

type UserRow = typeof users.$inferSelect;
type ProfileRow = typeof userProfiles.$inferSelect;

const PHONE_RE = /^\+?[0-9][0-9 ().-]{5,19}$/;

function validationError(path: string, message: string): BadRequestException {
  return new BadRequestException({ message: 'VALIDATION_FAILED', issues: [{ path: [path], message }] });
}

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** The profile fields that decide which concours a user is eligible for / alerted about. */
function matchingKey(p: ProfileDTO): string {
  return JSON.stringify([
    p.birthDate, p.gender, p.diplomaLevel, [...p.specialties].sort(), p.heightCm, p.maritalStatus, p.alertsEnabled, [...p.alertFields].sort(),
  ]);
}

export function toProfileDTO(u: Pick<UserRow, 'name' | 'email' | 'phone' | 'locale'>, p: ProfileRow | null): ProfileDTO {
  return {
    name: u.name,
    email: u.email,
    phone: u.phone,
    locale: asLocale(u.locale),
    birthDate: p?.birthDate ?? null,
    gender: (p?.gender as Gender | null) ?? null,
    diplomaLevel: (p?.diplomaLevel as DiplomaLevel | null) ?? null,
    specialties: p?.specialties ?? [],
    governorate: p?.governorate ?? null,
    heightCm: p?.heightCm ?? null,
    maritalStatus: (p?.maritalStatus as ProfileDTO['maritalStatus']) ?? null,
    alertsEnabled: p?.alertsEnabled ?? true,
    alertFields: (p?.alertFields ?? []) as Field[],
    alertChannels: (p?.alertChannels ?? ['IN_APP', 'PUSH', 'EMAIL']) as ProfileDTO['alertChannels'],
    dailyReminderHour: p?.dailyReminderHour ?? null,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly alerts: AlertsTrigger,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Profile ─────────────

  async getProfile(userId: string): Promise<ProfileDTO> {
    const [row] = await this.db
      .select({ user: users, profile: userProfiles })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!row) throw new UnauthorizedException('SESSION_REQUIRED');
    return toProfileDTO(row.user, row.profile);
  }

  /** Upserts the profile; re-runs concours alert matching when eligibility inputs or alert settings changed. */
  async updateProfile(userId: string, input: ProfileInput): Promise<ProfileDTO> {
    const before = await this.getProfile(userId);

    const userPatch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) userPatch.name = input.name.trim() || null;
    if (input.locale !== undefined) userPatch.locale = input.locale;
    if (input.phone !== undefined) userPatch.phone = this.cleanPhone(input.phone);

    const p: Partial<typeof userProfiles.$inferInsert> = {};
    if (input.birthDate !== undefined) p.birthDate = this.cleanBirthDate(input.birthDate);
    if (input.gender !== undefined) p.gender = input.gender;
    if (input.diplomaLevel !== undefined) p.diplomaLevel = input.diplomaLevel;
    if (input.specialties !== undefined) p.specialties = uniq(input.specialties.map((s) => s.trim()).filter(Boolean));
    if (input.governorate !== undefined) p.governorate = input.governorate?.trim() || null;
    if (input.heightCm !== undefined) p.heightCm = input.heightCm;
    if (input.maritalStatus !== undefined) p.maritalStatus = input.maritalStatus;
    if (input.alertsEnabled !== undefined) p.alertsEnabled = input.alertsEnabled;
    if (input.alertFields !== undefined) p.alertFields = uniq(input.alertFields);
    if (input.alertChannels !== undefined) {
      // In-app notifications are always delivered; keep the stored setting truthful.
      p.alertChannels = uniq<NotificationChannel>(['IN_APP', ...input.alertChannels]);
    }
    if (input.dailyReminderHour !== undefined) p.dailyReminderHour = input.dailyReminderHour;

    await this.db.transaction(async (tx) => {
      if (Object.keys(userPatch).length) await tx.update(users).set(userPatch).where(eq(users.id, userId));
      await tx
        .insert(userProfiles)
        .values({ userId, ...p })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { ...p, updatedAt: new Date() } });
    });

    const after = await this.getProfile(userId);
    if (after.alertsEnabled && matchingKey(before) !== matchingKey(after)) await this.alerts.run(userId, 'profile-update');
    return after;
  }

  private cleanPhone(phone: string | null): string | null {
    const v = phone?.trim().replace(/\s+/g, ' ') ?? '';
    if (!v) return null;
    if (!PHONE_RE.test(v)) throw validationError('phone', 'invalid phone number');
    return v;
  }

  private cleanBirthDate(birthDate: string | null): string | null {
    if (birthDate === null) return null;
    if (!isRealIsoDate(birthDate)) throw validationError('birthDate', 'invalid date');
    const year = Number(birthDate.slice(0, 4));
    const thisYear = new Date().getUTCFullYear();
    if (year < thisYear - 90 || year > thisYear - 10) throw validationError('birthDate', 'out of range');
    return birthDate;
  }

  // ───────────── Referral ─────────────

  async referral(userId: string) {
    const [u] = await this.db
      .select({ code: users.referralCode })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!u) throw new UnauthorizedException('SESSION_REQUIRED');
    const [c] = await this.db
      .select({ invited: count(), rewarded: count(referrals.rewardedAt) })
      .from(referrals)
      .where(eq(referrals.referrerId, userId));
    const rewarded = Number(c?.rewarded ?? 0);
    return {
      code: u.code,
      link: appUrl(`/register?ref=${encodeURIComponent(u.code)}`),
      invited: Number(c?.invited ?? 0),
      rewarded,
      /** Premium days granted to both sides per successful referral. */
      rewardDays: REFERRAL_REWARD_DAYS,
      earnedDays: rewarded * REFERRAL_REWARD_DAYS,
    };
  }

  // ───────────── Data export (right of access) ─────────────

  async exportData(userId: string) {
    const [u] = await this.db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
    if (!u) throw new UnauthorizedException('SESSION_REQUIRED');
    const { passwordHash: _ph, ...account } = u;

    const [
      profile, stats, enrollmentRows, followRows, attemptRows, masteryRows, questionStates, planDays, weaknesses, readiness, usage,
      xp, badges, documentChecks, physical, notificationRows, alertRows, pushRows, subscriptionRows, paymentRows, referralsMade,
      referredBy, reports, events, tokens,
    ] = await Promise.all([
      this.db.select().from(userProfiles).where(eq(userProfiles.userId, userId)),
      this.db.select().from(userStats).where(eq(userStats.userId, userId)),
      this.db.select().from(enrollments).where(eq(enrollments.userId, userId)),
      this.db.select().from(follows).where(eq(follows.userId, userId)),
      this.db.select().from(attempts).where(eq(attempts.userId, userId)),
      this.db.select().from(mastery).where(eq(mastery.userId, userId)),
      this.db.select().from(userQuestionState).where(eq(userQuestionState.userId, userId)),
      this.db.select().from(studyPlanDays).where(eq(studyPlanDays.userId, userId)),
      this.db.select().from(weaknessEvents).where(eq(weaknessEvents.userId, userId)),
      this.db.select().from(readinessSnapshots).where(eq(readinessSnapshots.userId, userId)),
      this.db.select().from(usageCounters).where(eq(usageCounters.userId, userId)),
      this.db.select().from(xpEvents).where(eq(xpEvents.userId, userId)),
      this.db.select().from(userBadges).where(eq(userBadges.userId, userId)),
      this.db.select().from(userDocumentChecks).where(eq(userDocumentChecks.userId, userId)),
      this.db.select().from(physicalLogs).where(eq(physicalLogs.userId, userId)),
      this.db.select().from(notifications).where(eq(notifications.userId, userId)),
      this.db.select().from(alertMatches).where(eq(alertMatches.userId, userId)),
      this.db
        .select({ endpoint: pushSubscriptions.endpoint, userAgent: pushSubscriptions.userAgent, createdAt: pushSubscriptions.createdAt })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId)),
      this.db.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
      this.db
        .select({
          id: payments.id, planId: payments.planId, amountMillimes: payments.amountMillimes, currency: payments.currency,
          provider: payments.provider, providerRef: payments.providerRef, status: payments.status, promoCode: payments.promoCode,
          manualReference: payments.manualReference, createdAt: payments.createdAt, paidAt: payments.paidAt,
        })
        .from(payments)
        .where(eq(payments.userId, userId)),
      // Other people's ids are not personal data of this user: only dates are exported.
      this.db.select({ createdAt: referrals.createdAt, rewardedAt: referrals.rewardedAt }).from(referrals).where(eq(referrals.referrerId, userId)),
      this.db.select({ createdAt: referrals.createdAt, rewardedAt: referrals.rewardedAt }).from(referrals).where(eq(referrals.referredId, userId)),
      this.db.select().from(questionReports).where(eq(questionReports.userId, userId)),
      this.db.select().from(analyticsEvents).where(eq(analyticsEvents.userId, userId)),
      this.db
        .select({ kind: authTokens.kind, createdAt: authTokens.createdAt, expiresAt: authTokens.expiresAt, usedAt: authTokens.usedAt })
        .from(authTokens)
        .where(eq(authTokens.userId, userId)),
    ]);

    const attemptIds = attemptRows.map((a) => a.id);
    const answers = attemptIds.length ? await this.db.select().from(attemptAnswers).where(inArray(attemptAnswers.attemptId, attemptIds)) : [];
    const answersByAttempt = new Map<string, (typeof answers)[number][]>();
    for (const a of answers) answersByAttempt.set(a.attemptId, [...(answersByAttempt.get(a.attemptId) ?? []), a]);

    const contacts = [u.email ? sql`lower(${waitlist.email}) = ${u.email.toLowerCase()}` : undefined, u.phone ? eq(waitlist.phone, u.phone) : undefined]
      .filter((c): c is NonNullable<typeof c> => !!c);
    const waitlistRows = contacts.length ? await this.db.select().from(waitlist).where(or(...contacts)) : [];

    return {
      format: 'concours-tn-export/v1',
      exportedAt: new Date().toISOString(),
      account,
      profile: profile[0] ?? null,
      stats: stats[0] ?? null,
      enrollments: enrollmentRows,
      follows: followRows,
      attempts: attemptRows.map((a) => ({ ...a, answers: answersByAttempt.get(a.id) ?? [] })),
      mastery: masteryRows,
      questionStates,
      studyPlanDays: planDays,
      weaknessEvents: weaknesses,
      readinessSnapshots: readiness,
      usageCounters: usage,
      xpEvents: xp,
      badges,
      documentChecks,
      physicalLogs: physical,
      notifications: notificationRows,
      alertMatches: alertRows,
      pushSubscriptions: pushRows,
      subscriptions: subscriptionRows,
      payments: paymentRows,
      referrals: { made: referralsMade, received: referredBy },
      questionReports: reports,
      analyticsEvents: events,
      authTokens: tokens,
      waitlist: waitlistRows,
    };
  }

  // ───────────── Account deletion ─────────────

  /**
   * Soft delete + anonymisation: personal identifiers and profile are wiped, delivery channels and reminders removed, so
   * the person is never contacted again. Anonymous learning data stays for question statistics; payments for accounting.
   */
  async deleteAccount(userId: string): Promise<{ ok: true }> {
    const [u] = await this.db
      .select({ id: users.id, email: users.email, phone: users.phone })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!u) throw new UnauthorizedException('SESSION_REQUIRED');

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ email: null, name: null, phone: null, passwordHash: null, googleSub: null, emailVerifiedAt: null, deletedAt: new Date() })
        .where(eq(users.id, userId));
      await tx
        .update(userProfiles)
        .set({
          birthDate: null, gender: null, diplomaLevel: null, specialties: [], governorate: null, heightCm: null, maritalStatus: null,
          alertsEnabled: false, alertFields: [], alertChannels: [], dailyReminderHour: null, updatedAt: new Date(),
        })
        .where(eq(userProfiles.userId, userId));
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
      await tx.delete(authTokens).where(eq(authTokens.userId, userId));
      await tx.delete(follows).where(eq(follows.userId, userId));
      await tx.delete(enrollments).where(eq(enrollments.userId, userId));
      await tx.delete(notifications).where(eq(notifications.userId, userId));
      await tx.delete(alertMatches).where(eq(alertMatches.userId, userId));
      await tx.delete(physicalLogs).where(eq(physicalLogs.userId, userId));
      await tx.delete(userDocumentChecks).where(eq(userDocumentChecks.userId, userId));
      if (u.email) await tx.delete(waitlist).where(sql`lower(${waitlist.email}) = ${u.email.toLowerCase()}`);
      if (u.phone) await tx.delete(waitlist).where(eq(waitlist.phone, u.phone));
    });
    await this.audit.log(userId, 'ACCOUNT_DELETED', 'user', userId);
    return { ok: true };
  }

  // ───────────── Email preferences ─────────────

  /** Removes EMAIL from the user's notification channels (one-click unsubscribe). Idempotent. */
  async unsubscribeEmail(userId: string): Promise<boolean> {
    const updated = await this.db
      .update(userProfiles)
      .set({ alertChannels: sql`array_remove(${userProfiles.alertChannels}, 'EMAIL')`, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId))
      .returning({ userId: userProfiles.userId });
    return updated.length > 0;
  }
}

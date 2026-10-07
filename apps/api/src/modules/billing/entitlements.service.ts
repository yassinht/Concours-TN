import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { attempts, plans, usageCounters } from '../../db/schema';
import { FREE_ENTITLEMENT_LIMITS, MAX_GRANT_DAYS, limitsFromFeatures } from './billing.util';
import { currentSubscription, extendSubscription, type ExtendResult } from './subscription';

export interface Entitlements {
  premium: boolean;
  planCode: string | null;
  endsAt: string | null;
  limits: { questionsPerDay: number | null; tutorPerDay: number; mocksTotal: number | null; offline: boolean };
}

/**
 * CONTRACT (owned by the billing module):
 * - get(userId) → active subscription (status ACTIVE and ends_at > now) → plan features, else FREE limits (@ctn/shared FREE_LIMITS).
 * - consume(userId, kind, n=1) → checks & increments usage_counters for today (Africa/Tunis). Returns { allowed, remaining }.
 *   remaining = null when unlimited.
 * - canStartMock(userId) → free users get FREE_LIMITS.mocks_total submitted mocks in total.
 * - grantDays(userId, days, source, planCode='PREMIUM_MONTH') → extends/creates an ACTIVE subscription (referrals, admin grants).
 */
@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<Entitlements> {
    const sub = await currentSubscription(this.db, userId);
    if (!sub) return { premium: false, planCode: null, endsAt: null, limits: { ...FREE_ENTITLEMENT_LIMITS } };
    return {
      premium: true,
      planCode: sub.planCode,
      endsAt: sub.endsAt.toISOString(),
      limits: limitsFromFeatures(sub.planCode, sub.features),
    };
  }

  /**
   * Atomically spends `n` units of today's quota. The increment only happens when it stays within the limit, so two
   * concurrent answers can never both take the last free question. Unlimited plans are still counted (usage analytics).
   * `n = 0` peeks at the remaining quota without spending it.
   */
  async consume(userId: string, kind: 'questions' | 'tutor', n = 1): Promise<{ allowed: boolean; remaining: number | null }> {
    const amount = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1;
    const ent = await this.get(userId);
    const limit = kind === 'questions' ? ent.limits.questionsPerDay : ent.limits.tutorPerDay;
    const date = tunisToday();
    const column = kind === 'questions' ? usageCounters.questions : usageCounters.tutor;
    const initial = kind === 'questions' ? { userId, date, questions: amount } : { userId, date, tutor: amount };
    const bump = kind === 'questions' ? { questions: sql`${column} + ${amount}` } : { tutor: sql`${column} + ${amount}` };

    if (amount === 0) {
      const used = await this.usedToday(userId, kind, date);
      return { allowed: limit == null || used < limit, remaining: limit == null ? null : Math.max(0, limit - used) };
    }

    if (limit == null) {
      await this.db
        .insert(usageCounters)
        .values(initial)
        .onConflictDoUpdate({ target: [usageCounters.userId, usageCounters.date], set: bump });
      return { allowed: true, remaining: null };
    }

    if (amount > limit) {
      const used = await this.usedToday(userId, kind, date);
      return { allowed: false, remaining: Math.max(0, limit - used) };
    }

    const rows = await this.db
      .insert(usageCounters)
      .values(initial)
      .onConflictDoUpdate({
        target: [usageCounters.userId, usageCounters.date],
        set: bump,
        setWhere: sql`${column} + ${amount} <= ${limit}`,
      })
      .returning({ questions: usageCounters.questions, tutor: usageCounters.tutor });

    if (!rows.length) {
      const used = await this.usedToday(userId, kind, date);
      return { allowed: false, remaining: Math.max(0, limit - used) };
    }
    return { allowed: true, remaining: Math.max(0, limit - rows[0][kind]) };
  }

  async canStartMock(userId: string): Promise<boolean> {
    const ent = await this.get(userId);
    const limit = ent.limits.mocksTotal;
    if (limit == null) return true;
    const [row] = await this.db
      .select({ n: count() })
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.kind, 'MOCK'), isNotNull(attempts.submittedAt)));
    return Number(row?.n ?? 0) < limit;
  }

  async grantDays(userId: string, days: number, source: string, planCode = 'PREMIUM_MONTH'): Promise<void> {
    await this.grant(userId, days, source, planCode);
  }

  /** grantDays with the resulting period, for callers (admin, referral UI) that want to show "premium until …". */
  async grant(userId: string, days: number, source: string, planCode = 'PREMIUM_MONTH', actorId: string | null = null): Promise<ExtendResult> {
    if (!Number.isInteger(days) || days <= 0 || days > MAX_GRANT_DAYS) throw new BadRequestException('INVALID_DAYS');
    const [plan] = await this.db
      .select({ id: plans.id, code: plans.code, features: plans.features, priceMillimes: plans.priceMillimes, durationDays: plans.durationDays })
      .from(plans)
      .where(eq(plans.code, planCode))
      .limit(1);
    if (!plan || plan.code === 'FREE') throw new NotFoundException('PLAN_NOT_FOUND');

    const result = await this.db.transaction((tx) =>
      extendSubscription(tx, { userId, days, plan, source: source.slice(0, 40) || 'ADMIN_GRANT', keepCurrentPlan: true }),
    );
    try {
      await this.audit.log(actorId, 'subscription.grant', 'subscription', result.subscriptionId, {
        userId, days, source, planCode: result.planCode,
        previousEndsAt: result.previousEndsAt?.toISOString() ?? null, endsAt: result.endsAt.toISOString(),
      });
    } catch (e) {
      this.logger.error(`audit failed for grant to ${userId}: ${(e as Error).message}`);
    }
    return result;
  }

  private async usedToday(userId: string, kind: 'questions' | 'tutor', date: string): Promise<number> {
    const [row] = await this.db
      .select({ questions: usageCounters.questions, tutor: usageCounters.tutor })
      .from(usageCounters)
      .where(and(eq(usageCounters.userId, userId), eq(usageCounters.date, date)))
      .limit(1);
    return row ? row[kind] : 0;
  }
}

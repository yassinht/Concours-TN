import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { plans, subscriptions } from '../../db/schema';
import { addDays } from '../../common/dates';
import { planRank } from './billing.util';

/** A Drizzle transaction (same query API as the database handle). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

export interface PlanRef {
  id: string;
  code: string;
  features: unknown;
  priceMillimes: number;
}

export interface CurrentSubscription {
  id: string;
  planId: string;
  planCode: string;
  planNameAr: string;
  planNameFr: string;
  features: unknown;
  priceMillimes: number;
  status: string;
  source: string;
  startsAt: Date;
  endsAt: Date;
}

/** The running premium subscription (status ACTIVE, ends_at > now), latest end first. */
export async function currentSubscription(db: DbOrTx, userId: string, now = new Date()): Promise<CurrentSubscription | null> {
  const [row] = await db
    .select({
      id: subscriptions.id,
      planId: subscriptions.planId,
      planCode: plans.code,
      planNameAr: plans.nameAr,
      planNameFr: plans.nameFr,
      features: plans.features,
      priceMillimes: plans.priceMillimes,
      status: subscriptions.status,
      source: subscriptions.source,
      startsAt: subscriptions.startsAt,
      endsAt: subscriptions.endsAt,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'ACTIVE'), gt(subscriptions.endsAt, now)))
    .orderBy(desc(subscriptions.endsAt))
    .limit(1);
  return row ?? null;
}

export interface ExtendInput {
  userId: string;
  days: number;
  plan: PlanRef;
  /** PAYMENT | REFERRAL | ADMIN_GRANT | PROMO … */
  source: string;
  paymentId?: string | null;
  /** Grants (referrals, admin) keep the plan the user already has; purchases keep the more generous of the two. */
  keepCurrentPlan?: boolean;
}

export interface ExtendResult {
  subscriptionId: string;
  planId: string;
  planCode: string;
  startsAt: Date;
  endsAt: Date;
  previousEndsAt: Date | null;
}

/**
 * Creates or extends the user's premium time. Must run inside a transaction.
 *
 * Invariant: a user has at most one ACTIVE subscription with ends_at in the future, so every reader ("premium until",
 * expiry reminders, admin counts) can rely on `status = ACTIVE and ends_at > now` without stitching rows together.
 * Extending therefore closes the running row (EXPIRED, ends_at = now — it was superseded, not lost) and opens a new one
 * that starts now and ends at `previous end + days`. Each purchase keeps its own row (payment_id), so the history of
 * what was bought when stays auditable.
 *
 * A per-user advisory lock serialises concurrent grants/payments (webhook + return page + admin approval racing), so
 * two extensions can never both read the same "current end" and lose days or double-count.
 */
export async function extendSubscription(tx: Tx, input: ExtendInput, now = new Date()): Promise<ExtendResult> {
  if (!Number.isInteger(input.days) || input.days <= 0) throw new Error('INVALID_DAYS');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`subscription:${input.userId}`}, 0))`);

  const running = await tx
    .select({
      id: subscriptions.id,
      planId: subscriptions.planId,
      planCode: plans.code,
      features: plans.features,
      priceMillimes: plans.priceMillimes,
      endsAt: subscriptions.endsAt,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.userId, input.userId), eq(subscriptions.status, 'ACTIVE'), gt(subscriptions.endsAt, now)))
    .orderBy(desc(subscriptions.endsAt));

  const top = running[0] ?? null;
  const previousEndsAt = top ? top.endsAt : null;
  const base = previousEndsAt && previousEndsAt.getTime() > now.getTime() ? previousEndsAt : now;
  const endsAt = addDays(base, input.days);

  let plan = { id: input.plan.id, code: input.plan.code };
  if (top) {
    const keepTop = input.keepCurrentPlan || planRank(top.features, top.priceMillimes) > planRank(input.plan.features, input.plan.priceMillimes);
    if (keepTop) plan = { id: top.planId, code: top.planCode };
  }

  if (running.length) {
    await tx
      .update(subscriptions)
      .set({ status: 'EXPIRED', endsAt: now })
      .where(inArray(subscriptions.id, running.map((r) => r.id)));
  }

  const [created] = await tx
    .insert(subscriptions)
    .values({
      userId: input.userId,
      planId: plan.id,
      status: 'ACTIVE',
      startsAt: now,
      endsAt,
      source: input.source,
      paymentId: input.paymentId ?? null,
    })
    .returning({ id: subscriptions.id });

  return { subscriptionId: created.id, planId: plan.id, planCode: plan.code, startsAt: now, endsAt, previousEndsAt };
}

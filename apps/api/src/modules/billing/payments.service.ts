import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { formatTnd } from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { analyticsEvents, payments, plans, promoCodes, subscriptions, users } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { formatTunisDate, isUuid, pickLocale } from './billing.util';
import { extendSubscription, type ExtendResult } from './subscription';

type PaymentRow = typeof payments.$inferSelect;
type PlanRow = typeof plans.$inferSelect;

/**
 * CONTRACT (owned by the billing module, used by admin for manual payments):
 * - markPaid(paymentId, opts) → idempotent: sets payments.status=PAID, paid_at, provider_ref/raw when given, increments promo usage,
 *   creates/extends the ACTIVE subscription for the plan (extends from current ends_at if already premium), audits, and sends a
 *   SUBSCRIPTION notification. No-op when already PAID.
 * - markFailed(paymentId, reason?) → sets FAILED (no-op when PAID).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Idempotency: the payment row is locked (SELECT … FOR UPDATE) and only a PENDING or FAILED payment is turned into
   * PAID, all in one transaction with the subscription extension. Concurrent callers (provider webhook, browser return,
   * reconciliation job, admin) queue on the lock and the losers see PAID and do nothing, so days are never added twice.
   * A FAILED payment can still become PAID: when the provider confirms the money arrived, the customer gets the service.
   */
  async markPaid(paymentId: string, opts: { actorId?: string; providerRef?: string; raw?: unknown } = {}): Promise<void> {
    if (!isUuid(paymentId)) throw new NotFoundException('NOT_FOUND');

    const outcome = await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update').limit(1);
      if (!p) throw new NotFoundException('NOT_FOUND');
      if (p.status !== 'PENDING' && p.status !== 'FAILED') return { changed: false as const, payment: p };

      const [plan] = await tx.select().from(plans).where(eq(plans.id, p.planId)).limit(1);
      if (!plan || plan.durationDays <= 0) throw new Error(`payment ${p.id}: plan without duration`);

      const now = new Date();
      const [paid] = await tx
        .update(payments)
        .set({
          status: 'PAID',
          paidAt: now,
          ...(opts.providerRef ? { providerRef: opts.providerRef } : {}),
          ...(opts.raw !== undefined ? { raw: mergeRaw(p.raw, { verification: opts.raw }) } : {}),
        })
        .where(eq(payments.id, p.id))
        .returning();

      // Defence in depth: a subscription already opened for this payment is never opened twice.
      const [already] = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.paymentId, p.id)).limit(1);
      const ext = already
        ? null
        : await extendSubscription(tx, { userId: p.userId, days: plan.durationDays, plan, source: 'PAYMENT', paymentId: p.id }, now);

      if (p.promoCode) {
        await tx.update(promoCodes).set({ usedCount: sql`${promoCodes.usedCount} + 1` }).where(eq(promoCodes.code, p.promoCode));
      }
      return { changed: true as const, payment: paid, previousStatus: p.status, plan, ext };
    });

    if (!outcome.changed) {
      if (outcome.payment.status !== 'PAID') this.logger.warn(`markPaid ignored for ${paymentId}: status ${outcome.payment.status}`);
      return;
    }
    const { payment, plan, ext, previousStatus } = outcome;
    await this.safe('audit', () =>
      this.audit.log(opts.actorId ?? null, 'payment.paid', 'payment', payment.id, {
        userId: payment.userId,
        provider: payment.provider,
        providerRef: payment.providerRef,
        amountMillimes: payment.amountMillimes,
        planCode: plan.code,
        promoCode: payment.promoCode,
        previousStatus,
        subscriptionId: ext?.subscriptionId ?? null,
        previousEndsAt: ext?.previousEndsAt?.toISOString() ?? null,
        endsAt: ext?.endsAt.toISOString() ?? null,
      }),
    );
    await this.safe('analytics', () =>
      this.db.insert(analyticsEvents).values({
        userId: payment.userId,
        // Authoritative funnel event (provider-confirmed); the web app must not emit `paid` itself.
        name: 'paid',
        props: { source: 'server', planCode: plan.code, provider: payment.provider, amountMillimes: payment.amountMillimes, promo: !!payment.promoCode },
      }),
    );
    if (ext) await this.notifyPaid(payment, plan, ext);
  }

  async markFailed(paymentId: string, reason?: string): Promise<void> {
    if (!isUuid(paymentId)) throw new NotFoundException('NOT_FOUND');
    const why = (reason ?? 'FAILED').slice(0, 300);
    const [failed] = await this.db
      .update(payments)
      .set({ status: 'FAILED', raw: sql`${rawObject()} || ${JSON.stringify({ failureReason: why, failedAt: new Date().toISOString() })}::jsonb` })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING')))
      .returning();
    if (!failed) {
      const [exists] = await this.db.select({ id: payments.id }).from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (!exists) throw new NotFoundException('NOT_FOUND');
      return;
    }
    await this.safe('audit', () =>
      this.audit.log(null, 'payment.failed', 'payment', failed.id, { userId: failed.userId, provider: failed.provider, reason: why }),
    );
    // Only a submitted-then-rejected manual transfer needs the user's attention; abandoned checkouts are not worth a notification.
    if (failed.provider === 'MANUAL' && failed.manualReference) await this.notifyManualRejected(failed, why);
  }

  private async notifyPaid(payment: PaymentRow, plan: PlanRow, ext: ExtendResult): Promise<void> {
    if (!this.notifications) return;
    const locale = await this.localeOf(payment.userId);
    const until = formatTunisDate(ext.endsAt);
    const amount = formatTnd(payment.amountMillimes, locale);
    const ref = payment.id.slice(0, 8).toUpperCase();
    const text = locale === 'fr'
      ? {
          title: 'Premium activé',
          body: `${plan.nameFr} : paiement de ${amount} TTC reçu (réf. ${ref}). Votre accès Premium est actif jusqu’au ${until}. Bonne préparation !`,
        }
      : {
          title: 'تم تفعيل بريميوم',
          body: `${plan.nameAr}: تم استلام دفعتك بقيمة ${amount} (بكل الأداءات، مرجع ${ref}). اشتراكك بريميوم مفعّل حتى ${until}. بالتوفيق في التحضير!`,
        };
    await this.safe('notify', () =>
      this.notifications!.notify(payment.userId, {
        type: 'SUBSCRIPTION',
        ...text,
        url: '/app/billing',
        data: {
          paymentId: payment.id, planCode: plan.code, amountMillimes: payment.amountMillimes, endsAt: ext.endsAt.toISOString(),
          provider: payment.provider,
        },
        dedupeKey: `payment:${payment.id}`,
        // A payment confirmation is transactional: it is always worth an email receipt.
        channels: ['IN_APP', 'PUSH', 'EMAIL'],
      }),
    );
  }

  private async notifyManualRejected(payment: PaymentRow, reason: string): Promise<void> {
    if (!this.notifications) return;
    const locale = await this.localeOf(payment.userId);
    const ref = payment.id.slice(0, 8).toUpperCase();
    const text = locale === 'fr'
      ? {
          title: 'Paiement non validé',
          body: `Nous n’avons pas pu valider votre paiement manuel (réf. ${ref}). Vérifiez le numéro d’opération ou contactez-nous ; aucun accès n’a été retiré.`,
        }
      : {
          title: 'لم يتم تأكيد الدفع',
          body: `لم نتمكن من التحقق من دفعتك اليدوية (مرجع ${ref}). تثبّت من رقم العملية أو تواصل معنا.`,
        };
    await this.safe('notify', () =>
      this.notifications!.notify(payment.userId, {
        type: 'SUBSCRIPTION',
        ...text,
        url: '/app/billing',
        data: { paymentId: payment.id, reason },
        dedupeKey: `payment-failed:${payment.id}`,
      }),
    );
  }

  private async localeOf(userId: string) {
    const [u] = await this.db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
    return pickLocale(u?.locale);
  }

  /** Side effects after the money is booked must never turn a successful payment into an error. */
  private async safe(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`${what} failed after payment change: ${(e as Error).message}`);
    }
  }
}

/** payments.raw as a JSON object (older rows may hold null). */
function rawObject() {
  return sql`(case when jsonb_typeof(${payments.raw}) = 'object' then ${payments.raw} else '{}'::jsonb end)`;
}

function mergeRaw(prev: unknown, add: Record<string, unknown>): Record<string, unknown> {
  const base = prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  return { ...base, ...add };
}

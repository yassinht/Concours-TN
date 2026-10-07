import { Injectable } from '@nestjs/common';

/**
 * CONTRACT (owned by the billing module, used by admin for manual payments):
 * - markPaid(paymentId, opts) → idempotent: sets payments.status=PAID, paid_at, provider_ref/raw when given, increments promo usage,
 *   creates/extends the ACTIVE subscription for the plan (extends from current ends_at if already premium), audits, and sends a
 *   SUBSCRIPTION notification. No-op when already PAID.
 * - markFailed(paymentId, reason?) → sets FAILED (no-op when PAID).
 */
@Injectable()
export class PaymentsService {
  async markPaid(_paymentId: string, _opts: { actorId?: string; providerRef?: string; raw?: unknown } = {}): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async markFailed(_paymentId: string, _reason?: string): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { env } from '../../config/env';
import { BillingService } from './billing.service';

/**
 * Payment reconciliation: webhooks get lost and users close the provider tab before the return redirect, so recent
 * KONNECT/FLOUCI checkouts are re-verified with the provider every 20 minutes, and checkouts that can no longer
 * complete are closed. Never extends a subscription twice (markPaid is idempotent).
 */
@Injectable()
export class BillingJobs {
  private readonly logger = new Logger(BillingJobs.name);
  private running = false;

  constructor(private readonly billing: BillingService) {}

  @Cron('*/20 * * * *', { name: 'billing-reconcile', timeZone: 'Africa/Tunis' })
  async reconcile(): Promise<void> {
    if (!env().CRON_ENABLED || this.running) return;
    this.running = true;
    try {
      const r = await this.billing.reconcilePending();
      if (r.checked || r.expired) this.logger.log(`reconciled ${r.checked} checkouts: ${r.paid} paid, ${r.failed} failed, ${r.expired} closed`);
    } catch (e) {
      this.logger.error(`reconciliation failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

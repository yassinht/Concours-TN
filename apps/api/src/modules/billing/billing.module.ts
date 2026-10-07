import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingJobs } from './billing.jobs';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { PaymentsService } from './payments.service';
import { FlouciProvider } from './providers/flouci.provider';
import { KonnectProvider } from './providers/konnect.provider';
import { ManualProvider } from './providers/manual.provider';
import { MockProvider } from './providers/mock.provider';
import { PaymentProviders } from './providers/payment-providers.service';

/**
 * Billing module — see docs/api-contract.md for its endpoints.
 * Global: EntitlementsService (quotas, premium) and PaymentsService (admin approvals) are used across modules.
 */
@Global()
@Module({
  imports: [],
  controllers: [BillingController],
  providers: [
    EntitlementsService,
    PaymentsService,
    BillingService,
    BillingJobs,
    PaymentProviders,
    KonnectProvider,
    FlouciProvider,
    ManualProvider,
    MockProvider,
  ],
  exports: [EntitlementsService, PaymentsService, BillingService],
})
export class BillingModule {}

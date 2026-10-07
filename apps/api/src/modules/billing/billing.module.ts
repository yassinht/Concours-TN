import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';
import { PaymentsService } from './payments.service';

/** Billing module — see docs/api-contract.md for its endpoints. */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [EntitlementsService, PaymentsService],
  exports: [EntitlementsService, PaymentsService],
})
export class BillingModule {}

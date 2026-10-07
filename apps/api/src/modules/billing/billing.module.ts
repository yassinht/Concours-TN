import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';

/** Billing module — see docs/api-contract.md for its endpoints. */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class BillingModule {}

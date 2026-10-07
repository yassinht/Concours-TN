import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import { manualInstructions } from '../billing.util';
import type { CreatePaymentResult, PaymentProvider, ProviderPayment, ProviderUser, VerifyResult } from './payment-provider';

const PLACEHOLDER_D17 = 'XX XXX XXX';
const PLACEHOLDER_RIB = 'RIB à configurer';

/**
 * D17 / bank transfer. No redirect: the user pays outside the app, submits the operation number
 * (POST /billing/manual-proof) and an admin approves the payment (PaymentsService.markPaid).
 */
@Injectable()
export class ManualProvider implements PaymentProvider {
  readonly code = 'MANUAL' as const;

  /** In production the D17 number or RIB must be configured; placeholders are fine in development. */
  isAvailable(): boolean {
    const e = env();
    if (e.NODE_ENV !== 'production') return true;
    return (!!e.MANUAL_PAYMENT_D17_NUMBER && e.MANUAL_PAYMENT_D17_NUMBER !== PLACEHOLDER_D17)
      || (!!e.MANUAL_PAYMENT_RIB && e.MANUAL_PAYMENT_RIB !== PLACEHOLDER_RIB);
  }

  async createPayment(payment: ProviderPayment, _user: ProviderUser): Promise<CreatePaymentResult> {
    return { redirectUrl: null, providerRef: null, ...this.instructions(payment) };
  }

  instructions(payment: ProviderPayment): { instructions_ar: string; instructions_fr: string } {
    const e = env();
    return manualInstructions({
      amountMillimes: payment.amountMillimes,
      reference: payment.id,
      d17Number: e.MANUAL_PAYMENT_D17_NUMBER,
      rib: e.MANUAL_PAYMENT_RIB,
      planName_ar: payment.planName_ar,
      planName_fr: payment.planName_fr,
    });
  }

  /** Only a human (admin approval) can confirm a manual payment. */
  async verify(_providerRef: string): Promise<VerifyResult> {
    return { status: 'PENDING' };
  }
}

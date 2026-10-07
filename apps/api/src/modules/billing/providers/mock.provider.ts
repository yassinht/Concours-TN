import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import { joinUrl, type CreatePaymentResult, type PaymentProvider, type ProviderPayment, type ProviderUser, type VerifyResult } from './payment-provider';

/** Development-only provider: every checkout is paid instantly. Never available in production. */
@Injectable()
export class MockProvider implements PaymentProvider {
  readonly code = 'MOCK' as const;

  isAvailable(): boolean {
    const e = env();
    return e.PAYMENTS_MOCK_ENABLED && e.NODE_ENV !== 'production';
  }

  async createPayment(payment: ProviderPayment, _user: ProviderUser): Promise<CreatePaymentResult> {
    return {
      redirectUrl: joinUrl(env().APP_URL, `/app/billing/return?status=paid&paymentId=${payment.id}`),
      providerRef: `mock_${payment.id}`,
      raw: { mock: true },
    };
  }

  async verify(_providerRef: string): Promise<VerifyResult> {
    return { status: this.isAvailable() ? 'PAID' : 'PENDING' };
  }
}

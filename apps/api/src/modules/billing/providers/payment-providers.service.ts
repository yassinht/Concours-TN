import { BadRequestException, Injectable } from '@nestjs/common';
import { PAYMENT_PROVIDERS, type PaymentProvider as PaymentProviderCode } from '@ctn/shared';
import { FlouciProvider } from './flouci.provider';
import { KonnectProvider } from './konnect.provider';
import { ManualProvider } from './manual.provider';
import { MockProvider } from './mock.provider';
import type { PaymentProvider } from './payment-provider';

/** Registry of payment providers; the only place that knows which ones exist. */
@Injectable()
export class PaymentProviders {
  private readonly byCode: Record<PaymentProviderCode, PaymentProvider>;

  constructor(konnect: KonnectProvider, flouci: FlouciProvider, manual: ManualProvider, mock: MockProvider) {
    this.byCode = { KONNECT: konnect, FLOUCI: flouci, MANUAL: manual, MOCK: mock };
  }

  /** The provider, or 400 PROVIDER_UNAVAILABLE when it is not configured / not allowed here. */
  get(code: PaymentProviderCode): PaymentProvider {
    const p = this.byCode[code];
    if (!p || !p.isAvailable()) throw new BadRequestException('PROVIDER_UNAVAILABLE');
    return p;
  }

  /** The provider regardless of availability (to verify payments started before a configuration change). */
  raw(code: PaymentProviderCode): PaymentProvider {
    return this.byCode[code];
  }

  available(): { code: PaymentProviderCode; available: boolean }[] {
    return PAYMENT_PROVIDERS.map((code) => ({ code, available: this.byCode[code].isAvailable() }));
  }
}

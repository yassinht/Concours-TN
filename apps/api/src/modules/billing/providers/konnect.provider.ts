import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import { splitName } from '../billing.util';
import {
  ProviderError, asNumber, asRecord, asString, fetchJson, joinUrl,
  type CreatePaymentResult, type PaymentProvider, type ProviderPayment, type ProviderUser, type VerifyResult,
} from './payment-provider';

/**
 * Konnect (konnect.network) — wallet, bank card, e-DINAR and Flouci in one hosted page.
 *
 * IMPORTANT: the endpoint paths, body field names and status values below follow Konnect's v2 API as documented when
 * this was written. Re-check them against Konnect's current API documentation (and test in the sandbox) before going
 * live: a renamed field silently produces payments that never verify.
 */
@Injectable()
export class KonnectProvider implements PaymentProvider {
  readonly code = 'KONNECT' as const;

  isAvailable(): boolean {
    const e = env();
    return !!(e.KONNECT_API_KEY && e.KONNECT_WALLET_ID && e.KONNECT_API_URL);
  }

  async createPayment(payment: ProviderPayment, user: ProviderUser): Promise<CreatePaymentResult> {
    const e = env();
    const { firstName, lastName } = splitName(user.name);
    const returnUrl = joinUrl(e.API_PUBLIC_URL, `/billing/return?paymentId=${payment.id}`);
    // Field names: re-check against Konnect's current "init-payment" documentation before going live.
    const body: Record<string, unknown> = {
      receiverWalletId: e.KONNECT_WALLET_ID,
      token: 'TND',
      amount: payment.amountMillimes, // millimes for TND
      type: 'immediate',
      description: `Concours TN — ${payment.planName_fr}`.slice(0, 280),
      acceptedPaymentMethods: ['wallet', 'bank_card', 'e-DINAR', 'flouci'],
      lifespan: 30, // minutes
      checkoutForm: false,
      addPaymentFeesToAmount: false,
      firstName,
      lastName,
      email: user.email ?? undefined,
      orderId: payment.id,
      webhook: joinUrl(e.API_PUBLIC_URL, '/billing/webhooks/konnect'),
      // Where Konnect sends the browser afterwards; our /billing/return re-verifies before showing anything.
      successUrl: returnUrl,
      failUrl: returnUrl,
      theme: 'light',
    };
    if (user.phone) body.phoneNumber = user.phone.replace(/\D/g, '').slice(-8);

    const json = await fetchJson('KONNECT', joinUrl(e.KONNECT_API_URL, '/payments/init-payment'), {
      method: 'POST',
      headers: { 'x-api-key': e.KONNECT_API_KEY ?? '' },
      body,
    });
    const payUrl = asString(json.payUrl);
    const paymentRef = asString(json.paymentRef);
    if (!payUrl || !paymentRef) throw new ProviderError('KONNECT', 'init-payment response without payUrl/paymentRef', json);
    return { redirectUrl: payUrl, providerRef: paymentRef, raw: { init: { paymentRef, payUrl } } };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const e = env();
    // Response shape: { payment: { status, amount, orderId, … } } — re-check against Konnect's docs before going live.
    const json = await fetchJson('KONNECT', joinUrl(e.KONNECT_API_URL, `/payments/${encodeURIComponent(providerRef)}`), {
      method: 'GET',
      headers: e.KONNECT_API_KEY ? { 'x-api-key': e.KONNECT_API_KEY } : {},
    });
    const p = asRecord(json.payment);
    const status = asString(p.status)?.toLowerCase() ?? '';
    return {
      status: status === 'completed' ? 'PAID' : ['failed', 'expired', 'canceled', 'cancelled'].includes(status) ? 'FAILED' : 'PENDING',
      amountMillimes: asNumber(p.amount),
      orderId: asString(p.orderId),
      raw: { status: p.status ?? null, amount: p.amount ?? null, orderId: p.orderId ?? null, id: p.id ?? null },
    };
  }
}

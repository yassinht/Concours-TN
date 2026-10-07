import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import {
  ProviderError, asNumber, asRecord, asString, fetchJson, joinUrl,
  type CreatePaymentResult, type PaymentProvider, type ProviderPayment, type ProviderUser, type VerifyResult,
} from './payment-provider';

/**
 * Flouci (flouci.com) — Flouci wallet and bank cards.
 *
 * IMPORTANT: the endpoint paths, body/header names and status values below follow Flouci's developer API as
 * documented when this was written. Re-check them against Flouci's current documentation (and test with test keys)
 * before going live.
 */
@Injectable()
export class FlouciProvider implements PaymentProvider {
  readonly code = 'FLOUCI' as const;

  isAvailable(): boolean {
    const e = env();
    return !!(e.FLOUCI_APP_TOKEN && e.FLOUCI_APP_SECRET && e.FLOUCI_API_URL);
  }

  async createPayment(payment: ProviderPayment, _user: ProviderUser): Promise<CreatePaymentResult> {
    const e = env();
    // Flouci appends its own `payment_id` to these links; /billing/return extracts our id and re-verifies anyway.
    const returnUrl = joinUrl(e.API_PUBLIC_URL, `/billing/return?paymentId=${payment.id}`);
    // Field names: re-check against Flouci's current "generate_payment" documentation before going live.
    const json = await fetchJson('FLOUCI', joinUrl(e.FLOUCI_API_URL, '/generate_payment'), {
      method: 'POST',
      body: {
        app_token: e.FLOUCI_APP_TOKEN,
        app_secret: e.FLOUCI_APP_SECRET,
        amount: String(payment.amountMillimes), // millimes; Flouci's examples send it as a string
        accept_card: 'true',
        session_timeout_secs: 1200,
        success_link: returnUrl,
        fail_link: returnUrl,
        developer_tracking_id: payment.id,
        webhook: joinUrl(e.API_PUBLIC_URL, '/billing/webhooks/flouci'),
      },
    });
    const result = asRecord(json.result);
    const link = asString(result.link);
    const paymentId = asString(result.payment_id);
    if (!link || !paymentId) throw new ProviderError('FLOUCI', 'generate_payment response without link/payment_id', json);
    return { redirectUrl: link, providerRef: paymentId, raw: { init: { payment_id: paymentId, link } } };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const e = env();
    // Headers and response shape { result: { status: 'SUCCESS' | 'PENDING' | 'FAILURE', … } }: re-check before going live.
    const json = await fetchJson('FLOUCI', joinUrl(e.FLOUCI_API_URL, `/verify_payment/${encodeURIComponent(providerRef)}`), {
      method: 'GET',
      headers: { apppublic: e.FLOUCI_APP_TOKEN ?? '', appsecret: e.FLOUCI_APP_SECRET ?? '' },
    });
    const result = asRecord(json.result);
    const status = asString(result.status)?.toUpperCase() ?? '';
    return {
      status: status === 'SUCCESS' ? 'PAID' : ['FAILURE', 'FAILED', 'EXPIRED', 'CANCELLED', 'CANCELED'].includes(status) ? 'FAILED' : 'PENDING',
      amountMillimes: asNumber(result.amount),
      orderId: asString(result.developer_tracking_id) ?? asString(asRecord(result.details).developer_tracking_id),
      raw: { status: result.status ?? null, amount: result.amount ?? null, success: json.success ?? null },
    };
  }
}

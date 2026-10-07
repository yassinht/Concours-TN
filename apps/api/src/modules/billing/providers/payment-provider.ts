import type { PaymentProvider as PaymentProviderCode } from '@ctn/shared';

/** The payment row a provider needs to start a checkout. */
export interface ProviderPayment {
  id: string;
  amountMillimes: number;
  planCode: string;
  planName_ar: string;
  planName_fr: string;
}

/** The payer, as far as the provider's payment page needs it. */
export interface ProviderUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  locale: 'ar' | 'fr';
}

export interface CreatePaymentResult {
  /** Where to send the browser; null for MANUAL (instructions instead). */
  redirectUrl: string | null;
  /** Provider-side identifier used to verify the payment later; null when the provider has none. */
  providerRef: string | null;
  instructions_ar?: string;
  instructions_fr?: string;
  /** Provider response kept on the payment row for support (never sent to the client). */
  raw?: unknown;
}

export type VerifiedStatus = 'PAID' | 'PENDING' | 'FAILED';

export interface VerifyResult {
  status: VerifiedStatus;
  /** Amount the provider says was paid, when it reports one (millimes). */
  amountMillimes?: number | null;
  /** Our payment id as echoed by the provider, when it reports one. */
  orderId?: string | null;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  /** False when the provider is not configured (missing keys) or disabled in this environment. */
  isAvailable(): boolean;
  createPayment(payment: ProviderPayment, user: ProviderUser): Promise<CreatePaymentResult>;
  /** Asks the provider for the real status. Webhooks and return URLs are never trusted on their own. */
  verify(providerRef: string): Promise<VerifyResult>;
}

/** Raised when a provider's API answers with an error or something we cannot interpret. */
export class ProviderError extends Error {
  constructor(
    readonly provider: PaymentProviderCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(`${provider}: ${message}`);
  }
}

const TIMEOUT_MS = 15_000;

/** JSON over HTTPS with a timeout; non-2xx and non-JSON answers become ProviderError. */
export async function fetchJson(
  provider: PaymentProviderCode,
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ProviderError(provider, `network error: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ProviderError(provider, `invalid JSON (HTTP ${res.status})`, text.slice(0, 500));
  }
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, json);
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ProviderError(provider, 'unexpected response shape', json);
  return json as Record<string, unknown>;
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Joins a base URL and a path without doubling or dropping the slash. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

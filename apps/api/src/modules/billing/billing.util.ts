import { FREE_LIMITS, PLANS, formatTnd, type Locale } from '@ctn/shared';
import type { Entitlements } from './entitlements.service';

/** Most days a single grant or purchase may add (guards against typos in admin grants). */
export const MAX_GRANT_DAYS = 3650;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && v.length === 36 && UUID_RE.test(v);
}

/**
 * First UUID found at the start of a query value. Providers append their own parameters to our return URL with `?`
 * (e.g. `paymentId=<uuid>?payment_id=…`), so the raw value cannot be trusted to be a clean UUID.
 */
export function extractUuid(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(UUID_RE);
  return m && m.index === 0 ? m[0].toLowerCase() : null;
}

/** Promo codes are case-insensitive and stored upper-case. */
export function normalizePromo(code: string): string {
  return code.trim().toUpperCase();
}

/** Discounted price in whole millimes (never negative, percent clamped to 0..100). */
export function discountedAmount(priceMillimes: number, percentOff: number): number {
  const pct = Math.min(100, Math.max(0, Math.floor(percentOff)));
  return Math.max(0, Math.round((priceMillimes * (100 - pct)) / 100));
}

export type PromoRejection = 'NOT_FOUND' | 'INACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'ALREADY_USED' | 'NOT_APPLICABLE';

export interface PromoRow {
  code: string;
  percentOff: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  active: boolean;
}

/** Why a promo cannot be used right now, or null when it can. */
export function promoRejection(p: PromoRow | null | undefined, now = new Date()): PromoRejection | null {
  if (!p) return 'NOT_FOUND';
  if (!p.active || p.percentOff <= 0) return 'INACTIVE';
  if (p.expiresAt && p.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (p.maxUses != null && p.usedCount >= p.maxUses) return 'EXHAUSTED';
  return null;
}

/** Splits a display name into the first/last name pair payment pages ask for. */
export function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Client', lastName: 'Concours TN' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

type Features = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Plan features (jsonb, editable by admins) → entitlement limits, falling back to the shared catalogue per key. */
export function limitsFromFeatures(planCode: string, features: unknown): Entitlements['limits'] {
  const f = (features && typeof features === 'object' ? features : {}) as Features;
  const fallback = (PLANS.find((p) => p.code === planCode)?.features ?? PLANS[1].features) as Features;
  const pick = (key: string): unknown => (key in f ? f[key] : fallback[key]);
  const tutor = num(pick('tutor_per_day'));
  return {
    questionsPerDay: num(pick('questions_per_day')),
    tutorPerDay: tutor ?? num(fallback.tutor_per_day) ?? FREE_LIMITS.tutor_per_day,
    mocksTotal: num(pick('mocks_total')),
    offline: pick('offline') === true,
  };
}

export const FREE_ENTITLEMENT_LIMITS: Entitlements['limits'] = {
  questionsPerDay: FREE_LIMITS.questions_per_day,
  tutorPerDay: FREE_LIMITS.tutor_per_day,
  mocksTotal: FREE_LIMITS.mocks_total,
  offline: FREE_LIMITS.offline,
};

/**
 * How generous a plan is, used to decide which plan an extended subscription keeps (a user on the exam pass who
 * buys a month on top must not lose the pass's higher tutor quota for the remaining time).
 */
export function planRank(features: unknown, priceMillimes: number): number {
  const l = limitsFromFeatures('', features);
  const unlimited = (v: number | null) => (v == null ? 1 : 0);
  return (
    unlimited(l.questionsPerDay) * 1e12 +
    unlimited(l.mocksTotal) * 1e11 +
    (l.offline ? 1e10 : 0) +
    Math.min(l.tutorPerDay, 9999) * 1e6 +
    Math.min(priceMillimes, 999_999)
  );
}

/** dd/mm/yyyy in Africa/Tunis (Western digits, as used on Tunisian official documents). */
export function formatTunisDate(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function pickLocale(v: unknown): Locale {
  return v === 'fr' ? 'fr' : 'ar';
}

export interface ManualInstructionsInput {
  amountMillimes: number;
  reference: string;
  d17Number: string;
  rib: string;
  planName_ar: string;
  planName_fr: string;
}

/** Bank transfer / D17 instructions shown after a MANUAL checkout and again on /billing/me while pending. */
export function manualInstructions(i: ManualInstructionsInput): { instructions_ar: string; instructions_fr: string } {
  const ar = formatTnd(i.amountMillimes, 'ar');
  const fr = formatTnd(i.amountMillimes, 'fr');
  return {
    instructions_ar: [
      `للاشتراك في «${i.planName_ar}»، ادفع ${ar} (المبلغ بكل الأداءات) بإحدى الطريقتين:`,
      `• عبر تطبيق D17 إلى الرقم: ${i.d17Number}`,
      `• بتحويل بنكي إلى الحساب (RIB): ${i.rib}`,
      `اكتب مرجع الدفع التالي في خانة الملاحظة: ${i.reference}`,
      'بعد الدفع، أدخل رقم العملية (أو مرجع التحويل) في صفحة الاشتراك. يتم التفعيل بعد التحقق اليدوي، عادةً خلال 24 ساعة في أيام العمل.',
    ].join('\n'),
    instructions_fr: [
      `Pour souscrire à « ${i.planName_fr} », réglez ${fr} TTC par l’un de ces moyens :`,
      `• D17 au numéro : ${i.d17Number}`,
      `• Virement bancaire (RIB) : ${i.rib}`,
      `Indiquez cette référence de paiement dans le motif : ${i.reference}`,
      'Après le paiement, saisissez le numéro de l’opération (ou la référence du virement) sur la page abonnement. L’activation intervient après vérification manuelle, généralement sous 24 h ouvrées.',
    ].join('\n'),
  };
}

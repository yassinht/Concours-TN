/** Plans (prices in millimes: 1 TND = 1000 millimes). Seeded into the `plans` table. */
export const PLANS = [
  {
    code: 'FREE', name_ar: 'مجاني', name_fr: 'Gratuit', price_millimes: 0, period: 'NONE', duration_days: 0,
    features: { questions_per_day: 20, tutor_per_day: 3, mocks_total: 1, diagnostic: true, alerts: true, analytics: 'basic', offline: false },
  },
  {
    code: 'PREMIUM_MONTH', name_ar: 'بريميوم — شهر', name_fr: 'Premium — 1 mois', price_millimes: 19_000, period: 'MONTH', duration_days: 30,
    features: { questions_per_day: null, tutor_per_day: 50, mocks_total: null, diagnostic: true, alerts: true, analytics: 'full', offline: true },
  },
  {
    code: 'PREMIUM_QUARTER', name_ar: 'بريميوم — 3 أشهر', name_fr: 'Premium — 3 mois', price_millimes: 45_000, period: 'QUARTER', duration_days: 90,
    features: { questions_per_day: null, tutor_per_day: 50, mocks_total: null, diagnostic: true, alerts: true, analytics: 'full', offline: true },
  },
  {
    code: 'EXAM_PASS', name_ar: 'باس المناظرة (حتى يوم الامتحان، 6 أشهر كحد أقصى)', name_fr: 'Pass concours (jusqu’à l’examen, 6 mois max.)', price_millimes: 59_000, period: 'EXAM_PASS', duration_days: 180,
    features: { questions_per_day: null, tutor_per_day: 80, mocks_total: null, diagnostic: true, alerts: true, analytics: 'full', offline: true },
  },
] as const;

export type PlanCode = (typeof PLANS)[number]['code'];

export const FREE_LIMITS = PLANS[0].features;

/** Referral: both referrer and referred get this many premium days when the referred user completes the diagnostic. */
export const REFERRAL_REWARD_DAYS = 7;

export function formatTnd(millimes: number, locale: 'ar' | 'fr' = 'fr'): string {
  const v = (millimes / 1000).toFixed(millimes % 1000 === 0 ? 0 : 3);
  return locale === 'ar' ? `${v} د.ت` : `${v} DT`;
}

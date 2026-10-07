import type { Locale } from '@ctn/shared';

export const LOCALE_COOKIE = 'ctn_lang';
export const DEFAULT_LOCALE: Locale = 'ar';

/** Bilingual text. Prefer inline pairs over global dictionaries: `t(locale, { ar: '…', fr: '…' })`. */
export type Bi = { ar: string; fr: string };

export function t(locale: Locale, text: Bi): string {
  return text[locale] ?? text.ar;
}

/** Pick the right column of a bilingual DB row: pick(locale, row, 'name') → row.name_ar | row.name_fr */
export function pick<T extends Record<string, unknown>>(locale: Locale, row: T, base: string): string {
  return (row[`${base}_${locale}`] as string) ?? (row[`${base}_ar`] as string) ?? '';
}

export function dirOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function formatDate(locale: Locale, iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  // Latin digits in both locales (common usage in Tunisia)
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-TN', opts).format(d);
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

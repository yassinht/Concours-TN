import 'server-only';
import { cookies } from 'next/headers';
import type { Locale } from '@ctn/shared';
import { DEFAULT_LOCALE, LOCALE_COOKIE } from './i18n';

export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return c === 'fr' || c === 'ar' ? c : DEFAULT_LOCALE;
}

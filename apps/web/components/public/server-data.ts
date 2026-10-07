import 'server-only';
import type { Metadata } from 'next';
import type { Locale } from '@ctn/shared';
import { serverApi } from '@/lib/api-server';
import type { Bi } from '@/lib/i18n';

export type Loaded<T> = { data: T | null; error: boolean };

/**
 * Server-side read that never throws: public pages must still render (with an error/empty state)
 * when the API is down. `data === null` with `error === false` means 404.
 */
export async function load<T>(path: string, revalidate: number | false = 60): Promise<Loaded<T>> {
  try {
    return { data: await serverApi<T>(path, { revalidate }), error: false };
  } catch {
    return { data: null, error: true };
  }
}

const SITE = 'Concours TN';

/**
 * Bilingual SEO metadata: the title carries both languages (Tunisian searches mix Arabic and French),
 * current locale first; OpenGraph mirrors it.
 */
export function pageMetadata(locale: Locale, opts: { title: Bi; description: Bi; path: string; type?: 'website' | 'article'; noIndex?: boolean }): Metadata {
  const other: Locale = locale === 'ar' ? 'fr' : 'ar';
  const title = opts.title[locale] === opts.title[other] ? opts.title[locale] : `${opts.title[locale]} · ${opts.title[other]}`;
  const description = opts.description[locale];
  return {
    title,
    description,
    alternates: { canonical: opts.path },
    openGraph: {
      title,
      description,
      url: opts.path,
      siteName: SITE,
      type: opts.type ?? 'website',
      locale: locale === 'ar' ? 'ar_TN' : 'fr_TN',
      alternateLocale: [other === 'ar' ? 'ar_TN' : 'fr_TN'],
      images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: SITE }],
    },
    twitter: { card: 'summary', title, description },
    robots: opts.noIndex ? { index: false, follow: true } : undefined,
  };
}

/** Absolute URL for structured data / sharing (falls back to localhost in development). */
export function absoluteUrl(path: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}${path}`;
}

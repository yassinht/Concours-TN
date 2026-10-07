import type { MetadataRoute } from 'next';
import type { FamilySummaryDTO } from '@ctn/shared';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const revalidate = 3600;

const STATIC: { path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/concours', priority: 0.9, changeFrequency: 'daily' },
  { path: '/calendar', priority: 0.9, changeFrequency: 'daily' },
  { path: '/alerts', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/methodology', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/legal/privacy', priority: 0.2, changeFrequency: 'monthly' },
  { path: '/legal/terms', priority: 0.2, changeFrequency: 'monthly' },
];

/** Public pages + one page (and eligibility checker) per concours family. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let families: FamilySummaryDTO[] = [];
  try {
    const res = await fetch(`${API_URL}/catalog/families`, { next: { revalidate } });
    if (res.ok) families = (await res.json()) as FamilySummaryDTO[];
  } catch {
    families = [];
  }
  const now = new Date();
  return [
    ...STATIC.map((s) => ({ url: `${BASE}${s.path}`, lastModified: now, changeFrequency: s.changeFrequency, priority: s.priority })),
    ...families.flatMap((f) => [
      { url: `${BASE}/concours/${f.slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: f.nextEdition?.status === 'OPEN' ? 0.9 : 0.7 },
      { url: `${BASE}/concours/${f.slug}/eligibility`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.5 },
    ]),
  ];
}

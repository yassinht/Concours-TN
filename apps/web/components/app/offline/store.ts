/**
 * Offline packs in Cache Storage. One cache per family: "ctn-pack-<slug>", holding
 *  - "/api/offline/pack/<slug>"       the API response, verbatim (the service worker serves it cache-first), and
 *  - "/api/offline/pack/<slug>/meta"  { familyName_ar, familyName_fr, savedAt } for the list screen.
 * Local practice stats live in localStorage (they never leave the device).
 */
import type { QuestionDTO } from '@ctn/shared';
import { ApiError } from '@/lib/api';

export interface OfflineLesson {
  id: string; topicKey: string; topicTitle_ar: string; topicTitle_fr: string; language: string;
  title: string; bodyMd: string; estMinutes: number; unreviewed: boolean;
}
export interface OfflinePack { generatedAt: string; familySlug: string; questions: QuestionDTO[]; lessons: OfflineLesson[] }
export interface PackMeta { familyName_ar: string; familyName_fr: string; savedAt: string }
export interface PackSummary { slug: string; meta: PackMeta | null; generatedAt: string; questions: number; lessons: number; bytes: number }
export interface LocalStats { answered: number; correct: number; wrong: string[]; lastAt: string | null }

export const PACK_PREFIX = 'ctn-pack-';
const OFFLINE_PAGE = '/app/offline';
const packUrl = (slug: string) => `/api/offline/pack/${encodeURIComponent(slug)}`;
const metaUrl = (slug: string) => `${packUrl(slug)}/meta`;

export function cacheSupported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

export async function listPacks(): Promise<PackSummary[]> {
  if (!cacheSupported()) return [];
  const names = (await caches.keys()).filter((k) => k.startsWith(PACK_PREFIX));
  const out: PackSummary[] = [];
  for (const name of names) {
    const slug = name.slice(PACK_PREFIX.length);
    try {
      const cache = await caches.open(name);
      const res = await cache.match(packUrl(slug));
      if (!res) continue;
      const text = await res.text();
      const pack = JSON.parse(text) as OfflinePack;
      const metaRes = await cache.match(metaUrl(slug));
      const meta = metaRes ? ((await metaRes.json()) as PackMeta) : null;
      out.push({ slug, meta, generatedAt: pack.generatedAt, questions: pack.questions.length, lessons: pack.lessons.length, bytes: text.length * 2 });
    } catch {
      /* corrupted entry: ignored (can be deleted from the list) */
    }
  }
  return out.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function readPack(slug: string): Promise<OfflinePack | null> {
  if (!cacheSupported()) return null;
  const cache = await caches.open(`${PACK_PREFIX}${slug}`);
  const res = await cache.match(packUrl(slug));
  return res ? ((await res.json()) as OfflinePack) : null;
}

/**
 * Downloads (or refreshes) a pack. A cache-busting query bypasses the service worker's cache-first rule;
 * the response is then stored under the canonical URL. Throws ApiError (402 PREMIUM_REQUIRED for free plans).
 */
export async function downloadPack(slug: string, meta: Omit<PackMeta, 'savedAt'>): Promise<PackSummary> {
  const res = await fetch(`${packUrl(slug)}?fresh=${Date.now()}`, { credentials: 'include', cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) {
    let code = res.statusText || 'ERROR';
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === 'string') code = body.message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, res.status === 402 && code === 'Payment Required' ? 'PREMIUM_REQUIRED' : code, text);
  }
  const pack = JSON.parse(text) as OfflinePack;
  // Ask the browser not to evict our data under storage pressure (best effort, silently ignored when refused).
  await navigator.storage?.persist?.().catch(() => false);
  const cache = await caches.open(`${PACK_PREFIX}${slug}`);
  const savedAt = new Date().toISOString();
  await cache.put(packUrl(slug), new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  await cache.put(metaUrl(slug), new Response(JSON.stringify({ ...meta, savedAt } satisfies PackMeta), { headers: { 'Content-Type': 'application/json' } }));
  // Keep this page itself available offline: in-app navigations are client-side (never cached by the service worker),
  // and its navigation fallback looks the document up in every cache, pack caches included.
  await cache.add(new Request(OFFLINE_PAGE, { credentials: 'include' })).catch(() => undefined);
  return { slug, meta: { ...meta, savedAt }, generatedAt: pack.generatedAt, questions: pack.questions.length, lessons: pack.lessons.length, bytes: text.length * 2 };
}

export async function deletePack(slug: string): Promise<void> {
  if (!cacheSupported()) return;
  await caches.delete(`${PACK_PREFIX}${slug}`);
  try {
    localStorage.removeItem(statsKey(slug));
  } catch {
    /* ignore */
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

const statsKey = (slug: string) => `ctn_offline_stats_${slug}`;

export function readStats(slug: string): LocalStats {
  try {
    const raw = localStorage.getItem(statsKey(slug));
    if (raw) return JSON.parse(raw) as LocalStats;
  } catch {
    /* ignore */
  }
  return { answered: 0, correct: 0, wrong: [], lastAt: null };
}

export function recordAnswer(slug: string, questionId: string, correct: boolean): LocalStats {
  const s = readStats(slug);
  const wrong = new Set(s.wrong);
  if (correct) wrong.delete(questionId);
  else wrong.add(questionId);
  const next: LocalStats = { answered: s.answered + 1, correct: s.correct + (correct ? 1 : 0), wrong: [...wrong].slice(-500), lastAt: new Date().toISOString() };
  try {
    localStorage.setItem(statsKey(slug), JSON.stringify(next));
  } catch {
    /* storage full / unavailable: stats are a convenience */
  }
  return next;
}

export function formatBytes(n: number, locale: 'ar' | 'fr'): string {
  const mb = n / (1024 * 1024);
  const v = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  return locale === 'ar' ? v.replace('MB', 'م.ب').replace('KB', 'ك.ب') : v.replace('MB', 'Mo').replace('KB', 'Ko');
}

import { NOTIFICATION_CHANNELS, type Locale, type NotificationChannel } from '@ctn/shared';
import { env } from '../../config/env';

/** Mirrors the user_profiles.alert_channels column default (users without a profile row get the same). */
export const DEFAULT_CHANNELS: NotificationChannel[] = ['IN_APP', 'PUSH', 'EMAIL'];
export const BATCH_SIZE = 500;
/** Parallel deliveries (push/email are network-bound; keep the SMTP relay and push services happy). */
export const DELIVERY_CONCURRENCY = 8;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asLocale(v: string | null | undefined): Locale {
  return v === 'fr' ? 'fr' : 'ar';
}

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Delivery channels: IN_APP always; PUSH/EMAIL only when the user's preferences allow them AND the caller asked for
 * them (callers can narrow, never widen — a one-click email unsubscribe always wins).
 */
export function resolveChannels(userChannels: readonly string[] | null | undefined, requested?: readonly NotificationChannel[]): Set<NotificationChannel> {
  const prefs = new Set((userChannels ?? DEFAULT_CHANNELS).filter((c): c is NotificationChannel => (NOTIFICATION_CHANNELS as readonly string[]).includes(c)));
  const wanted = requested ? new Set(requested) : prefs;
  const out = new Set<NotificationChannel>(['IN_APP']);
  for (const c of ['PUSH', 'EMAIL'] as const) if (prefs.has(c) && wanted.has(c)) out.add(c);
  return out;
}

/** Same-site path ("/concours/x") or absolute http(s) URL; anything else (javascript:, //evil) is dropped. */
export function safeLink(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string' || url.length > 500) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(url)) return null;
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) return url;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Absolute link for emails: relative app paths are prefixed with APP_URL. */
export function absoluteLink(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith('/') ? `${env().APP_URL.replace(/\/+$/, '')}${url}` : url;
}

/** DD/MM/YYYY — the format used on Tunisian official notices, in both languages. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

interface ArabicNoun {
  /** يوم واحد */ one: string;
  /** يومان / يومين */ two: string; twoGenitive: string;
  /** 3–10: أيام */ few: string;
  /** 11–99: يومًا */ many: string;
  /** 100, 200…: يوم */ hundred: string;
}

/**
 * Arabic counted nouns with number agreement: 1 → "يوم واحد", 2 → "يومان" ("يومين" after a preposition such as بعد),
 * 3–10 → plural, 11–99 → accusative singular, round hundreds → genitive singular. The last two digits decide.
 */
export function countAr(n: number, noun: ArabicNoun, genitive = false): string {
  if (n === 1) return noun.one;
  if (n === 2) return genitive ? noun.twoGenitive : noun.two;
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} ${noun.few}`;
  if (r >= 11) return `${n} ${noun.many}`;
  return `${n} ${noun.hundred}`;
}

const DAY: ArabicNoun = { one: 'يوم واحد', two: 'يومان', twoGenitive: 'يومين', few: 'أيام', many: 'يومًا', hundred: 'يوم' };
const QUESTION: ArabicNoun = { one: 'سؤال واحد', two: 'سؤالان', twoGenitive: 'سؤالين', few: 'أسئلة', many: 'سؤالًا', hundred: 'سؤال' };

/** `genitive` after a preposition such as بعد: "بعد يومين", not "بعد يومان". */
export function daysAr(n: number, genitive = false): string {
  return countAr(n, DAY, genitive);
}

export function questionsAr(n: number): string {
  return countAr(n, QUESTION);
}

export function daysFr(n: number): string {
  return n === 1 ? '1 jour' : `${n} jours`;
}

export function errorMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

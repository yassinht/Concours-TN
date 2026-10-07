import { sql } from 'drizzle-orm';
import { CONFIDENCES, SOURCE_TYPES, type Confidence, type SourceType } from '@ctn/shared';
import { sources } from '../schema';
import { errorMessage, type SeedLog } from './log';
import { InvalidItem, arr, isHttpUrl, isObj, isoDate, oneOf, reqStr, str } from './normalize';
import type { Db } from './types';

export interface SourceRef {
  id: string;
  url: string | null;
  sourceType: SourceType;
}

export interface SourceInput {
  title: string;
  url: string | null;
  publisher: string | null;
  sourceType: SourceType;
  publicationDate: string | null;
  retrievedAt: string | null;
  confidence: Confidence;
  notes: string | null;
}

/** Idempotent upsert keyed by seed_key; last_verified_at is admin-managed and never touched here. */
export async function upsertSource(db: Db, seedKey: string, s: SourceInput): Promise<SourceRef> {
  const values = {
    title: s.title, url: s.url, publisher: s.publisher, sourceType: s.sourceType, publicationDate: s.publicationDate,
    retrievedAt: s.retrievedAt ? new Date(`${s.retrievedAt}T00:00:00Z`) : null, confidence: s.confidence, notes: s.notes,
  };
  const [row] = await db
    .insert(sources)
    .values({ seedKey, ...values })
    .onConflictDoUpdate({ target: sources.seedKey, targetWhere: sql`${sources.seedKey} is not null`, set: values })
    .returning({ id: sources.id });
  return { id: row.id, url: s.url, sourceType: s.sourceType };
}

function normalizeSource(raw: unknown, warn: (m: string) => void): SourceInput & { key: string } {
  if (!isObj(raw)) throw new InvalidItem('source is not an object');
  const key = reqStr(raw.key, 'key');
  const rawUrl = str(raw.url);
  const url = isHttpUrl(rawUrl) ? rawUrl : null;
  if (rawUrl && !url) warn(`source "${key}": invalid url ignored`);
  const title = str(raw.title) ?? url ?? key;
  return {
    key,
    title,
    url,
    publisher: str(raw.publisher),
    sourceType: oneOf<SourceType>(raw.source_type, SOURCE_TYPES, 'SUGGESTED', warn, `source_type of ${key}`),
    publicationDate: isoDate(raw.publication_date, warn, `publication_date of ${key}`),
    retrievedAt: isoDate(raw.retrieved_at, warn, `retrieved_at of ${key}`),
    confidence: oneOf<Confidence>(raw.confidence, CONFIDENCES, 'LOW', warn, `confidence of ${key}`),
    notes: str(raw.notes),
  };
}

/** Upserts a file's `sources[]` under the "<prefix>:<key>" seed key; returns key → ref. */
export async function upsertFileSources(db: Db, prefix: string, rawSources: unknown, log: SeedLog, ctx: string): Promise<Map<string, SourceRef>> {
  const warn = log.scoped(ctx);
  const map = new Map<string, SourceRef>();
  for (const raw of arr(rawSources)) {
    try {
      const s = normalizeSource(raw, warn);
      if (map.has(s.key)) throw new InvalidItem(`duplicate source key "${s.key}"`);
      map.set(s.key, await upsertSource(db, `${prefix}:${s.key}`, s));
      log.inc('upserted.sources');
    } catch (e) {
      if (!(e instanceof InvalidItem)) throw e;
      warn(`source skipped (${errorMessage(e)})`);
      log.inc('skipped.sources');
    }
  }
  return map;
}

/** Builds a resolver that warns once per unknown key. */
export function sourceResolver(map: Map<string, SourceRef>, log: SeedLog, ctx: string): (key: unknown) => SourceRef | null {
  const warned = new Set<string>();
  return (key) => {
    const k = str(key);
    if (!k) return null;
    const ref = map.get(k);
    if (!ref && !warned.has(k)) {
      warned.add(k);
      log.warn(ctx, `unknown source_key "${k}" (provenance left empty)`);
    }
    return ref ?? null;
  };
}

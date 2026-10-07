/**
 * Lenient normalizers for seed content produced by research agents.
 * Structural problems throw InvalidItem (the item is skipped); recoverable ones call `warn` and fall back.
 */
export class InvalidItem extends Error {}

type Warn = (msg: string) => void;

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

export function reqStr(v: unknown, field: string): string {
  const s = str(v);
  if (!s) throw new InvalidItem(`missing or empty "${field}"`);
  return s;
}

export function int(v: unknown, warn?: Warn, field = 'value'): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) {
    warn?.(`invalid integer for "${field}": ${JSON.stringify(v).slice(0, 40)}`);
    return null;
  }
  return Math.round(n);
}

export function num(v: unknown, warn?: Warn, field = 'value'): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim().replace(',', '.')) : NaN;
  if (!Number.isFinite(n)) {
    warn?.(`invalid number for "${field}": ${JSON.stringify(v).slice(0, 40)}`);
    return null;
  }
  return n;
}

/** Integer within [min, max], else null (with a warning). */
export function intIn(v: unknown, min: number, max: number, warn?: Warn, field = 'value'): number | null {
  const n = int(v, warn, field);
  if (n == null) return null;
  if (n < min || n > max) {
    warn?.(`"${field}" out of range [${min}, ${max}]: ${n}`);
    return null;
  }
  return n;
}

export function bool(v: unknown, dflt: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return dflt;
}

/** Valid calendar date as YYYY-MM-DD (accepts a datetime prefix), else null. */
export function isoDate(v: unknown, warn?: Warn, field = 'date'): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const candidate = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  const d = candidate ? new Date(`${candidate}T00:00:00Z`) : null;
  if (!candidate || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== candidate) {
    warn?.(`invalid ${field} "${s.slice(0, 30)}" ignored`);
    return null;
  }
  return candidate;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T, warn?: Warn, field = 'value'): T {
  const s = str(v)?.toUpperCase();
  if (s && (allowed as readonly string[]).includes(s)) return s as T;
  if (s) warn?.(`invalid ${field} "${s}", using ${fallback}`);
  return fallback;
}

export function oneOfOrNull<T extends string>(v: unknown, allowed: readonly T[], warn?: Warn, field = 'value'): T | null {
  const s = str(v)?.toUpperCase();
  if (!s) return null;
  if ((allowed as readonly string[]).includes(s)) return s as T;
  warn?.(`invalid ${field} "${s}" ignored`);
  return null;
}

export function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter((s): s is string => !!s);
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Bilingual pair where one side may be missing: falls back to the other side; throws when both are empty. */
export function bilingual(ar: unknown, fr: unknown, field: string): { ar: string; fr: string } {
  const a = str(ar);
  const f = str(fr);
  if (!a && !f) throw new InvalidItem(`missing "${field}_ar" and "${field}_fr"`);
  return { ar: a ?? f!, fr: f ?? a! };
}

export function isHttpUrl(v: string | null): v is string {
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

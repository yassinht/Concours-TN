/** Text helpers shared by document ingestion, fact extraction and the official-page watcher. Pure functions only. */
import { createHash } from 'node:crypto';

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → ASCII, so one regex handles every announcement. */
export function toAsciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Folding used for keyword matching only (never for quotes): lower case, Latin accents removed, Arabic hamza carriers
 * folded onto their base letter (NFKD + mark stripping), tashkeel and tatweel removed, ى→ي, ة→ه, digits to ASCII,
 * punctuation to spaces.
 */
export function foldForMatch(s: string): string {
  return toAsciiDigits(s)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ـ/g, '')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `needle` (already folded or not) occurs in `haystack` as whole word(s). */
export function containsWords(haystackFolded: string, needle: string): boolean {
  const n = foldForMatch(needle);
  if (!n) return false;
  return ` ${haystackFolded} `.includes(` ${n} `);
}

/** Collapses runs of spaces/tabs inside lines and trims each line; keeps line breaks. */
export function normalizeLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ‏‎]+/g, ' ').trim());
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è',
  ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï',
  euml: 'ë', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—', deg: '°', middot: '·',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Readable text from an HTML page: scripts/styles dropped, block elements become line breaks, entities decoded. */
export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|table|ul|ol|dd|dt|blockquote|pre|nav|aside|main|form)\s*>/gi, '\n')
    .replace(/<(p|div|tr|h[1-6]|section|article|table|ul|ol|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' | ');
  const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, ' '));
  return normalizeLines(text)
    .map((l) => l.replace(/^\|\s*|\s*\|$/g, '').trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

export interface Anchor {
  text: string;
  href: string;
}

/** Links of a page (absolute http(s) URLs only) with their visible text — used to attach announcement URLs. */
export function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const out: Anchor[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const rawHref = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim();
    const text = decodeEntities(m[5].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!rawHref || !text) continue;
    try {
      const url = new URL(rawHref, baseUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') out.push({ text, href: url.toString() });
    } catch {
      // malformed href: ignore
    }
  }
  return out;
}

/** 'ar' | 'fr' | 'mixed' | null from the proportion of Arabic vs Latin letters. */
export function detectLanguage(text: string): 'ar' | 'fr' | 'mixed' | null {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  const total = arabic + latin;
  if (total < 20) return null;
  if (arabic / total >= 0.8) return 'ar';
  if (latin / total >= 0.8) return 'fr';
  return 'mixed';
}

export interface PageText {
  page: number;
  text: string;
}

/** Plain text → pages: form feeds (\f) separate pages, as written by pdftotext and our own extractedText. */
export function splitPages(text: string): PageText[] {
  const parts = text.replace(/\r\n?/g, '\n').split('\f');
  return parts.map((t, i) => ({ page: i + 1, text: t.trim() })).filter((p) => p.text !== '');
}

export const CHUNK_MAX_CHARS = 1500;

/**
 * Splits one page into chunks of at most `max` characters, breaking at paragraph, then line, then sentence boundaries.
 * Chunks never cross pages, so every chunk keeps an exact page number for source quotes.
 */
export function chunkPage(text: string, max = CHUNK_MAX_CHARS): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const units: string[] = [];
  for (const para of clean.split(/\n\s*\n/)) {
    if (para.length <= max) {
      units.push(para.trim());
      continue;
    }
    for (const line of para.split('\n')) {
      if (line.length <= max) {
        units.push(line.trim());
        continue;
      }
      const sentences = line.split(/(?<=[.!?؟؛;])\s+/);
      for (const s of sentences) {
        for (let i = 0; i < s.length; i += max) units.push(s.slice(i, i + max).trim());
      }
    }
  }
  const chunks: string[] = [];
  let current = '';
  for (const u of units.filter(Boolean)) {
    const next = current ? `${current}\n${u}` : u;
    if (next.length > max && current) {
      chunks.push(current);
      current = u;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Collapses whitespace (incl. line breaks) — used to check that a quote appears verbatim in a text. */
export function squash(s: string): string {
  return s.replace(/[\s ‎‏]+/g, ' ').trim();
}

/** Page where `quote` appears verbatim (whitespace-insensitive), or null. Latin comparison is case-insensitive. */
export function findQuotePage(quote: string, pages: PageText[]): number | null {
  const q = squash(quote).toLowerCase();
  if (q.length < 3) return null;
  for (const p of pages) if (squash(p.text).toLowerCase().includes(q)) return p.page;
  return null;
}

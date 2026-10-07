/** Pure helpers of the official-page watcher: line diff, announcement detection, family guessing. */
import { foldForMatch, normalizeLines, sha256, type Anchor } from './text.util';

/** Folded stems: مناظرة/مناظرات, انتداب/انتدابات, concours, recrutement/recruter. */
const ANNOUNCEMENT_STEMS = ['مناظر', 'انتداب', 'concours', 'recrut'].map(foldForMatch);
export const MAX_CANDIDATES_PER_CHECK = 30;
const CONTEXT_LINES = 2;

export function isAnnouncementLine(line: string): boolean {
  const f = foldForMatch(line);
  if (f.split(' ').length < 3 || line.length < 12) return false; // menu items ("Concours") are not announcements
  return ANNOUNCEMENT_STEMS.some((s) => f.includes(s));
}

export interface CandidateBlock {
  title: string;
  text: string;
  /** sha256 of the folded block: whitespace/punctuation-only edits do not create a new candidate. */
  sha: string;
  url: string | null;
}

const lineKey = (l: string) => foldForMatch(l);

/**
 * Lines of `next` that did not exist in `prev` and look like concours announcements, each with up to two following new
 * lines of context (dates and conditions usually follow the title). `prev = null` (first check) treats every line as new.
 */
export function announcementBlocks(prev: string | null, next: string, anchors: Anchor[] = []): CandidateBlock[] {
  const before = new Set(prev ? normalizeLines(prev).filter(Boolean).map(lineKey) : []);
  const lines = normalizeLines(next).filter(Boolean);
  const isNew = lines.map((l) => !before.has(lineKey(l)));
  const out: CandidateBlock[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length && out.length < MAX_CANDIDATES_PER_CHECK; i++) {
    if (!isNew[i] || !isAnnouncementLine(lines[i])) continue;
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length && block.length <= CONTEXT_LINES; j++) {
      if (!isNew[j] || isAnnouncementLine(lines[j]) || lines[j].length > 400) break;
      block.push(lines[j]);
    }
    const text = block.join('\n');
    const sha = sha256(foldForMatch(text));
    if (seen.has(sha)) continue;
    seen.add(sha);
    out.push({ title: lines[i].slice(0, 200), text: text.slice(0, 4000), sha, url: anchorFor(lines[i], anchors) });
  }
  return out;
}

/** The link whose visible text is (part of) the announcement line, e.g. "بلاغ حول مناظرة …" → its PDF/page URL. */
export function anchorFor(line: string, anchors: Anchor[]): string | null {
  const l = foldForMatch(line);
  let best: { href: string; len: number } | null = null;
  for (const a of anchors) {
    const t = foldForMatch(a.text);
    if (t.length < 8) continue;
    if ((l.includes(t) || t.includes(l)) && (!best || t.length > best.len)) best = { href: a.href, len: t.length };
  }
  return best?.href ?? null;
}

export interface FamilyKeywords {
  slug: string;
  nameAr: string;
  nameFr: string;
  keywords: string[];
}

export interface FamilyGuess {
  slug: string | null;
  score: number;
  matched: string[];
}

/**
 * Scores each family by the keywords (and names) found as whole words in the text. A keyword shared by several
 * families ("وزارة الداخلية") counts less (divided by how many families use it), multi-word phrases count more than
 * single words, and very short tokens ("198", "bac") are ignored. The watched page's own family gets a small bonus.
 */
export function guessFamily(text: string, families: FamilyKeywords[], pageFamilySlug: string | null = null): FamilyGuess {
  const hay = ` ${foldForMatch(text)} `;
  const perFamily = families.map((f) => ({
    slug: f.slug,
    keys: [...new Set([...f.keywords, f.nameAr, f.nameFr].map(foldForMatch).filter((k) => k.length >= 4 && !/^\d+$/.test(k)))],
  }));
  const df = new Map<string, number>();
  for (const f of perFamily) for (const k of f.keys) df.set(k, (df.get(k) ?? 0) + 1);

  const scored = perFamily.map((f) => {
    const matched = f.keys.filter((k) => hay.includes(` ${k} `));
    const score = matched.reduce((s, k) => s + (k.split(' ').length > 1 ? 2 : 0.5) / (df.get(k) ?? 1), 0) + (f.slug === pageFamilySlug ? 0.5 : 0);
    return { slug: f.slug, score, matched };
  }).sort((a, b) => b.score - a.score);

  const [best, second] = scored;
  if (!best || best.score < 1 || (second && second.score === best.score)) {
    return { slug: pageFamilySlug, score: best?.score ?? 0, matched: best?.matched ?? [] };
  }
  return { slug: best.slug, score: Math.round(best.score * 100) / 100, matched: best.matched };
}

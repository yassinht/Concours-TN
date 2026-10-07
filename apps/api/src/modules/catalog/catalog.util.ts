import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import {
  DOMAINS, type CandidateProfile, type ContentStatus, type Domain, type EditionDTO, type EditionStatus, type Provenance, type SourceType,
} from '@ctn/shared';
import { env } from '../../config/env';

/** Content visible to the public catalog (drafts and archived rows are hidden). */
export const VISIBLE_STATUSES: ContentStatus[] = ['AI_REVIEWED', 'HUMAN_REVIEWED', 'PUBLISHED'];

/** Questions that may be served (see docs/api-contract.md, practice). */
export function servableQuestionStatuses(): ContentStatus[] {
  return env().CONTENT_BETA_MODE ? ['PUBLISHED', 'HUMAN_REVIEWED', 'AI_REVIEWED'] : ['PUBLISHED'];
}

/** Lessons: human-reviewed ones always; AI-reviewed ones only in beta mode (flagged unreviewed). */
export function servableLessonStatuses(): ContentStatus[] {
  return env().CONTENT_BETA_MODE ? ['PUBLISHED', 'HUMAN_REVIEWED', 'AI_REVIEWED'] : ['PUBLISHED', 'HUMAN_REVIEWED'];
}

/** `(v1, v2, …)` with bound parameters — for `x in ${inList(values)}` in raw SQL. */
export function inList(values: readonly (string | number)[]): SQL {
  if (!values.length) return sql`(null)`;
  return sql`(${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

// ───────────── Search normalization (Arabic letter variants, diacritics, French accents) ─────────────

const FOLD_PAIRS: [string, string][] = [
  ['أ', 'ا'], ['إ', 'ا'], ['آ', 'ا'], ['ٱ', 'ا'], ['ى', 'ي'], ['ة', 'ه'], ['ؤ', 'و'], ['ئ', 'ي'],
  ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['ë', 'e'], ['à', 'a'], ['â', 'a'], ['ä', 'a'], ['î', 'i'], ['ï', 'i'],
  ['ô', 'o'], ['ö', 'o'], ['û', 'u'], ['ü', 'u'], ['ù', 'u'], ['ç', 'c'], ['œ', 'o'], ['’', "'"],
];
/** Tatweel and Arabic diacritics (harakat, shadda, sukun, superscript alef) are dropped. */
const FOLD_DROP = 'ـًٌٍَُِّْٰ';
const FOLD_FROM = FOLD_PAIRS.map((p) => p[0]).join('') + FOLD_DROP;
const FOLD_TO = FOLD_PAIRS.map((p) => p[1]).join('');
const FOLD_MAP = new Map(FOLD_PAIRS);

export function foldText(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    if (FOLD_DROP.includes(ch)) continue;
    out += FOLD_MAP.get(ch) ?? ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** SQL twin of foldText for a column/expression. */
export function foldSql(expr: SQLWrapper | SQL): SQL {
  return sql`translate(lower(${expr}), ${FOLD_FROM}, ${FOLD_TO})`;
}

/** ILIKE pattern for a user query (wildcards escaped), or null when the query is too short. */
export function likePattern(q: string | undefined | null): string | null {
  const folded = foldText(q ?? '');
  if (folded.length < 2) return null;
  return `%${folded.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

// ───────────── Editions ─────────────

/**
 * Status as of today: an OPEN edition past its deadline is shown CLOSED, and an ANNOUNCED edition whose
 * registration window has started is shown OPEN (dates come from the announcement itself).
 */
export function effectiveStatus(e: { status: EditionStatus; registrationOpen: string | null; registrationDeadline: string | null }, today: string): EditionStatus {
  if (e.status === 'OPEN' && e.registrationDeadline && e.registrationDeadline < today) return 'CLOSED';
  if (e.status === 'ANNOUNCED' && e.registrationOpen && e.registrationDeadline && e.registrationOpen <= today && e.registrationDeadline >= today) return 'OPEN';
  return e.status;
}

const datesOf = (e: Pick<EditionDTO, 'registrationOpen' | 'registrationDeadline' | 'examDate'>) =>
  [e.registrationOpen, e.registrationDeadline, e.examDate].filter((d): d is string => !!d);

/** Earliest date of the edition that is today or later (null when none). */
export function nextDateOf(e: Pick<EditionDTO, 'registrationOpen' | 'registrationDeadline' | 'examDate'>, today: string): string | null {
  return datesOf(e).filter((d) => d >= today).sort()[0] ?? null;
}

function latestDateOf(e: EditionDTO): string {
  return datesOf(e).sort().at(-1) ?? '';
}

/** OPEN first (closest deadline), then ANNOUNCED/EXPECTED with a future date, else the most recent edition. */
export function pickNextEdition(editions: EditionDTO[], today: string): EditionDTO | null {
  const open = editions
    .filter((e) => e.status === 'OPEN')
    .sort((a, b) => (a.registrationDeadline ?? '9999').localeCompare(b.registrationDeadline ?? '9999'));
  if (open[0]) return open[0];
  const upcoming = editions
    .filter((e) => (e.status === 'ANNOUNCED' || e.status === 'EXPECTED') && nextDateOf(e, today))
    .sort((a, b) => (a.status === b.status ? nextDateOf(a, today)!.localeCompare(nextDateOf(b, today)!) : a.status === 'ANNOUNCED' ? -1 : 1));
  if (upcoming[0]) return upcoming[0];
  return [...editions].sort((a, b) => b.year - a.year || latestDateOf(b).localeCompare(latestDateOf(a)))[0] ?? null;
}

// ───────────── Provenance ─────────────

export interface SourceRow {
  id: string;
  title: string;
  url: string | null;
  sourceType: SourceType;
  publicationDate: string | null;
  lastVerifiedAt: Date | null;
}

export function toSource(s: SourceRow | null | undefined): Provenance['source'] {
  return s ? { id: s.id, title: s.title, url: s.url, sourceType: s.sourceType, publicationDate: s.publicationDate } : null;
}

export function provenance(
  s: SourceRow | null | undefined,
  confidence: Provenance['confidence'],
  needsVerification: boolean,
  sourceQuote?: string | null,
  lastVerifiedAt?: Date | null,
): Provenance {
  const verified = lastVerifiedAt ?? s?.lastVerifiedAt ?? null;
  return { source: toSource(s), confidence, needsVerification, sourceQuote: sourceQuote ?? null, lastVerifiedAt: verified ? verified.toISOString() : null };
}

// ───────────── Misc ─────────────

export const DOMAIN_ORDER = new Map<Domain, number>(DOMAINS.map((d, i) => [d, i]));

export interface ProfileLike {
  birthDate?: string | null;
  gender?: string | null;
  diplomaLevel?: string | null;
  specialties?: string[] | null;
  heightCm?: number | null;
  maritalStatus?: string | null;
  nationality?: string | null;
}

export function toCandidateProfile(p: ProfileLike | null | undefined): CandidateProfile {
  if (!p) return {};
  return {
    birth_date: p.birthDate ?? null,
    gender: p.gender === 'M' || p.gender === 'F' ? p.gender : null,
    diploma_level: (p.diplomaLevel as CandidateProfile['diploma_level']) ?? null,
    specialties: p.specialties ?? [],
    height_cm: p.heightCm ?? null,
    marital_status: p.maritalStatus === 'SINGLE' || p.maritalStatus === 'MARRIED' || p.maritalStatus === 'OTHER' ? p.maritalStatus : null,
    nationality: p.nationality ?? null,
  };
}

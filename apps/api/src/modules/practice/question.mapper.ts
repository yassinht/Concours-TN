/**
 * QuestionDTO mapping shared by practice (sessions, results, mistakes, bookmarks, offline packs) and other modules.
 * `correct` / `explanation` are only attached when the caller explicitly asks to reveal them.
 */
import { eq, inArray } from 'drizzle-orm';
import type { ContentStatus, Difficulty, Domain, QuestionDTO, QuestionType } from '@ctn/shared';
import type { Database } from '../../db/client';
import { pastExams, questions, syllabusNodes } from '../../db/schema';
import { seededRng, shuffle } from './selection';

export interface QuestionRow {
  id: string;
  type: QuestionType;
  domain: Domain;
  language: string;
  stem: string;
  options: unknown;
  correct: unknown;
  explanation: string;
  difficulty: Difficulty;
  rating: number;
  topicId: string;
  topicKey: string;
  topicTitleAr: string;
  topicTitleFr: string;
  origin: string;
  year: number | null;
  status: ContentStatus;
  pastExamTitle: string | null;
}

/** Drizzle select shape producing a QuestionRow (questions ⋈ syllabus_nodes ⟕ past_exams). */
export const questionRowColumns = {
  id: questions.id,
  type: questions.type,
  domain: questions.domain,
  language: questions.language,
  stem: questions.stem,
  options: questions.options,
  correct: questions.correct,
  explanation: questions.explanation,
  difficulty: questions.difficulty,
  rating: questions.rating,
  topicId: questions.topicId,
  topicKey: syllabusNodes.key,
  topicTitleAr: syllabusNodes.titleAr,
  topicTitleFr: syllabusNodes.titleFr,
  origin: questions.origin,
  year: questions.year,
  status: questions.status,
  pastExamTitle: pastExams.title,
};

/** Loads question rows by id (any status: attempts keep serving what they were built with). */
export async function loadQuestionRows(db: Database, ids: readonly string[]): Promise<Map<string, QuestionRow>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db
    .select(questionRowColumns)
    .from(questions)
    .innerJoin(syllabusNodes, eq(syllabusNodes.id, questions.topicId))
    .leftJoin(pastExams, eq(pastExams.id, questions.pastExamId))
    .where(inArray(questions.id, unique));
  return new Map(rows.map((r) => [r.id, r as QuestionRow]));
}

const ORIGIN_LABELS: Record<string, { ar: string; fr: string }> = {
  PAST_EXAM_VERBATIM: { ar: 'مناظرة سابقة', fr: 'Ancien concours' },
  PAST_EXAM_REWRITTEN: { ar: 'مقتبس من مناظرة سابقة', fr: 'Adapté d’un ancien concours' },
  AUTHORED: { ar: 'من إعداد فريق المنصة', fr: 'Rédigé par l’équipe' },
  AI_GENERATED: { ar: 'مولَّد بالذكاء الاصطناعي', fr: 'Généré par IA' },
  ALGORITHMIC: { ar: 'تمرين مولَّد آليًا', fr: 'Exercice généré' },
};

/** Human-readable provenance: the past-exam title when linked, else "origin (year)" in both languages. */
export function sourceLabelOf(origin: string, year: number | null, pastExamTitle: string | null): string | null {
  if (pastExamTitle) return pastExamTitle;
  const l = ORIGIN_LABELS[origin];
  if (!l) return year ? String(year) : null;
  const y = year ? ` ${year}` : '';
  return `${l.ar}${y} · ${l.fr}${y}`;
}

type Option = QuestionDTO['options'][number];

/** Keeps only the public fields of an option (an option object must never carry grading hints to the client). */
export function sanitizeOptions(raw: unknown): Option[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o) => {
      const opt: Option = { id: String(o.id ?? ''), text: String(o.text ?? '') };
      if (o.side === 'left' || o.side === 'right') opt.side = o.side;
      return opt;
    });
}

/**
 * Options that refer to other options ("a et b", "toutes les réponses", "كل ما سبق"…) only make sense in authored order.
 * False positives just disable shuffling, which is always safe.
 */
const POSITIONAL_RE = new RegExp(
  [
    String.raw`\b[a-e]\s*(?:et|ou|and|or|&|,)\s*[a-e]\b`,
    String.raw`(?:toutes|tous|aucune|aucun)\s+(?:les\s+)?(?:réponses|propositions|ci-dessus|précédentes)`,
    String.raw`(?:all|none|both)\s+of\s+(?:the\s+)?(?:above|these)`,
    String.raw`(?:كل|جميع|لا\s*شيء\s*من)\s*(?:ما\s*سبق|الإجابات|الاقتراحات)`,
    String.raw`(?:^|\s)[أبجده]\s*و\s*[أبجده](?:\s|$)`,
  ].join('|'),
  'i',
);

/**
 * Deterministic per-seed option order so position memorisation does not help (stable across reloads of an attempt).
 * MCQ: shuffled unless an option is positional. ORDERING: shuffled and never shown in the solved order.
 * MATCHING: right-hand column shuffled. TRUE_FALSE / NUMERIC: unchanged.
 */
export function arrangeOptions(type: QuestionType, options: Option[], correct: unknown, seed: string): Option[] {
  if (options.length < 2) return options;
  const rng = seededRng(seed);
  switch (type) {
    case 'MCQ_SINGLE':
    case 'MCQ_MULTI':
      return options.some((o) => POSITIONAL_RE.test(o.text)) ? options : shuffle(options, rng);
    case 'ORDERING': {
      let out = shuffle(options, rng);
      const order = (correct as { order?: unknown } | null)?.order;
      if (Array.isArray(order) && out.map((o) => o.id).join('\u0000') === order.join('\u0000')) out = [...out.slice(1), out[0]];
      return out;
    }
    case 'MATCHING': {
      const right = shuffle(options.filter((o) => o.side === 'right'), rng);
      let r = 0;
      return options.map((o) => (o.side === 'right' ? right[r++] : o));
    }
    default:
      return options;
  }
}

export interface ToQuestionOptions {
  /** Attach `correct` and `explanation` (instant feedback given, result review, mistakes, offline pack). */
  reveal?: boolean;
  bookmarked?: boolean;
  /** Seed for a stable option shuffle (usually `${attemptId}:${questionId}`); omitted = authored order. */
  shuffleSeed?: string;
}

export function toQuestionDTO(row: QuestionRow, opts: ToQuestionOptions = {}): QuestionDTO {
  const options = sanitizeOptions(row.options);
  const dto: QuestionDTO = {
    id: row.id,
    type: row.type,
    domain: row.domain,
    language: (['ar', 'fr', 'en'].includes(row.language) ? row.language : 'ar') as QuestionDTO['language'],
    stem: row.stem,
    options: opts.shuffleSeed ? arrangeOptions(row.type, options, row.correct, opts.shuffleSeed) : options,
    difficulty: row.difficulty,
    topicKey: row.topicKey,
    topicTitle_ar: row.topicTitleAr,
    topicTitle_fr: row.topicTitleFr,
    origin: row.origin,
    year: row.year,
    sourceLabel: sourceLabelOf(row.origin, row.year, row.pastExamTitle),
    unreviewed: row.status !== 'PUBLISHED',
  };
  if (opts.bookmarked !== undefined) dto.bookmarked = opts.bookmarked;
  if (opts.reveal) {
    dto.correct = row.correct;
    dto.explanation = row.explanation;
  }
  return dto;
}

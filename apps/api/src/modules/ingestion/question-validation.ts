/** Automatic checks run on every AI-generated question before it may leave DRAFT. Pure functions only. */
import { DIFFICULTIES, type Difficulty } from '@ctn/shared';
import { foldForMatch } from './text.util';

export interface CandidateOption {
  id: string;
  text: string;
}

/** A generated MCQ as the model returns it, after light coercion. */
export interface CandidateQuestion {
  type: 'MCQ_SINGLE';
  stem: string;
  options: CandidateOption[];
  correct: string[];
  explanation: string;
  difficulty: Difficulty;
  objectiveKey: string | null;
}

export type RejectReason =
  | 'STRUCTURE_OPTIONS_COUNT'
  | 'STRUCTURE_OPTION_IDS'
  | 'STRUCTURE_OPTION_TEXT'
  | 'STRUCTURE_CORRECT_COUNT'
  | 'STRUCTURE_CORRECT_UNKNOWN'
  | 'STRUCTURE_STEM'
  | 'STRUCTURE_EXPLANATION'
  | 'NEAR_DUPLICATE'
  | 'BLIND_SOLVE_DISAGREES'
  | 'BLIND_SOLVE_FAILED';

export const REJECT_LABELS: Record<RejectReason, { ar: string; fr: string }> = {
  STRUCTURE_OPTIONS_COUNT: { ar: 'عدد الاختيارات يجب أن يكون 4', fr: 'Il faut exactement 4 options' },
  STRUCTURE_OPTION_IDS: { ar: 'معرّفات الاختيارات مكررة أو فارغة', fr: 'Identifiants d’options vides ou dupliqués' },
  STRUCTURE_OPTION_TEXT: { ar: 'نص اختيار فارغ أو مكرر', fr: 'Texte d’option vide ou dupliqué' },
  STRUCTURE_CORRECT_COUNT: { ar: 'يجب أن تكون هناك إجابة صحيحة واحدة بالضبط', fr: 'Il faut exactement une bonne réponse' },
  STRUCTURE_CORRECT_UNKNOWN: { ar: 'الإجابة الصحيحة لا تطابق أي اختيار', fr: 'La bonne réponse ne correspond à aucune option' },
  STRUCTURE_STEM: { ar: 'نص السؤال قصير جدا', fr: 'Énoncé trop court' },
  STRUCTURE_EXPLANATION: { ar: 'التفسير قصير جدا', fr: 'Explication trop courte' },
  NEAR_DUPLICATE: { ar: 'سؤال شبه مكرر لسؤال موجود', fr: 'Quasi-doublon d’une question existante' },
  BLIND_SOLVE_DISAGREES: { ar: 'الحل المستقل لم يتوصل إلى نفس الإجابة', fr: 'La résolution à l’aveugle ne trouve pas la même réponse' },
  BLIND_SOLVE_FAILED: { ar: 'تعذّر التحقق المستقل من الإجابة', fr: 'Vérification indépendante impossible' },
};

export const DUPLICATE_THRESHOLD = 0.8;

const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Coerces one item of the model's `questions` array. Returns null when there is nothing worth keeping
 * (no stem or no explanation): such items are discarded rather than stored.
 */
export function coerceCandidate(raw: unknown, fallbackDifficulty: Difficulty): CandidateQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const stem = s(o.stem, 2000);
  const explanation = s(o.explanation, 4000);
  if (!stem || !explanation) return null;
  const options = Array.isArray(o.options)
    ? o.options.flatMap((x) => {
        if (!x || typeof x !== 'object') return [];
        const opt = x as Record<string, unknown>;
        return [{ id: s(opt.id, 10).toLowerCase(), text: s(opt.text, 500) }];
      })
    : [];
  const correctRaw = Array.isArray(o.correct) ? o.correct : typeof o.correct === 'string' ? [o.correct] : [];
  const correct = correctRaw.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toLowerCase());
  const difficulty = DIFFICULTIES.includes(o.difficulty as Difficulty) ? (o.difficulty as Difficulty) : fallbackDifficulty;
  const objectiveKey = s(o.objective_key ?? o.objectiveKey, 120) || null;
  return { type: 'MCQ_SINGLE', stem, options, correct, explanation, difficulty, objectiveKey };
}

/** Structural checks for MCQ_SINGLE: 4 options with unique ids/texts, exactly one correct id that exists. */
export function validateStructure(q: CandidateQuestion): RejectReason | null {
  if (q.stem.length < 10) return 'STRUCTURE_STEM';
  if (q.explanation.length < 15) return 'STRUCTURE_EXPLANATION';
  if (q.options.length !== 4) return 'STRUCTURE_OPTIONS_COUNT';
  const ids = q.options.map((o) => o.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return 'STRUCTURE_OPTION_IDS';
  const texts = q.options.map((o) => foldForMatch(o.text) || o.text.trim());
  if (texts.some((t) => !t) || new Set(texts).size !== texts.length) return 'STRUCTURE_OPTION_TEXT';
  if (q.correct.length !== 1) return 'STRUCTURE_CORRECT_COUNT';
  if (!ids.includes(q.correct[0])) return 'STRUCTURE_CORRECT_UNKNOWN';
  return null;
}

/** Normalised token set (accents, hamza forms, tashkeel and punctuation ignored). Numbers are kept: they matter. */
export function tokenSet(text: string): Set<string> {
  return new Set(foldForMatch(text).split(' ').filter(Boolean));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Most similar existing stem when the normalised-token Jaccard similarity is above the threshold
 * (pg_trgm is not installed, and token sets are robust to word order and punctuation changes).
 */
export function findNearDuplicate(
  stem: string,
  existing: { id: string; tokens: Set<string> }[],
  threshold = DUPLICATE_THRESHOLD,
): { id: string; similarity: number } | null {
  const mine = tokenSet(stem);
  let best: { id: string; similarity: number } | null = null;
  for (const e of existing) {
    const sim = jaccard(mine, e.tokens);
    if (sim > threshold && (!best || sim > best.similarity)) best = { id: e.id, similarity: sim };
  }
  return best;
}

/** Bilingual note appended to the explanation of a rejected question, so reviewers see why at a glance. */
export function rejectionNote(reason: RejectReason, detail?: string): string {
  const l = REJECT_LABELS[reason];
  return `[التحقق الآلي / Validation automatique] ${l.ar} — ${l.fr}${detail ? ` (${detail})` : ''}`;
}

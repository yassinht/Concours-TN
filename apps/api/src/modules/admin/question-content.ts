import type { QuestionType } from '@ctn/shared';

export interface QuestionOption { id: string; text: string; side?: 'left' | 'right' }

export interface ContentIssue { path: string; message: string }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Structural integrity of a question: the answer key must reference real options, so a published question can always be
 * graded by `gradeAnswer` (@ctn/shared). Returns the normalized answer key (deduplicated ids) and the problems found.
 */
export function validateQuestionContent(type: QuestionType, options: QuestionOption[], correct: unknown): { correct: unknown; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const ids = options.map((o) => o.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) issues.push({ path: 'options', message: 'duplicate option ids' });
  options.forEach((o, i) => {
    if (!o.id.trim()) issues.push({ path: `options.${i}.id`, message: 'empty id' });
    if (!o.text.trim()) issues.push({ path: `options.${i}.text`, message: 'empty text' });
  });

  switch (type) {
    case 'MCQ_SINGLE':
    case 'TRUE_FALSE':
    case 'MCQ_MULTI': {
      if (type === 'TRUE_FALSE' && options.length !== 2) issues.push({ path: 'options', message: 'TRUE_FALSE needs exactly 2 options' });
      else if (options.length < 2) issues.push({ path: 'options', message: 'at least 2 options' });
      if (options.length > 10) issues.push({ path: 'options', message: 'at most 10 options' });
      if (!isStrArray(correct)) {
        issues.push({ path: 'correct', message: 'expected an array of option ids' });
        return { correct, issues };
      }
      const keys = [...new Set(correct)];
      if (type !== 'MCQ_MULTI' && keys.length !== 1) issues.push({ path: 'correct', message: 'exactly one correct option' });
      if (type === 'MCQ_MULTI' && keys.length < 1) issues.push({ path: 'correct', message: 'at least one correct option' });
      if (type === 'MCQ_MULTI' && keys.length === options.length && options.length > 0) {
        issues.push({ path: 'correct', message: 'every option is correct: not a real question' });
      }
      for (const k of keys) if (!idSet.has(k)) issues.push({ path: 'correct', message: `unknown option id "${k}"` });
      return { correct: keys, issues };
    }
    case 'NUMERIC': {
      const c = correct as { value?: unknown; tolerance?: unknown } | null;
      if (!c || typeof c !== 'object' || Array.isArray(c) || !isNum(c.value)) {
        issues.push({ path: 'correct', message: 'expected { value: number, tolerance?: number }' });
        return { correct, issues };
      }
      if (c.tolerance !== undefined && (!isNum(c.tolerance) || c.tolerance < 0)) issues.push({ path: 'correct.tolerance', message: 'tolerance must be ≥ 0' });
      return { correct: c.tolerance === undefined ? { value: c.value } : { value: c.value, tolerance: c.tolerance }, issues };
    }
    case 'MATCHING': {
      const left = new Set(options.filter((o) => o.side === 'left').map((o) => o.id));
      const right = new Set(options.filter((o) => o.side === 'right').map((o) => o.id));
      if (left.size < 2 || right.size < 2) issues.push({ path: 'options', message: 'MATCHING needs ≥ 2 left and ≥ 2 right options (side)' });
      if (left.size + right.size !== options.length) issues.push({ path: 'options', message: 'every MATCHING option needs side left|right' });
      const pairs = (correct as { pairs?: unknown } | null)?.pairs;
      if (!Array.isArray(pairs) || !pairs.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string')) {
        issues.push({ path: 'correct', message: 'expected { pairs: [leftId, rightId][] }' });
        return { correct, issues };
      }
      const seenLeft = new Set<string>();
      for (const [l, r] of pairs as [string, string][]) {
        if (!left.has(l)) issues.push({ path: 'correct.pairs', message: `"${l}" is not a left option` });
        if (!right.has(r)) issues.push({ path: 'correct.pairs', message: `"${r}" is not a right option` });
        if (seenLeft.has(l)) issues.push({ path: 'correct.pairs', message: `"${l}" is paired twice` });
        seenLeft.add(l);
      }
      if (seenLeft.size !== left.size) issues.push({ path: 'correct.pairs', message: 'every left option needs exactly one pair' });
      return { correct: { pairs }, issues };
    }
    case 'ORDERING': {
      if (options.length < 2) issues.push({ path: 'options', message: 'at least 2 options' });
      const order = (correct as { order?: unknown } | null)?.order;
      if (!isStrArray(order)) {
        issues.push({ path: 'correct', message: 'expected { order: optionId[] }' });
        return { correct, issues };
      }
      const set = new Set(order);
      if (set.size !== order.length || order.length !== options.length || order.some((id) => !idSet.has(id))) {
        issues.push({ path: 'correct.order', message: 'order must be a permutation of all option ids' });
      }
      return { correct: { order }, issues };
    }
    default:
      issues.push({ path: 'type', message: 'unknown question type' });
      return { correct, issues };
  }
}

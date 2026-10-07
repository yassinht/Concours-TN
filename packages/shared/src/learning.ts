import { Difficulty, Domain, QuestionType, ReadinessLabel } from './enums';

// ───────────────────────────── Grading ─────────────────────────────

export type CorrectAnswer =
  | string[] // MCQ_SINGLE, MCQ_MULTI, TRUE_FALSE: option ids
  | { value: number; tolerance?: number } // NUMERIC
  | { pairs: [string, string][] } // MATCHING
  | { order: string[] }; // ORDERING

export type UserAnswer = string[] | { value: number } | { pairs: [string, string][] } | { order: string[] } | null;

/** Grade one answer. Pure & deterministic (also usable offline in the PWA). */
export function gradeAnswer(type: QuestionType, correct: CorrectAnswer, answer: UserAnswer): boolean {
  if (answer == null) return false;
  switch (type) {
    case 'MCQ_SINGLE':
    case 'TRUE_FALSE':
    case 'MCQ_MULTI': {
      if (!Array.isArray(correct) || !Array.isArray(answer)) return false;
      const a = [...new Set(answer as string[])].sort();
      const c = [...new Set(correct)].sort();
      return a.length === c.length && a.every((v, i) => v === c[i]);
    }
    case 'NUMERIC': {
      const c = correct as { value: number; tolerance?: number };
      const a = answer as { value: number };
      if (typeof a?.value !== 'number' || Number.isNaN(a.value)) return false;
      return Math.abs(a.value - c.value) <= (c.tolerance ?? 0) + 1e-9;
    }
    case 'MATCHING': {
      const c = (correct as { pairs: [string, string][] }).pairs ?? [];
      const a = (answer as { pairs: [string, string][] }).pairs ?? [];
      if (a.length !== c.length) return false;
      const key = (p: [string, string]) => `${p[0]}→${p[1]}`;
      const set = new Set(c.map(key));
      return a.every((p) => set.has(key(p)));
    }
    case 'ORDERING': {
      const c = (correct as { order: string[] }).order ?? [];
      const a = (answer as { order: string[] }).order ?? [];
      return a.length === c.length && a.every((v, i) => v === c[i]);
    }
    default:
      return false;
  }
}

// ───────────────────────────── Mastery (Elo) ─────────────────────────────

export const DIFFICULTY_RATING: Record<Difficulty, number> = { EASY: 900, MEDIUM: 1000, HARD: 1100, EXPERT: 1200 };
export const START_RATING = 950;

export function expectedScore(userRating: number, questionRating: number): number {
  return 1 / (1 + Math.pow(10, (questionRating - userRating) / 400));
}

/** Elo update for (user, topic). K shrinks as the topic accumulates attempts (more stable estimates). */
export function updateRating(userRating: number, questionRating: number, correct: boolean, attempts: number): { user: number; question: number } {
  const e = expectedScore(userRating, questionRating);
  const kUser = Math.max(16, 48 - attempts * 1.5);
  const kQ = 8;
  const s = correct ? 1 : 0;
  return { user: userRating + kUser * (s - e), question: questionRating - kQ * (s - e) };
}

/** Probability-like mastery in [0,1] from a rating. 1000 ≈ 50% on MEDIUM questions. */
export function masteryFromRating(rating: number): number {
  return 1 / (1 + Math.exp(-(rating - 1000) / 120));
}

/**
 * Shrink mastery toward the prior (0.35) when evidence is thin — 3 lucky answers must not show 90%.
 * With n attempts, weight = n / (n + 8).
 */
export function shrunkMastery(rating: number, attempts: number, prior = 0.35): number {
  const w = attempts / (attempts + 8);
  return w * masteryFromRating(rating) + (1 - w) * prior;
}

/** Spaced repetition interval (days) after an answer on a topic. */
export function nextReviewDays(mastery: number, correct: boolean, streakCorrect: number): number {
  if (!correct) return 1;
  const base = mastery < 0.5 ? 2 : mastery < 0.75 ? 4 : 7;
  return Math.min(30, Math.round(base * Math.pow(1.6, Math.max(0, streakCorrect - 1))));
}

// ───────────────────────────── Readiness ─────────────────────────────

export interface TopicMastery {
  topicId: string;
  domain: Domain;
  rating: number;
  attempts: number;
}

export interface DomainWeight {
  domain: Domain;
  /** Weight of the domain in the real exam (coefficient or share of questions). */
  weight: number;
  /** Total number of topics of the syllabus in this domain (for coverage). */
  topicCount: number;
}

export interface ReadinessInput {
  topics: TopicMastery[];
  weights: DomainWeight[];
  /** Mock exam scores in [0,1], most recent first. */
  mockScores: number[];
  /** Whether the exam format/weights are official or approximated. */
  formatOfficial: boolean;
}

export interface ReadinessResult {
  overall: number; // 0..100
  preparation: number; // 0..100 (blend with mocks)
  coverage: number; // 0..100
  label: ReadinessLabel;
  byDomain: { domain: Domain; score: number; coverage: number; weight: number }[];
  reasons: { ar: string; fr: string }[];
  priorities: { domain: Domain; topicId?: string; gain: number }[];
  disclaimer: { ar: string; fr: string };
}

const MIN_TOPIC_ATTEMPTS_FOR_COVERAGE = 5;

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const reasons: { ar: string; fr: string }[] = [];
  const byDomain = input.weights.map((w) => {
    const ts = input.topics.filter((t) => t.domain === w.domain);
    const covered = ts.filter((t) => t.attempts >= MIN_TOPIC_ATTEMPTS_FOR_COVERAGE).length;
    const coverage = w.topicCount > 0 ? Math.min(1, covered / w.topicCount) : ts.length ? 1 : 0;
    // untouched topics count at the prior so ignoring a domain is visible
    const scores = ts.map((t) => shrunkMastery(t.rating, t.attempts));
    const missing = Math.max(0, w.topicCount - ts.length);
    const score = (scores.reduce((a, b) => a + b, 0) + missing * 0.2) / Math.max(1, scores.length + missing);
    return { domain: w.domain, score, coverage, weight: w.weight };
  });

  const totalW = byDomain.reduce((a, d) => a + d.weight, 0) || 1;
  const overall = byDomain.reduce((a, d) => a + d.score * d.weight, 0) / totalW;
  const coverage = byDomain.reduce((a, d) => a + d.coverage * d.weight, 0) / totalW;
  const mocks = input.mockScores.slice(0, 2);
  const mockAvg = mocks.length ? mocks.reduce((a, b) => a + b, 0) / mocks.length : null;
  const preparation = mockAvg == null ? overall * 0.9 : 0.6 * overall + 0.4 * mockAvg;

  let label: ReadinessLabel;
  if (preparation >= 0.8 && coverage >= 0.8 && input.mockScores.length >= 2) label = 'EXCELLENT';
  else if (preparation >= 0.65 && coverage >= 0.6) label = 'GOOD';
  else if (preparation >= 0.45 && coverage >= 0.3) label = 'NEEDS_IMPROVEMENT';
  else label = 'NOT_READY';

  if (input.mockScores.length === 0) reasons.push({ ar: 'لم تُجرِ أي امتحان تجريبي بعد — النتيجة تقديرية.', fr: 'Aucun examen blanc réalisé — résultat indicatif.' });
  else if (input.mockScores.length < 2 && preparation >= 0.8) reasons.push({ ar: 'تحتاج إلى امتحانين تجريبيين على الأقل لبلوغ "تحضير ممتاز".', fr: 'Au moins deux examens blancs sont nécessaires pour « Excellent ».' });
  if (coverage < 0.6) reasons.push({ ar: `غطيت ${Math.round(coverage * 100)}% فقط من مواضيع البرنامج.`, fr: `Vous n’avez couvert que ${Math.round(coverage * 100)} % des thèmes.` });
  const weakest = [...byDomain].sort((a, b) => a.score - b.score)[0];
  if (weakest && weakest.score < 0.55) {
    reasons.push({
      ar: `أضعف مادة: ${weakest.domain} (${Math.round(weakest.score * 100)}%) ووزنها ${Math.round((weakest.weight / totalW) * 100)}% من الامتحان.`,
      fr: `Matière la plus faible : ${weakest.domain} (${Math.round(weakest.score * 100)} %), soit ${Math.round((weakest.weight / totalW) * 100)} % de l’examen.`,
    });
  }
  if (!input.formatOfficial) reasons.push({ ar: 'توزيع المواد تقديري لأن الصيغة الرسمية للامتحان غير منشورة.', fr: 'Pondération estimée : le format officiel n’est pas publié.' });

  // priority = expected gain = weight × (1 - score), on topics then domains
  const topicPriorities = input.topics
    .map((t) => {
      const w = byDomain.find((d) => d.domain === t.domain)?.weight ?? 0;
      return { domain: t.domain, topicId: t.topicId, gain: (w / totalW) * (1 - shrunkMastery(t.rating, t.attempts)) };
    })
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  const domainPriorities = byDomain
    .filter((d) => !input.topics.some((t) => t.domain === d.domain))
    .map((d) => ({ domain: d.domain, gain: (d.weight / totalW) * (1 - d.score) }));
  const priorities = [...topicPriorities, ...domainPriorities].sort((a, b) => b.gain - a.gain).slice(0, 3);

  return {
    overall: Math.round(overall * 100),
    preparation: Math.round(preparation * 100),
    coverage: Math.round(coverage * 100),
    label,
    byDomain: byDomain.map((d) => ({ ...d, score: Math.round(d.score * 100), coverage: Math.round(d.coverage * 100) })),
    reasons,
    priorities,
    disclaimer: {
      ar: 'هذا مؤشر لمستوى تحضيرك داخل المنصة وليس توقعًا لنتيجة المناظرة. النجاح يعتمد أيضًا على عدد المترشحين والمراحل الأخرى (رياضية، شفاهية، طبية).',
      fr: 'Indicateur de préparation sur la plateforme, pas une prédiction du résultat. La réussite dépend aussi du nombre de candidats et des autres épreuves (sport, oral, médical).',
    },
  };
}

// ───────────────────────────── Daily plan ─────────────────────────────

export interface PlanTopic {
  topicId: string;
  domain: Domain;
  title: string;
  examWeight: number; // domain weight in the exam
  mastery: number; // 0..1 (shrunk)
  dueForReview: boolean;
  daysSinceSeen: number | null;
}

export interface PlanItem {
  kind: 'PRACTICE' | 'REVIEW' | 'LESSON' | 'MOCK' | 'MISTAKES';
  topicId?: string;
  domain?: Domain;
  title: string;
  questions?: number;
  minutes: number;
}

/**
 * Builds today's plan. ~1 question ≈ 1 minute. Priority = weight × (1 - mastery) × recency boost.
 * 20% of time goes to spaced review; a mock exam is scheduled weekly (or twice a week in the last 3 weeks).
 */
export function buildDailyPlan(opts: {
  topics: PlanTopic[];
  dailyMinutes: number;
  daysToExam: number | null;
  dayOfWeek: number; // 0=Sunday
  mistakesPending: number;
  mockEveryNDays?: number;
}): PlanItem[] {
  const items: PlanItem[] = [];
  let budget = Math.max(10, opts.dailyMinutes);

  const closeToExam = opts.daysToExam != null && opts.daysToExam <= 21 && opts.daysToExam >= 0;
  const mockDay = closeToExam ? opts.dayOfWeek === 2 || opts.dayOfWeek === 5 : opts.dayOfWeek === 5;
  if (mockDay && budget >= 30 && opts.daysToExam !== null) {
    items.push({ kind: 'MOCK', title: 'Mock exam', minutes: Math.min(budget, 90) });
    budget -= Math.min(budget, 90);
  }

  if (opts.mistakesPending > 0 && budget > 0) {
    const m = Math.min(10, opts.mistakesPending, Math.ceil(budget * 0.2));
    items.push({ kind: 'MISTAKES', title: 'Mistakes review', questions: m, minutes: m });
    budget -= m;
  }

  const reviewDue = opts.topics.filter((t) => t.dueForReview);
  if (reviewDue.length && budget > 0) {
    const m = Math.max(5, Math.round(budget * 0.2));
    items.push({ kind: 'REVIEW', title: 'Spaced review', questions: m, minutes: m });
    budget -= m;
  }

  const scored = opts.topics
    .map((t) => {
      const recency = t.daysSinceSeen == null ? 1.2 : Math.min(1.5, 1 + t.daysSinceSeen / 14);
      return { t, p: t.examWeight * (1 - t.mastery) * recency };
    })
    .sort((a, b) => b.p - a.p);

  const top = scored.slice(0, 3);
  const totalP = top.reduce((a, b) => a + b.p, 0) || 1;
  for (const { t, p } of top) {
    if (budget < 5) break;
    const q = Math.max(5, Math.round((budget * p) / totalP / 5) * 5);
    const minutes = Math.min(budget, q);
    if (t.mastery < 0.4 && t.daysSinceSeen == null) {
      items.push({ kind: 'LESSON', topicId: t.topicId, domain: t.domain, title: t.title, minutes: Math.min(10, minutes) });
    }
    items.push({ kind: 'PRACTICE', topicId: t.topicId, domain: t.domain, title: t.title, questions: minutes, minutes });
    budget -= minutes;
  }
  return items;
}

// ───────────────────────────── Gamification ─────────────────────────────

export const XP = { CORRECT: 2, ANSWER: 1, DAILY_GOAL: 20, MOCK_DONE: 50, MISTAKE_FIXED: 3, LESSON_DONE: 10 } as const;

/** Level n requires 100 × n^1.5 cumulative XP. */
export function levelFromXp(xp: number): { level: number; current: number; next: number } {
  let level = 1;
  while (100 * Math.pow(level, 1.5) <= xp) level++;
  const prev = level === 1 ? 0 : Math.round(100 * Math.pow(level - 1, 1.5));
  return { level, current: xp - prev, next: Math.round(100 * Math.pow(level, 1.5)) - prev };
}

/** Update a streak given the last active date and today's date (YYYY-MM-DD, Africa/Tunis). */
export function updateStreak(s: { current: number; longest: number; lastActive: string | null; freezes: number }, today: string) {
  if (s.lastActive === today) return { ...s, changed: false };
  const diff = s.lastActive ? Math.round((Date.parse(today) - Date.parse(s.lastActive)) / 86400000) : null;
  let current = 1;
  let freezes = s.freezes;
  if (diff === 1) current = s.current + 1;
  else if (diff === 2 && freezes > 0) { current = s.current + 1; freezes--; }
  const longest = Math.max(s.longest, current);
  return { current, longest, lastActive: today, freezes, changed: true };
}

export const BADGES = [
  { code: 'FIRST_STEP', ar: 'الخطوة الأولى', fr: 'Premier pas', rule: 'Complete the diagnostic test' },
  { code: 'STREAK_7', ar: 'أسبوع متواصل', fr: '7 jours de suite', rule: '7-day streak' },
  { code: 'STREAK_30', ar: 'شهر من الالتزام', fr: '30 jours de suite', rule: '30-day streak' },
  { code: 'Q_100', ar: '100 سؤال', fr: '100 questions', rule: 'Answer 100 questions' },
  { code: 'Q_1000', ar: '1000 سؤال', fr: '1000 questions', rule: 'Answer 1000 questions' },
  { code: 'FIRST_MOCK', ar: 'أول امتحان تجريبي', fr: 'Premier examen blanc', rule: 'Finish a mock exam' },
  { code: 'MOCK_80', ar: '80% في امتحان تجريبي', fr: '80 % à un examen blanc', rule: 'Score ≥ 80% on a mock' },
  { code: 'MISTAKE_HUNTER', ar: 'صائد الأخطاء', fr: 'Chasseur d’erreurs', rule: 'Fix 50 past mistakes' },
] as const;

/**
 * Pure attempt scoring: per-domain breakdown, weak/strong topics and percentile. Scores are percentages (0..100, integers);
 * `attempts.score` in the database stays a 0..1 ratio (read by readiness).
 */
import { DOMAINS, type AttemptResultDTO, type Domain } from '@ctn/shared';

export interface GradedItem {
  questionId: string;
  domain: Domain;
  topicKey: string;
  topicTitleAr: string;
  topicTitleFr: string;
  answered: boolean;
  isCorrect: boolean;
  timeMs: number | null;
}

/** Minimum answered questions on a topic before it is called weak or strong. */
export const MIN_TOPIC_ANSWERS = 2;
export const WEAK_BELOW = 60;
export const STRONG_FROM = 75;
const MAX_TOPICS_LISTED = 5;

export type ResultSummary = Pick<AttemptResultDTO, 'score' | 'correctCount' | 'total' | 'accuracy' | 'byDomain' | 'weakTopics' | 'strongTopics'> & {
  answeredCount: number;
  avgTimeS: number | null;
};

const pct = (num: number, den: number) => (den > 0 ? Math.round((100 * num) / den) : 0);

/**
 * Unanswered questions count as wrong in `score` and the per-domain breakdown (exam semantics), but are ignored for
 * `accuracy` and topic strength (a topic is only judged on what was actually answered).
 */
export function summarize(items: readonly GradedItem[]): ResultSummary {
  const total = items.length;
  const answered = items.filter((i) => i.answered);
  const correctCount = items.filter((i) => i.isCorrect).length;

  const domains = new Map<Domain, { correct: number; total: number }>();
  for (const i of items) {
    const d = domains.get(i.domain) ?? { correct: 0, total: 0 };
    d.total++;
    if (i.isCorrect) d.correct++;
    domains.set(i.domain, d);
  }
  const domainOrder = (d: Domain) => DOMAINS.indexOf(d);
  const byDomain = [...domains.entries()]
    .sort((a, b) => domainOrder(a[0]) - domainOrder(b[0]))
    .map(([domain, d]) => ({ domain, correct: d.correct, total: d.total, score: pct(d.correct, d.total) }));

  const topics = new Map<string, { title_ar: string; title_fr: string; correct: number; n: number }>();
  for (const i of answered) {
    const t = topics.get(i.topicKey) ?? { title_ar: i.topicTitleAr, title_fr: i.topicTitleFr, correct: 0, n: 0 };
    t.n++;
    if (i.isCorrect) t.correct++;
    topics.set(i.topicKey, t);
  }
  const judged = [...topics.entries()]
    .filter(([, t]) => t.n >= MIN_TOPIC_ANSWERS)
    .map(([key, t]) => ({ key, title_ar: t.title_ar, title_fr: t.title_fr, score: pct(t.correct, t.n), n: t.n }));
  const strip = ({ key, title_ar, title_fr, score }: (typeof judged)[number]) => ({ key, title_ar, title_fr, score });
  const weakTopics = judged.filter((t) => t.score < WEAK_BELOW).sort((a, b) => a.score - b.score || b.n - a.n).slice(0, MAX_TOPICS_LISTED).map(strip);
  const strongTopics = judged.filter((t) => t.score >= STRONG_FROM).sort((a, b) => b.score - a.score || b.n - a.n).slice(0, MAX_TOPICS_LISTED).map(strip);

  const times = answered.map((i) => i.timeMs).filter((t): t is number => typeof t === 'number' && t > 0);
  const avgTimeS = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 100) / 10 : null;

  return {
    score: pct(correctCount, total),
    correctCount,
    total,
    accuracy: pct(correctCount, answered.length),
    answeredCount: answered.length,
    byDomain,
    weakTopics,
    strongTopics,
    avgTimeS,
  };
}

/** Minimum number of other submitted mocks on the same blueprint before a percentile is meaningful. */
export const MIN_PERCENTILE_POPULATION = 5;

/** Mid-rank percentile: share of the other attempts scoring below, ties counting half. Null when the population is too small. */
export function percentileOf(below: number, equal: number, population: number): number | null {
  if (population < MIN_PERCENTILE_POPULATION) return null;
  return Math.max(0, Math.min(100, Math.round((100 * (below + equal / 2)) / population)));
}

/** Wall-clock duration of an attempt in seconds, capped at the time limit (+grace) for timed exams. */
export function durationSeconds(startedAt: Date, endedAt: Date, expiresAt: Date | null, graceMs: number): number {
  const end = expiresAt ? Math.min(endedAt.getTime(), expiresAt.getTime() + graceMs) : endedAt.getTime();
  return Math.max(0, Math.round((end - startedAt.getTime()) / 1000));
}

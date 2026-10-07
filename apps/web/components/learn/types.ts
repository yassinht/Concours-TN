/**
 * Client-side shapes of the learning endpoints. The contract DTOs come from @ctn/shared (types only, so zod never
 * reaches the bundle); the API adds a few documented fields on top of them, typed here as optional extras.
 */
import type {
  AttemptKind, AttemptResultDTO, AttemptSessionDTO, Domain, FactDTO, QuestionDTO, SyllabusNodeDTO,
} from '@ctn/shared';

/** A MOCK section as served: `start`/`end` index the attempt's question list. */
export interface SectionMeta { domain: Domain; specialtyKey: string | null; count: number; minutes: number; served: number; filled: number; start: number; end: number }

export type SessionView = AttemptSessionDTO & {
  /** Server clock at response time (the countdown must not trust the device clock). */
  serverTime?: string;
  sections?: SectionMeta[];
  shortfall?: number;
  /** Instant mode: correctness of already-answered questions (resume). */
  results?: Record<string, boolean>;
};

export type ResultView = AttemptResultDTO & {
  answeredCount?: number;
  avgTimeS?: number | null;
  shortfall?: number | null;
  sections?: SectionMeta[];
};

export type AttemptGet = SessionView | { result: ResultView };

export function isResult(a: AttemptGet): a is { result: ResultView } {
  return 'result' in a && !!(a as { result?: unknown }).result;
}

export interface AttemptHistoryItem {
  id: string; kind: AttemptKind; familySlug: string | null; score: number | null; total: number; correctCount?: number | null;
  startedAt?: string; expiresAt?: string | null; submittedAt: string | null;
}

export interface FeedbackView {
  saved: true; isCorrect?: boolean; correct?: unknown; explanation?: string; xpGained?: number; limitReached?: boolean;
  remainingToday?: number | null; newBadges?: string[];
}

export interface EnrollmentRow {
  id: string; familySlug: string; familyName_ar: string; familyName_fr: string; positionSlug: string | null;
  positionTitle_ar: string | null; positionTitle_fr: string | null; targetExamDate: string | null; dailyMinutes: number; isPrimary: boolean;
}

export interface MistakeItem { question: QuestionDTO; timesWrong: number; lastAnsweredAt: string | null; fixed?: boolean; nextReviewAt?: string | null }

export interface LessonsResponse {
  topic: SyllabusNodeDTO;
  lessons: { id: string; title: string; bodyMd: string; estMinutes: number; unreviewed: boolean }[];
}

export interface ProgressView {
  totals: { answered: number; correct: number; accuracy: number; studyDays: number };
  byDomain: { domain: Domain; answered: number; correct?: number; accuracy: number }[];
  last30d: { date: string; answered: number; correct: number }[];
  mastery: { key: string; title_ar: string; title_fr: string; domain: Domain; mastery: number; attempts: number }[];
}

export type ChecklistItem = FactDTO & { checked: boolean };
export interface ChecklistGroup { positionSlug: string | null; positionTitle_ar?: string | null; positionTitle_fr?: string | null; items: ChecklistItem[] }

export interface PhysicalLog { id: string; testCode: string; value: number; unit: string; notes: string | null; loggedAt: string }

export interface BillingUsage {
  entitlements: { premium: boolean; limits: { questionsPerDay: number | null; tutorPerDay?: number; mocksTotal?: number | null } };
  usageToday: { date: string; questions: number; tutor: number };
}

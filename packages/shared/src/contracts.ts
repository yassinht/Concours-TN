/**
 * API contract shared by apps/api (NestJS) and apps/web (Next.js).
 * Request bodies are validated with these zod schemas on the API side.
 * The web app calls the API through the same-origin proxy `/api/*` (Next rewrites → API), cookies are httpOnly.
 * Full endpoint list: docs/api-contract.md
 */
import { z } from 'zod';
import {
  ATTEMPT_KINDS, CONFIDENCES, CONTENT_STATUSES, DIFFICULTIES, DIPLOMA_LEVELS, DOMAINS, EDITION_STATUSES, FIELDS, GENDERS,
  NOTIFICATION_CHANNELS, PAYMENT_PROVIDERS, PHASE_KINDS, QUESTION_TYPES, SOURCE_TYPES,
  type AttemptKind, type Confidence, type ContentStatus, type Difficulty, type DiplomaLevel, type Domain, type EditionStatus,
  type Field, type Gender, type NotificationType, type PaymentProvider, type PaymentStatus, type PhaseKind, type QuestionType,
  type ReadinessLabel, type SourceType, type UserRole, type Locale,
} from './enums';
import type { EligibilityResult, EligibilityRules } from './eligibility';
import type { PlanItem, ReadinessResult } from './learning';

// ───────────── Inputs (zod) ─────────────

export const RegisterInput = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120),
  locale: z.enum(['ar', 'fr']).optional(),
  referralCode: z.string().max(40).optional(),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1) });
export type LoginInput = z.infer<typeof LoginInput>;

export const MagicLinkInput = z.object({ email: z.string().email() });
export const ForgotPasswordInput = z.object({ email: z.string().email() });
export const ResetPasswordInput = z.object({ token: z.string().min(10), password: z.string().min(8).max(200) });

export const ProfileInput = z.object({
  name: z.string().min(1).max(120).optional(),
  locale: z.enum(['ar', 'fr']).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gender: z.enum(GENDERS).nullable().optional(),
  diplomaLevel: z.enum(DIPLOMA_LEVELS).nullable().optional(),
  specialties: z.array(z.string().max(80)).max(10).optional(),
  governorate: z.string().max(40).nullable().optional(),
  heightCm: z.number().int().min(120).max(230).nullable().optional(),
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'OTHER']).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  alertsEnabled: z.boolean().optional(),
  alertFields: z.array(z.enum(FIELDS)).optional(),
  alertChannels: z.array(z.enum(NOTIFICATION_CHANNELS)).optional(),
  dailyReminderHour: z.number().int().min(0).max(23).nullable().optional(),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const EnrollmentInput = z.object({
  familySlug: z.string(),
  positionSlug: z.string().nullable().optional(),
  targetExamDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dailyMinutes: z.number().int().min(10).max(240).default(30),
  isPrimary: z.boolean().optional(),
});
export type EnrollmentInput = z.infer<typeof EnrollmentInput>;

export const EligibilityInput = z.object({
  familySlug: z.string(),
  positionSlug: z.string().optional(),
  profile: ProfileInput.pick({ birthDate: true, gender: true, diplomaLevel: true, specialties: true, heightCm: true, maritalStatus: true }).optional(),
});
export type EligibilityInput = z.infer<typeof EligibilityInput>;

export const StartAttemptInput = z.object({
  kind: z.enum(ATTEMPT_KINDS),
  familySlug: z.string().optional(),
  positionSlug: z.string().optional(),
  topicKey: z.string().optional(),
  domain: z.enum(DOMAINS).optional(),
  count: z.number().int().min(1).max(200).optional(),
});
export type StartAttemptInput = z.infer<typeof StartAttemptInput>;

export const AnswerValue = z.union([
  z.array(z.string()),
  z.object({ value: z.number() }),
  z.object({ pairs: z.array(z.tuple([z.string(), z.string()])) }),
  z.object({ order: z.array(z.string()) }),
  z.null(),
]);
export const AnswerInput = z.object({ questionId: z.string().uuid(), answer: AnswerValue, timeMs: z.number().int().min(0).max(3_600_000).optional() });
export type AnswerInput = z.infer<typeof AnswerInput>;

export const TutorInput = z.object({ questionId: z.string().uuid(), answer: AnswerValue, locale: z.enum(['ar', 'fr']).optional() });
export type TutorInput = z.infer<typeof TutorInput>;

export const ReportQuestionInput = z.object({ reason: z.enum(['WRONG_ANSWER', 'AMBIGUOUS', 'TYPO', 'OUTDATED', 'OTHER']), comment: z.string().max(1000).optional() });

export const PushSubscribeInput = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

export const CheckoutInput = z.object({ planCode: z.string(), provider: z.enum(PAYMENT_PROVIDERS), promoCode: z.string().max(40).optional() });
export type CheckoutInput = z.infer<typeof CheckoutInput>;
export const ManualProofInput = z.object({ paymentId: z.string().uuid(), reference: z.string().min(3).max(200) });

export const WaitlistInput = z.object({
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  familySlug: z.string().optional(),
  willingness: z.enum(['0', '10', '20', '40', '60+']).optional(),
  utm: z.record(z.string()).optional(),
}).refine((v) => v.email || v.phone, { message: 'email or phone required' });

export const PhysicalLogInput = z.object({ testCode: z.string().max(40), value: z.number(), unit: z.string().max(10), notes: z.string().max(300).optional(), loggedAt: z.string().optional() });

// Admin inputs
export const ReviewActionInput = z.object({ action: z.enum(['approve', 'reject', 'publish', 'archive', 'to_draft']), comment: z.string().max(2000).optional() });
export const QuestionUpsertInput = z.object({
  type: z.enum(QUESTION_TYPES),
  domain: z.enum(DOMAINS),
  language: z.enum(['ar', 'fr', 'en']),
  stem: z.string().min(3),
  options: z.array(z.object({ id: z.string(), text: z.string(), side: z.enum(['left', 'right']).optional() })),
  correct: z.any(),
  explanation: z.string().min(3),
  difficulty: z.enum(DIFFICULTIES),
  topicKey: z.string(),
  objectiveKeys: z.array(z.string()).min(1),
  familySlugs: z.array(z.string()).default([]),
  isGeneral: z.boolean().default(true),
  sourceId: z.string().uuid().nullable().optional(),
  year: z.number().int().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
});
export const EditionUpsertInput = z.object({
  familySlug: z.string(),
  year: z.number().int(),
  sessionLabel: z.string().nullable().optional(),
  status: z.enum(EDITION_STATUSES),
  registrationOpen: z.string().nullable().optional(),
  registrationDeadline: z.string().nullable().optional(),
  examDate: z.string().nullable().optional(),
  positionsCount: z.number().int().nullable().optional(),
  positionSlugs: z.array(z.string()).default([]),
  announcementUrl: z.string().url().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  confidence: z.enum(CONFIDENCES).default('MEDIUM'),
  needsVerification: z.boolean().default(true),
});
export const SourceUpsertInput = z.object({
  title: z.string().min(2),
  url: z.string().url().nullable().optional(),
  publisher: z.string().nullable().optional(),
  sourceType: z.enum(SOURCE_TYPES),
  publicationDate: z.string().nullable().optional(),
  confidence: z.enum(CONFIDENCES),
  notes: z.string().nullable().optional(),
});
export const FactVerifyInput = z.object({
  needsVerification: z.boolean(),
  confidence: z.enum(CONFIDENCES).optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceQuote: z.string().nullable().optional(),
  sourcePage: z.number().int().nullable().optional(),
});
export const BroadcastInput = z.object({
  title: z.string().min(2).max(120),
  body: z.string().min(2).max(500),
  url: z.string().max(300).optional(),
  segment: z.object({ familySlug: z.string().optional(), field: z.enum(FIELDS).optional(), premiumOnly: z.boolean().optional() }).default({}),
});
export const AiGenerateInput = z.object({ topicKey: z.string(), count: z.number().int().min(1).max(30), difficulty: z.enum(DIFFICULTIES).optional(), language: z.enum(['ar', 'fr', 'en']).optional() });
export const AiExtractInput = z.object({ documentId: z.string().uuid().optional(), text: z.string().max(200_000).optional(), familySlug: z.string().optional() });

// ───────────── Response DTOs (TypeScript only) ─────────────

export interface Provenance {
  source: { id: string; title: string; url: string | null; sourceType: SourceType; publicationDate: string | null } | null;
  confidence: Confidence;
  needsVerification: boolean;
  sourceQuote?: string | null;
  lastVerifiedAt?: string | null;
}

export interface MeDTO {
  id: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  isGuest: boolean;
  locale: Locale;
  referralCode: string;
  premium: { active: boolean; planCode: string | null; endsAt: string | null };
  stats: { xp: number; level: number; streak: number };
  onboarding: { hasProfile: boolean; hasEnrollment: boolean; diagnosticDone: boolean };
}

export interface ProfileDTO {
  name: string | null; email: string | null; phone: string | null; locale: Locale;
  birthDate: string | null; gender: Gender | null; diplomaLevel: DiplomaLevel | null; specialties: string[];
  governorate: string | null; heightCm: number | null; maritalStatus: 'SINGLE' | 'MARRIED' | 'OTHER' | null;
  alertsEnabled: boolean; alertFields: Field[]; alertChannels: ('IN_APP' | 'PUSH' | 'EMAIL')[]; dailyReminderHour: number | null;
}

export interface OrganizationDTO { slug: string; name_ar: string; name_fr: string; ministry_fr: string | null; website: string | null }

export interface EditionDTO extends Provenance {
  id: string; familySlug: string; familyName_ar: string; familyName_fr: string; field: Field;
  year: number; sessionLabel: string | null; status: EditionStatus;
  registrationOpen: string | null; registrationDeadline: string | null; examDate: string | null;
  positionsCount: number | null; candidatesCount: number | null; positionSlugs: string[]; announcementUrl: string | null;
}

export interface FamilySummaryDTO {
  slug: string; field: Field; name_ar: string; name_fr: string; description_ar: string; description_fr: string;
  organization: OrganizationDTO; popularity: number; keywords: string[];
  nextEdition: EditionDTO | null; positionsCount: number; questionCount: number;
}

export interface PhaseDTO extends Provenance { order: number; kind: PhaseKind; name_ar: string; name_fr: string; isEliminatory: boolean; durationMinutes: number | null; description_ar: string | null; description_fr: string | null }
export interface SubjectDTO extends Provenance { phaseOrder: number; domain: Domain; specialtyKey: string | null; name_ar: string; name_fr: string; coefficient: number | null; durationMinutes: number | null; questionCount: number | null }
export interface FactDTO extends Provenance { id: string; key: string; display_ar: string; display_fr: string; details_ar: string | null; details_fr: string | null }
export interface BlueprintDTO { id: string; title: string; totalMinutes: number; fidelity: 'OFFICIAL_FORMAT' | 'APPROXIMATED'; sections: { domain: Domain; specialtyKey: string | null; count: number; minutes: number }[] }

export interface PositionDTO {
  slug: string; title_ar: string; title_fr: string; diplomaLevel: DiplomaLevel;
  eligibility: EligibilityRules & Provenance;
  phases: PhaseDTO[]; subjects: SubjectDTO[]; physicalTests: FactDTO[]; requiredDocuments: FactDTO[];
  blueprint: BlueprintDTO | null;
}

export interface SyllabusNodeDTO {
  id: string; key: string; parentKey: string | null; level: 'SUBJECT' | 'UNIT' | 'TOPIC'; domain: Domain;
  title_ar: string; title_fr: string; scope: 'OFFICIAL_PROGRAM' | 'INFERRED_FROM_PAST_EXAMS' | 'GENERAL_SKILL' | 'SUGGESTED';
  source: Provenance['source']; questionCount: number; mastery?: number | null; hasLesson?: boolean;
  objectives: { key: string; text_ar: string; text_fr: string }[];
  children?: SyllabusNodeDTO[];
}

export interface FamilyDetailDTO extends FamilySummaryDTO {
  sources: (NonNullable<Provenance['source']> & { publisher: string | null; confidence: Confidence; notes: string | null; lastVerifiedAt: string | null })[];
  editions: EditionDTO[];
  positions: PositionDTO[];
  syllabus: SyllabusNodeDTO[];
  pastExams: { year: number; title: string; url: string | null; sourceType: SourceType; isVerified: boolean }[];
  tips_ar: string[]; tips_fr: string[];
  frequency: string; researchNotes: string | null;
}

export interface QuestionDTO {
  id: string; type: QuestionType; domain: Domain; language: 'ar' | 'fr' | 'en';
  stem: string; options: { id: string; text: string; side?: 'left' | 'right' }[];
  difficulty: Difficulty; topicKey: string; topicTitle_ar: string; topicTitle_fr: string;
  origin: string; year: number | null; sourceLabel: string | null;
  /** True when the question has not been reviewed by a human (beta content). */
  unreviewed: boolean;
  bookmarked?: boolean;
  /** Only present in instant-feedback modes after answering, or in result review. */
  correct?: unknown; explanation?: string;
}

export interface AttemptSessionDTO {
  id: string; kind: AttemptKind; mode: 'instant' | 'exam';
  startedAt: string; expiresAt: string | null; durationMinutes: number | null;
  familySlug: string | null; positionSlug: string | null; blueprintFidelity: 'OFFICIAL_FORMAT' | 'APPROXIMATED' | null;
  questions: QuestionDTO[];
  answered: Record<string, unknown>;
}

export interface AnswerFeedbackDTO { saved: true; isCorrect?: boolean; correct?: unknown; explanation?: string; xpGained?: number; limitReached?: boolean }

export interface AttemptResultDTO {
  id: string; kind: AttemptKind; score: number; correctCount: number; total: number; durationS: number; accuracy: number;
  byDomain: { domain: Domain; correct: number; total: number; score: number }[];
  weakTopics: { key: string; title_ar: string; title_fr: string; score: number }[];
  strongTopics: { key: string; title_ar: string; title_fr: string; score: number }[];
  readiness: ReadinessResult | null;
  xpGained: number; newBadges: string[];
  review: { question: QuestionDTO; answer: unknown; isCorrect: boolean }[];
  percentile: number | null;
}

export interface TutorResponseDTO {
  why_wrong: string; concept: string; example: string;
  similar_question: QuestionDTO | null;
  review_topic: { key: string; title_ar: string; title_fr: string } | null;
  citations: { title: string; url: string | null; sourceType: SourceType }[];
  cached: boolean; ai: boolean; remainingToday: number | null;
}

export interface TodayPlanDTO { date: string; enrollmentId: string | null; familySlug: string | null; daysToExam: number | null; items: (PlanItem & { done: boolean })[] }

export interface ReadinessDTO extends ReadinessResult { familySlug: string; topicTitles: Record<string, { ar: string; fr: string }>; history: { date: string; preparation: number }[] }

export interface NotificationDTO { id: string; type: NotificationType; title: string; body: string; url: string | null; readAt: string | null; createdAt: string; data: Record<string, unknown> }

export interface GamificationDTO { xp: number; level: number; levelProgress: { current: number; next: number }; streak: { current: number; longest: number; freezes: number }; badges: { code: string; awardedAt: string }[]; todayXp: number; dailyGoalXp: number }
export interface LeaderboardDTO { period: 'week' | 'all'; familySlug: string | null; top: { rank: number; name: string; xp: number; isMe: boolean }[]; me: { rank: number; xp: number } | null }

export interface PlanDTO { code: string; name_ar: string; name_fr: string; priceMillimes: number; period: string; durationDays: number; features: Record<string, unknown> }
export interface CheckoutResultDTO { paymentId: string; provider: PaymentProvider; redirectUrl: string | null; instructions_ar?: string; instructions_fr?: string; amountMillimes: number }
export interface BillingMeDTO { subscription: { planCode: string; status: string; startsAt: string; endsAt: string } | null; payments: { id: string; amountMillimes: number; provider: PaymentProvider; status: PaymentStatus; createdAt: string; planCode: string }[] }

export interface AdminStatsDTO {
  users: { total: number; registered: number; guests: number; active7d: number; premium: number };
  revenue: { last30dMillimes: number; totalMillimes: number; pendingManual: number };
  content: { questions: Record<ContentStatus, number>; factsNeedingVerification: number; openReports: number };
  funnel: { visitors: number; diagnostic: number; registered: number; paid: number };
  weakTopics: { key: string; title_ar: string; title_fr: string; errorRate: number; answers: number }[];
  waitlist: number;
}

export type { EligibilityResult, EligibilityRules, PlanItem, ReadinessResult, ReadinessLabel, ContentStatus };
export const _ENUMS_FOR_FORMS = { CONTENT_STATUSES, FIELDS, PHASE_KINDS };

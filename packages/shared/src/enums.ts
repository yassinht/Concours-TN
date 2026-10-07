// Shared enums — single source of truth for API, web and DB (mirrored as pgEnums in apps/api/src/db/schema.ts).

export const SOURCE_TYPES = ['OFFICIAL', 'SECONDARY', 'COMMUNITY', 'SUGGESTED'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CONTENT_STATUSES = ['DRAFT', 'AI_REVIEWED', 'HUMAN_REVIEWED', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Allowed content workflow transitions. PUBLISHED requires a human reviewer (enforced in API). */
export const CONTENT_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  DRAFT: ['AI_REVIEWED', 'HUMAN_REVIEWED', 'ARCHIVED'],
  AI_REVIEWED: ['HUMAN_REVIEWED', 'DRAFT', 'ARCHIVED'],
  HUMAN_REVIEWED: ['PUBLISHED', 'DRAFT', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED', 'DRAFT'],
  ARCHIVED: ['DRAFT'],
};

export const FIELDS = [
  'SECURITY', 'CUSTOMS', 'EDUCATION', 'HEALTH', 'FINANCE', 'PUBLIC_COMPANY', 'ADMINISTRATION', 'DEFENSE', 'TECHNICAL',
] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABELS: Record<Field, { ar: string; fr: string }> = {
  SECURITY: { ar: 'الأمن والحماية', fr: 'Sécurité' },
  CUSTOMS: { ar: 'الديوانة', fr: 'Douane' },
  EDUCATION: { ar: 'التعليم', fr: 'Éducation' },
  HEALTH: { ar: 'الصحة', fr: 'Santé' },
  FINANCE: { ar: 'البنوك والمالية', fr: 'Banques & finance' },
  PUBLIC_COMPANY: { ar: 'المؤسسات العمومية', fr: 'Entreprises publiques' },
  ADMINISTRATION: { ar: 'الإدارة', fr: 'Administration' },
  DEFENSE: { ar: 'الدفاع', fr: 'Défense' },
  TECHNICAL: { ar: 'الأسلاك التقنية', fr: 'Corps techniques' },
};

export const EDITION_STATUSES = ['EXPECTED', 'ANNOUNCED', 'OPEN', 'CLOSED', 'EXAM_DONE', 'RESULTS'] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];

export const DIPLOMA_LEVELS = [
  'NONE', 'PRIMARY', 'NINTH', 'SECONDARY', 'BAC', 'BAC_PLUS_2', 'LICENCE', 'MASTER', 'ENGINEER', 'DOCTORATE', 'MEDICINE',
] as const;
export type DiplomaLevel = (typeof DIPLOMA_LEVELS)[number];

/** Rank used for "at least" comparisons. MASTER and ENGINEER are equivalent (bac+5). */
export const DIPLOMA_RANK: Record<DiplomaLevel, number> = {
  NONE: 0, PRIMARY: 1, NINTH: 2, SECONDARY: 3, BAC: 4, BAC_PLUS_2: 5, LICENCE: 6, MASTER: 7, ENGINEER: 7, DOCTORATE: 8, MEDICINE: 8,
};

export const DIPLOMA_LABELS: Record<DiplomaLevel, { ar: string; fr: string }> = {
  NONE: { ar: 'بدون شهادة', fr: 'Sans diplôme' },
  PRIMARY: { ar: 'التعليم الابتدائي', fr: 'Primaire' },
  NINTH: { ar: 'السنة التاسعة أساسي', fr: '9ème année de base' },
  SECONDARY: { ar: 'مستوى ثانوي (دون باكالوريا)', fr: 'Niveau secondaire (sans bac)' },
  BAC: { ar: 'الباكالوريا', fr: 'Baccalauréat' },
  BAC_PLUS_2: { ar: 'باكالوريا + 2', fr: 'Bac + 2' },
  LICENCE: { ar: 'الإجازة', fr: 'Licence' },
  MASTER: { ar: 'الماجستير', fr: 'Master' },
  ENGINEER: { ar: 'شهادة مهندس', fr: 'Diplôme d’ingénieur' },
  DOCTORATE: { ar: 'الدكتوراه', fr: 'Doctorat' },
  MEDICINE: { ar: 'دكتوراه في الطب', fr: 'Doctorat en médecine' },
};

export const PHASE_KINDS = ['WRITTEN', 'PHYSICAL', 'ORAL', 'PSYCHOTECH', 'MEDICAL', 'FILE_REVIEW', 'INTERVIEW', 'TRAINING'] as const;
export type PhaseKind = (typeof PHASE_KINDS)[number];

export const DOMAINS = ['CULTURE_GENERALE', 'ARABIC', 'FRENCH', 'ENGLISH', 'LOGIC', 'NUMERICAL', 'PSYCHOTECH', 'SPECIALTY'] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<Domain, { ar: string; fr: string }> = {
  CULTURE_GENERALE: { ar: 'الثقافة العامة', fr: 'Culture générale' },
  ARABIC: { ar: 'العربية', fr: 'Arabe' },
  FRENCH: { ar: 'الفرنسية', fr: 'Français' },
  ENGLISH: { ar: 'الإنجليزية', fr: 'Anglais' },
  LOGIC: { ar: 'المنطق', fr: 'Logique' },
  NUMERICAL: { ar: 'الحساب', fr: 'Calcul' },
  PSYCHOTECH: { ar: 'نفسي-تقني', fr: 'Psychotechnique' },
  SPECIALTY: { ar: 'الاختصاص', fr: 'Spécialité' },
};

export const QUESTION_TYPES = ['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'MATCHING', 'ORDERING', 'NUMERIC'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const QUESTION_ORIGINS = ['PAST_EXAM_VERBATIM', 'PAST_EXAM_REWRITTEN', 'AUTHORED', 'AI_GENERATED', 'ALGORITHMIC'] as const;
export type QuestionOrigin = (typeof QUESTION_ORIGINS)[number];

export const SYLLABUS_LEVELS = ['SUBJECT', 'UNIT', 'TOPIC'] as const;
export type SyllabusLevel = (typeof SYLLABUS_LEVELS)[number];

export const SYLLABUS_SCOPES = ['OFFICIAL_PROGRAM', 'INFERRED_FROM_PAST_EXAMS', 'GENERAL_SKILL', 'SUGGESTED'] as const;
export type SyllabusScope = (typeof SYLLABUS_SCOPES)[number];

export const ATTEMPT_KINDS = ['DIAGNOSTIC', 'PRACTICE', 'DAILY', 'MOCK', 'REVIEW'] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

export const USER_ROLES = ['USER', 'EDITOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const GENDERS = ['M', 'F'] as const;
export type Gender = (typeof GENDERS)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TYPES = [
  'CONCOURS_MATCH', // new/open concours matching the user's profile
  'CONCOURS_UPDATE', // followed concours changed (dates, results...)
  'DEADLINE_REMINDER',
  'EXAM_REMINDER',
  'STUDY_REMINDER',
  'STREAK_AT_RISK',
  'SUBSCRIPTION',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SUBSCRIPTION_STATUSES = ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PROVIDERS = ['KONNECT', 'FLOUCI', 'MANUAL', 'MOCK'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const READINESS_LABELS = ['EXCELLENT', 'GOOD', 'NEEDS_IMPROVEMENT', 'NOT_READY'] as const;
export type ReadinessLabel = (typeof READINESS_LABELS)[number];

export const READINESS_LABEL_TEXT: Record<ReadinessLabel, { ar: string; fr: string }> = {
  EXCELLENT: { ar: 'تحضير ممتاز', fr: 'Excellent preparation' },
  GOOD: { ar: 'تحضير جيد', fr: 'Good preparation' },
  NEEDS_IMPROVEMENT: { ar: 'يحتاج إلى تحسين', fr: 'Needs improvement' },
  NOT_READY: { ar: 'غير جاهز بعد', fr: 'Not ready yet' },
};

export const GOVERNORATES = [
  'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Nabeul', 'Zaghouan', 'Bizerte', 'Béja', 'Jendouba', 'Le Kef', 'Siliana',
  'Sousse', 'Monastir', 'Mahdia', 'Sfax', 'Kairouan', 'Kasserine', 'Sidi Bouzid', 'Gabès', 'Médenine', 'Tataouine',
  'Gafsa', 'Tozeur', 'Kébili',
] as const;
export type Governorate = (typeof GOVERNORATES)[number];

export type Locale = 'ar' | 'fr';

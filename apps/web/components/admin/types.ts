/**
 * Response shapes of the admin endpoints (docs/api-contract.md "admin" + "ingestion & ai"), as served by
 * apps/api/src/modules/admin and apps/api/src/modules/ingestion. Contract DTOs come from @ctn/shared (types only).
 */
import type {
  AdminStatsDTO, Confidence, ContentStatus, Difficulty, DiplomaLevel, Domain, EditionStatus, EligibilityRules, Field, Gender, PaymentProvider,
  PaymentStatus, PhaseKind, QuestionType, SourceType, UserRole,
} from '@ctn/shared';

export interface PersonRef { id: string; name: string | null }
export interface LastReview { fromStatus: string | null; toStatus: string; comment: string | null; at: string; reviewer: PersonRef | null }

export interface SourceRef {
  id: string; title: string; url: string | null; publisher: string | null; sourceType: SourceType | string; confidence: Confidence | string;
  publicationDate: string | null; lastVerifiedAt: string | null;
}

export interface QuestionOption { id: string; text: string; side?: 'left' | 'right' }

export interface AdminQuestionDetail {
  entity: 'question';
  id: string; extId: string | null; status: ContentStatus; version: number;
  type: QuestionType; domain: Domain; language: 'ar' | 'fr' | 'en' | string; difficulty: Difficulty; rating: number;
  stem: string; options: QuestionOption[]; correct: unknown; explanation: string;
  topic: { key: string; title_ar: string; title_fr: string; level: string };
  objectives: { key: string; text_ar: string; text_fr: string }[];
  families: { slug: string; name_ar: string; name_fr: string }[];
  isGeneral: boolean; origin: string; year: number | null; validUntil: string | null; tags: string[];
  source: SourceRef | null;
  ai: { model: string; promptVersion: string | null } | null;
  createdBy: PersonRef | null; reviewedBy: PersonRef | null; reviewedAt: string | null;
  stats: { attempts: number; correct: number; accuracy: number | null; openReports: number };
  lastReview: LastReview | null;
  createdAt: string; updatedAt: string;
}

export interface QuestionHistoryItem { fromStatus: string | null; toStatus: string; comment: string | null; at: string; reviewer: PersonRef | null }
export interface QuestionReportRow { id: string; reason: string; comment: string | null; status: string; createdAt: string }
export type AdminQuestionFull = AdminQuestionDetail & { history: QuestionHistoryItem[]; reports: QuestionReportRow[] };

export interface AdminLessonDetail {
  entity: 'lesson';
  id: string; status: ContentStatus; version: number; language: string; title: string; bodyMd: string; estMinutes: number; origin: string;
  topic: { key: string; title_ar: string; title_fr: string; domain: Domain };
  reviewedBy: PersonRef | null; lastReview: LastReview | null; updatedAt: string;
}

export interface EditionAlertReach { sentAt: string | null; matchedUsers: number; notifiedUsers: number; announceable: boolean; blockedBy: string | null }

export interface AdminEdition {
  entity: 'edition';
  id: string; familySlug: string; familyName_ar: string; familyName_fr: string; field: Field;
  year: number; sessionLabel: string | null; status: EditionStatus; effectiveStatus: EditionStatus; contentStatus: ContentStatus;
  registrationOpen: string | null; registrationDeadline: string | null; examDate: string | null;
  positionsCount: number | null; candidatesCount: number | null; positionSlugs: string[]; announcementUrl: string | null;
  source: SourceRef | null; confidence: Confidence; needsVerification: boolean;
  alerts: EditionAlertReach;
  lastReview: LastReview | null;
  createdAt: string; updatedAt: string;
}

export interface EditionAlertOutcome {
  alerts: { matchedUsers: number; notified: number } | null;
  updateNotified: number;
  updateSummary: { ar: string; fr: string } | null;
}

export interface AdminFact {
  entity: 'fact';
  id: string; familySlug: string; familyName_ar: string; familyName_fr: string; positionSlug: string | null;
  key: string; display_ar: string; display_fr: string; details_ar: string | null; details_fr: string | null; value: unknown;
  source: SourceRef | null; sourcePage: number | null; sourceQuote: string | null;
  confidence: Confidence; needsVerification: boolean; lastVerifiedAt: string | null; status: ContentStatus;
  lastReview: LastReview | null;
}

export type ReviewEntity = 'question' | 'fact' | 'lesson' | 'edition';
export type ReviewItem = AdminQuestionDetail | AdminLessonDetail | AdminFact | AdminEdition;
export type ReviewAction = 'approve' | 'reject' | 'publish' | 'archive' | 'to_draft';

export interface ReviewQueueResponse { entity: ReviewEntity; status: ContentStatus | null; needsVerification: boolean | null; total: number; items: ReviewItem[] }
export interface ReviewResult { entity: ReviewEntity; id: string; from: ContentStatus; status: ContentStatus; needsVerification?: boolean; alerts?: EditionAlertOutcome; item: ReviewItem | null }
export interface BulkReviewResult { action: ReviewAction; ok: { id: string; status: ContentStatus }[]; failed: { id: string; error: string }[] }

export interface AdminStats extends AdminStatsDTO {
  funnelDetail?: { steps: Record<string, number>; source: Record<string, 'events' | 'tables' | 'none'> };
  content: AdminStatsDTO['content'] & { lessons?: Record<ContentStatus, number>; editionsNeedingVerification?: number };
  revenue: AdminStatsDTO['revenue'] & { pendingManualWithProof?: number; paidLast30d?: number };
  alerts?: { pendingEditions: number; matchesLast30d: number; notifiedLast30d: number; usersWithAlertsEnabled: number };
  generatedAt?: string;
}

export interface QuestionSummary {
  id: string; extId: string | null; type: QuestionType; domain: Domain; language: string; difficulty: Difficulty;
  status: ContentStatus; version: number; origin: string; stem: string;
  topicKey: string; topicTitle_ar: string; topicTitle_fr: string; year: number | null; aiModel: string | null;
  reviewedAt: string | null; createdAt: string; updatedAt: string;
  stats: { attempts: number; correct: number; accuracy: number | null; openReports: number };
}
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export type QuestionsResponse = Paged<QuestionSummary> & { counts: Record<ContentStatus, number> };

export interface FamilyListItem {
  slug: string; field: Field; name_ar: string; name_fr: string; status: ContentStatus; popularity: number; frequency: string;
  organization: { slug: string; name_ar: string; name_fr: string };
  counts: { positions: number; editions: number; openEditions: number; followers: number; enrolled: number; linkedQuestions: number; factsToVerify: number };
  updatedAt: string;
}

export interface ProvenanceAdmin { source: SourceRef | null; confidence: Confidence; needsVerification: boolean; sourceQuote: string | null }

export interface AdminPhase extends ProvenanceAdmin {
  id: string; order: number; kind: PhaseKind; name_ar: string; name_fr: string; isEliminatory: boolean; durationMinutes: number | null;
  description_ar: string | null; description_fr: string | null;
}
export interface AdminSubject extends ProvenanceAdmin {
  id: string; phaseOrder: number; domain: Domain; specialtyKey: string | null; name_ar: string; name_fr: string; coefficient: number | null;
  durationMinutes: number | null; questionCount: number | null;
}
export interface BlueprintSectionRow { domain: Domain; specialtyKey: string | null; count: number; minutes: number }

export interface AdminPosition {
  id: string; slug: string; title_ar: string; title_fr: string; diplomaLevel: DiplomaLevel; orderIndex: number; status: ContentStatus;
  eligibility: EligibilityRules;
  eligibilityProvenance: ProvenanceAdmin;
  phases?: AdminPhase[];
  subjects?: AdminSubject[];
  blueprints?: { id: string; title: string; totalMinutes: number; fidelity: 'OFFICIAL_FORMAT' | 'APPROXIMATED'; sections: BlueprintSectionRow[]; status: ContentStatus }[];
}

export interface FamilyDetail {
  slug: string; field: Field; status: ContentStatus;
  name_ar: string; name_fr: string; description_ar: string; description_fr: string;
  frequency: string; popularity: number; keywords: string[]; tips_ar: string[]; tips_fr: string[]; researchNotes: string | null;
  organization: { slug: string; name_ar: string; name_fr: string; ministry_fr: string | null; website: string | null } | null;
  positions: AdminPosition[];
  editions: AdminEdition[];
  facts: AdminFact[];
  pastExams: { id: string; year: number; title: string; url: string | null; sourceType: SourceType; isVerified: boolean }[];
  updatedAt: string;
}

export type FactKind = 'fact' | 'phase' | 'subject' | 'eligibility' | 'edition';
export interface FactItem {
  kind: FactKind;
  id: string;
  familySlug: string; familyName_ar: string; familyName_fr: string;
  positionSlug: string | null; positionTitle_ar: string | null; positionTitle_fr: string | null;
  label_ar: string; label_fr: string;
  value: unknown;
  source: SourceRef | null; sourceQuote: string | null; sourcePage: number | null;
  confidence: Confidence; needsVerification: boolean; lastVerifiedAt: string | null; status: ContentStatus | null;
}
export interface FactsResponse { items: FactItem[]; total: number; counts: Record<FactKind, number> }

export interface SourceRow {
  id: string; title: string; url: string | null; publisher: string | null; sourceType: SourceType; publicationDate: string | null;
  confidence: Confidence; notes: string | null; retrievedAt: string | null; lastVerifiedAt: string | null; createdAt: string; usage?: number;
}

export interface DocumentSummary {
  id: string; filename: string | null; mime: string; sha256: string; pageCount: number | null; language: string | null; ocrStatus: string;
  source: { id: string; title: string; url: string | null } | null; uploadedBy: string | null; createdAt: string; chunkCount: number;
}
export interface DocumentDetail extends DocumentSummary { textLength: number; chunks: { id: string; page: number; chunkIndex: number; text: string }[] }

export interface AiJob {
  id: string; kind: 'EXTRACT_FACTS' | 'GENERATE_QUESTIONS' | 'GENERATE_ALGORITHMIC' | string; status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | string;
  input: unknown; output: unknown; model: string | null; promptVersion: string | null; tokensIn: number | null; tokensOut: number | null;
  error: string | null; createdBy: string | null; createdAt: string; finishedAt: string | null;
}

export interface Quoted { source_quote: string; page: number | null; quote_verified: boolean }
export interface FieldQuote { source_quote: string; page: number | null }
export interface EditionProposal extends Quoted {
  year: number | null; session_label: string | null; registration_open: string | null; registration_deadline: string | null; exam_date: string | null;
  positions_count: number | null;
  field_quotes?: Partial<Record<'year' | 'registration_open' | 'registration_deadline' | 'exam_date' | 'positions_count', FieldQuote>>;
}
export interface ValueFact<T> extends Quoted { value: T }
export interface DiplomaFact extends Quoted { level: DiplomaLevel | null; text: string }
export interface TextFact extends Quoted { text: string }
export interface EligibilityProposal {
  min_age: ValueFact<number> | null; max_age: ValueFact<number> | null; genders: ValueFact<Gender[]> | null; nationality: ValueFact<string> | null;
  diplomas: DiplomaFact[]; specialties: TextFact[]; min_height_cm_male: ValueFact<number> | null; min_height_cm_female: ValueFact<number> | null;
  marital_status: ValueFact<'SINGLE' | 'MARRIED' | 'OTHER'> | null; other: TextFact[];
}
export interface PhaseProposal extends Quoted { order: number; kind: PhaseKind; name: string; is_eliminatory: boolean | null; duration_minutes: number | null }
export interface SubjectProposal extends Quoted { phase_order: number | null; domain: Domain | null; name: string; coefficient: number | null; duration_minutes: number | null }
export interface FactsProposal {
  status: 'DRAFT'; method: 'AI' | 'HEURISTIC'; family_slug: string | null; document_id: string | null;
  editions: EditionProposal[]; eligibility: EligibilityProposal; phases: PhaseProposal[]; subjects: SubjectProposal[];
  required_documents: TextFact[]; documents: TextFact[]; warnings: string[];
}

export interface GenerationOutput {
  topicKey: string; requested: number; inserted: number; aiReviewed: number; draft: number; discarded: number;
  questionIds: string[]; rejected: { questionId: string; reason: string; detail?: string }[]; batchErrors: string[];
}
export interface AlgorithmicResult { jobId: string; kind: string; topicKey: string; requested: number; inserted: number; skippedDuplicates: number; questionIds: string[] }

export interface WatchedSource { id: string; url: string; label: string; familySlug: string | null; active: boolean; lastCheckedAt: string | null; lastError: string | null; createdAt: string; newCandidates: number }
export interface CheckResult { id: string; url: string; outcome: 'FIRST_SNAPSHOT' | 'UNCHANGED' | 'CHANGED' | 'ERROR'; newCandidates: number; error?: string }
export interface CandidateExtraction { method?: string; editions?: EditionProposal[]; familyGuess?: { slug: string | null; score: number; matched: string[] }; draft?: { competitionId: string; familySlug: string; at: string; by: string } }
export interface Candidate {
  id: string; watchedSourceId: string | null; watchedSourceLabel: string | null; url: string | null; title: string; rawText: string | null;
  familySlugGuess: string | null; extracted: CandidateExtraction | null; status: 'NEW' | 'DRAFTED' | 'IGNORED' | string; detectedAt: string;
}
export interface DraftResult {
  candidate: Candidate;
  competition: { id: string; familySlug: string; year: number; status: string; contentStatus: string; needsVerification: boolean; registrationDeadline: string | null };
  import?: { document: { id: string; ocrStatus: string; pageCount: number | null; duplicate: boolean } | null; extractionJobId: string | null; error: string | null };
}

export interface BlueprintRow {
  id: string; title: string; totalMinutes: number; fidelity: 'OFFICIAL_FORMAT' | 'APPROXIMATED'; status: ContentStatus; sections: BlueprintSectionRow[];
  questionCount: number; familySlug: string; positionId: string; positionSlug: string; positionTitle_ar: string; positionTitle_fr: string;
}

export interface ReportRow {
  id: string; reason: string; comment: string | null; status: 'OPEN' | 'RESOLVED' | 'REJECTED' | string; createdAt: string;
  reporter: PersonRef | null;
  question: { id: string; stem: string; status: ContentStatus; type: QuestionType; domain: Domain; version: number; topicKey: string; openReports: number };
}
export type ReportsResponse = Paged<ReportRow> & { byReason: Record<string, number> };

export interface UserRow {
  id: string; name: string | null; email: string | null; phone: string | null; role: UserRole; isGuest: boolean; locale: string; emailVerified: boolean;
  createdAt: string; lastActiveAt: string | null;
  premium: { active: boolean; planCode: string | null; endsAt: string | null };
  stats: { xp: number; streak: number; answered: number };
}
export interface UserDetail extends UserRow {
  deletedAt: string | null; referralCode: string;
  profile: { diplomaLevel: DiplomaLevel | null; specialties: string[] | null; governorate: string | null; gender: Gender | null; hasBirthDate: boolean; alertsEnabled: boolean; alertFields: Field[] | null; alertChannels: string[] | null; dailyReminderHour: number | null } | null;
  enrollments: { familySlug: string; isPrimary: boolean; targetExamDate: string | null; createdAt: string }[];
  follows: string[];
  payments: { id: string; planCode: string; amountMillimes: number; provider: PaymentProvider; status: PaymentStatus; manualReference: string | null; createdAt: string; paidAt: string | null }[];
  activity: { attempts: number; submittedAttempts: number };
  alerts: { matches: number; lastMatchAt: string | null };
  notifications: { total: number; unread: number };
}

export interface PaymentRow {
  id: string; amountMillimes: number; currency: string; provider: PaymentProvider; providerRef: string | null; status: PaymentStatus;
  promoCode: string | null; manualReference: string | null; failureReason: string | null; createdAt: string; paidAt: string | null;
  plan: { code: string; name_ar: string; name_fr: string };
  user: { id: string; name: string | null; email: string | null; phone: string | null };
}
export type PaymentsResponse = Paged<PaymentRow> & { summary: { pendingManual: number; pendingManualWithProof: number } };

export interface WaitlistRow { id: string; email: string | null; phone: string | null; familySlug: string | null; willingness: string | null; utm: unknown; createdAt: string }
export type WaitlistResponse = Paged<WaitlistRow> & {
  counts: { total: number; last7d: number; last30d: number; withEmail: number; withPhone: number; byWillingness: Record<string, number>; byFamily: { familySlug: string | null; count: number }[] };
};

export interface AuditRow { id: string; action: string; entityType: string; entityId: string | null; diff: unknown; createdAt: string; actor: PersonRef | null }
export interface AuditResponse { items: AuditRow[]; nextBefore: string | null }

export interface ApiIssue { path?: (string | number)[] | string; message: string }

/**
 * Concours TN — PostgreSQL schema (Drizzle ORM).
 * Principle: every fact about a concours is traceable to a source (source_id, confidence, needs_verification, source_quote).
 * Money is stored in millimes (1 TND = 1000 millimes).
 */
import { sql } from 'drizzle-orm';
import {
  boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import {
  ATTEMPT_KINDS, CONFIDENCES, CONTENT_STATUSES, DIFFICULTIES, DIPLOMA_LEVELS, DOMAINS, EDITION_STATUSES, FIELDS,
  PAYMENT_PROVIDERS, PAYMENT_STATUSES, PHASE_KINDS, QUESTION_ORIGINS, QUESTION_TYPES, SOURCE_TYPES, SUBSCRIPTION_STATUSES,
  SYLLABUS_LEVELS, SYLLABUS_SCOPES, USER_ROLES,
} from '@ctn/shared';

// ───────────── Enums ─────────────
export const sourceTypeEnum = pgEnum('source_type', SOURCE_TYPES);
export const confidenceEnum = pgEnum('confidence', CONFIDENCES);
export const contentStatusEnum = pgEnum('content_status', CONTENT_STATUSES);
export const fieldEnum = pgEnum('field', FIELDS);
export const editionStatusEnum = pgEnum('edition_status', EDITION_STATUSES);
export const diplomaLevelEnum = pgEnum('diploma_level', DIPLOMA_LEVELS);
export const phaseKindEnum = pgEnum('phase_kind', PHASE_KINDS);
export const domainEnum = pgEnum('domain', DOMAINS);
export const questionTypeEnum = pgEnum('question_type', QUESTION_TYPES);
export const difficultyEnum = pgEnum('difficulty', DIFFICULTIES);
export const questionOriginEnum = pgEnum('question_origin', QUESTION_ORIGINS);
export const syllabusLevelEnum = pgEnum('syllabus_level', SYLLABUS_LEVELS);
export const syllabusScopeEnum = pgEnum('syllabus_scope', SYLLABUS_SCOPES);
export const attemptKindEnum = pgEnum('attempt_kind', ATTEMPT_KINDS);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const paymentProviderEnum = pgEnum('payment_provider', PAYMENT_PROVIDERS);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ───────────── Users & auth ─────────────
export const users = pgTable('users', {
  id: id(),
  email: text('email'),
  passwordHash: text('password_hash'),
  name: text('name'),
  phone: text('phone'),
  role: userRoleEnum('role').notNull().default('USER'),
  isGuest: boolean('is_guest').notNull().default(true),
  locale: text('locale').notNull().default('ar'),
  googleSub: text('google_sub'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  referralCode: text('referral_code').notNull(),
  referredBy: uuid('referred_by'),
  createdAt: createdAt(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** Bumped on password reset/change and account deletion: session JWTs carrying an older version are rejected. */
  tokenVersion: integer('token_version').notNull().default(0),
}, (t) => [
  uniqueIndex('users_email_uq').on(sql`lower(${t.email})`).where(sql`${t.email} is not null`),
  uniqueIndex('users_referral_code_uq').on(t.referralCode),
  uniqueIndex('users_google_sub_uq').on(t.googleSub).where(sql`${t.googleSub} is not null`),
]);

export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  birthDate: date('birth_date'),
  gender: text('gender'), // 'M' | 'F'
  diplomaLevel: diplomaLevelEnum('diploma_level'),
  specialties: text('specialties').array().notNull().default(sql`'{}'::text[]`),
  governorate: text('governorate'),
  heightCm: integer('height_cm'),
  maritalStatus: text('marital_status'),
  nationality: text('nationality').notNull().default('TN'),
  alertsEnabled: boolean('alerts_enabled').notNull().default(true),
  alertFields: text('alert_fields').array().notNull().default(sql`'{}'::text[]`), // empty = all fields
  alertChannels: text('alert_channels').array().notNull().default(sql`'{IN_APP,PUSH,EMAIL}'::text[]`),
  dailyReminderHour: integer('daily_reminder_hour'),
  /** Hidden from public leaderboards (still sees their own rank). */
  leaderboardOptOut: boolean('leaderboard_opt_out').notNull().default(false),
  updatedAt: updatedAt(),
});

export const authTokens = pgTable('auth_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // MAGIC_LINK | RESET | VERIFY
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash)]);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('push_endpoint_uq').on(t.endpoint)]);

// ───────────── Sources & documents ─────────────
export const sources = pgTable('sources', {
  id: id(),
  seedKey: text('seed_key'), // "<family-slug>:<key>" for seeded sources
  title: text('title').notNull(),
  url: text('url'),
  publisher: text('publisher'),
  sourceType: sourceTypeEnum('source_type').notNull(),
  publicationDate: date('publication_date'),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  confidence: confidenceEnum('confidence').notNull().default('MEDIUM'),
  notes: text('notes'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('sources_seed_key_uq').on(t.seedKey).where(sql`${t.seedKey} is not null`)]);

export const sourceDocuments = pgTable('source_documents', {
  id: id(),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  storageKey: text('storage_key').notNull(),
  filename: text('filename'),
  sha256: text('sha256').notNull(),
  mime: text('mime').notNull(),
  pageCount: integer('page_count'),
  language: text('language'),
  ocrStatus: text('ocr_status').notNull().default('PENDING'), // PENDING | TEXT_LAYER | OCR_DONE | FAILED
  extractedText: text('extracted_text'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('source_documents_sha_uq').on(t.sha256)]);

export const sourceChunks = pgTable('source_chunks', {
  id: id(),
  documentId: uuid('document_id').notNull().references(() => sourceDocuments.id, { onDelete: 'cascade' }),
  page: integer('page').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  text: text('text').notNull(),
}, (t) => [index('source_chunks_doc_idx').on(t.documentId)]);

export const watchedSources = pgTable('watched_sources', {
  id: id(),
  url: text('url').notNull(),
  label: text('label').notNull(),
  familySlug: text('family_slug'),
  active: boolean('active').notNull().default(true),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastSha256: text('last_sha256'),
  lastError: text('last_error'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('watched_sources_url_uq').on(t.url)]);

export const ingestCandidates = pgTable('ingest_candidates', {
  id: id(),
  watchedSourceId: uuid('watched_source_id').references(() => watchedSources.id, { onDelete: 'set null' }),
  url: text('url'),
  title: text('title').notNull(),
  rawText: text('raw_text'),
  sha256: text('sha256').notNull(),
  familySlugGuess: text('family_slug_guess'),
  extracted: jsonb('extracted'), // AI/heuristic extraction proposal (never published directly)
  status: text('status').notNull().default('NEW'), // NEW | DRAFTED | IGNORED
  detectedAt: createdAt(),
}, (t) => [uniqueIndex('ingest_candidates_sha_uq').on(t.sha256)]);

// ───────────── Catalog ─────────────
export const organizations = pgTable('organizations', {
  id: id(),
  slug: text('slug').notNull(),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr').notNull(),
  ministryFr: text('ministry_fr'),
  website: text('website'),
}, (t) => [uniqueIndex('organizations_slug_uq').on(t.slug)]);

export const competitionFamilies = pgTable('competition_families', {
  id: id(),
  slug: text('slug').notNull(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  field: fieldEnum('field').notNull(),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr').notNull(),
  descriptionAr: text('description_ar').notNull().default(''),
  descriptionFr: text('description_fr').notNull().default(''),
  frequency: text('frequency').notNull().default('UNKNOWN'),
  popularity: integer('popularity').notNull().default(3),
  keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
  tipsAr: text('tips_ar').array().notNull().default(sql`'{}'::text[]`),
  tipsFr: text('tips_fr').array().notNull().default(sql`'{}'::text[]`),
  researchNotes: text('research_notes'),
  status: contentStatusEnum('status').notNull().default('PUBLISHED'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('families_slug_uq').on(t.slug)]);

/** A concrete session ("édition") of a concours family. */
export const competitions = pgTable('competitions', {
  id: id(),
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  sessionLabel: text('session_label'),
  status: editionStatusEnum('status').notNull().default('EXPECTED'),
  registrationOpen: date('registration_open'),
  registrationDeadline: date('registration_deadline'),
  examDate: date('exam_date'),
  positionsCount: integer('positions_count'),
  candidatesCount: integer('candidates_count'),
  positionSlugs: text('position_slugs').array().notNull().default(sql`'{}'::text[]`), // empty = all positions of the family
  announcementUrl: text('announcement_url'),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  confidence: confidenceEnum('confidence').notNull().default('MEDIUM'),
  needsVerification: boolean('needs_verification').notNull().default(true),
  contentStatus: contentStatusEnum('content_status').notNull().default('PUBLISHED'),
  alertsSentAt: timestamp('alerts_sent_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('competitions_family_idx').on(t.familyId),
  index('competitions_status_idx').on(t.status),
  // One edition per family, year and session: keeps the seed and admin edits idempotent.
  uniqueIndex('competitions_family_year_session_uq').on(t.familyId, t.year, sql`coalesce(${t.sessionLabel}, '')`),
]);

export const positions = pgTable('positions', {
  id: id(),
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  titleAr: text('title_ar').notNull(),
  titleFr: text('title_fr').notNull(),
  diplomaLevel: diplomaLevelEnum('diploma_level').notNull().default('BAC'),
  eligibility: jsonb('eligibility').notNull().default({}), // EligibilityRules
  eligibilitySourceId: uuid('eligibility_source_id').references(() => sources.id, { onDelete: 'set null' }),
  eligibilityConfidence: confidenceEnum('eligibility_confidence').notNull().default('LOW'),
  eligibilityNeedsVerification: boolean('eligibility_needs_verification').notNull().default(true),
  eligibilityQuote: text('eligibility_quote'),
  orderIndex: integer('order_index').notNull().default(0),
  status: contentStatusEnum('status').notNull().default('PUBLISHED'),
}, (t) => [uniqueIndex('positions_family_slug_uq').on(t.familyId, t.slug)]);

export const phases = pgTable('phases', {
  id: id(),
  positionId: uuid('position_id').notNull().references(() => positions.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull(),
  kind: phaseKindEnum('kind').notNull(),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr').notNull(),
  isEliminatory: boolean('is_eliminatory').notNull().default(true),
  durationMinutes: integer('duration_minutes'),
  descriptionAr: text('description_ar'),
  descriptionFr: text('description_fr'),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  confidence: confidenceEnum('confidence').notNull().default('LOW'),
  needsVerification: boolean('needs_verification').notNull().default(true),
  sourceQuote: text('source_quote'),
});

export const examSubjects = pgTable('exam_subjects', {
  id: id(),
  positionId: uuid('position_id').notNull().references(() => positions.id, { onDelete: 'cascade' }),
  phaseOrder: integer('phase_order').notNull().default(1),
  domain: domainEnum('domain').notNull(),
  specialtyKey: text('specialty_key'),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr').notNull(),
  coefficient: real('coefficient'),
  durationMinutes: integer('duration_minutes'),
  questionCount: integer('question_count'),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  confidence: confidenceEnum('confidence').notNull().default('LOW'),
  needsVerification: boolean('needs_verification').notNull().default(true),
  sourceQuote: text('source_quote'),
});

/** Generic sourced facts: PHYSICAL_TEST, REQUIRED_DOCUMENT, ELIGIBILITY_NOTE, SCORING, FEE, OTHER. */
export const competitionFacts = pgTable('competition_facts', {
  id: id(),
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
  positionId: uuid('position_id').references(() => positions.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  displayAr: text('display_ar').notNull(),
  displayFr: text('display_fr').notNull(),
  detailsAr: text('details_ar'),
  detailsFr: text('details_fr'),
  value: jsonb('value'),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  sourcePage: integer('source_page'),
  sourceQuote: text('source_quote'),
  confidence: confidenceEnum('confidence').notNull().default('LOW'),
  needsVerification: boolean('needs_verification').notNull().default(true),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  status: contentStatusEnum('status').notNull().default('PUBLISHED'),
  orderIndex: integer('order_index').notNull().default(0),
}, (t) => [index('facts_family_idx').on(t.familyId), index('facts_position_idx').on(t.positionId)]);

export const blueprints = pgTable('blueprints', {
  id: id(),
  positionId: uuid('position_id').notNull().references(() => positions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  totalMinutes: integer('total_minutes').notNull(),
  fidelity: text('fidelity').notNull().default('APPROXIMATED'), // OFFICIAL_FORMAT | APPROXIMATED
  sections: jsonb('sections').notNull(), // [{domain, specialtyKey, count, minutes}]
  status: contentStatusEnum('status').notNull().default('PUBLISHED'),
});

export const pastExams = pgTable('past_exams', {
  id: id(),
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  title: text('title').notNull(),
  url: text('url'),
  sourceType: sourceTypeEnum('source_type').notNull().default('COMMUNITY'),
  isVerified: boolean('is_verified').notNull().default(false),
  documentId: uuid('document_id').references(() => sourceDocuments.id, { onDelete: 'set null' }),
});

// ───────────── Curriculum ─────────────
export const syllabusNodes = pgTable('syllabus_nodes', {
  id: id(),
  key: text('key').notNull(),
  parentId: uuid('parent_id'),
  familyId: uuid('family_id').references(() => competitionFamilies.id, { onDelete: 'cascade' }), // null = shared node
  level: syllabusLevelEnum('level').notNull(),
  domain: domainEnum('domain').notNull(),
  titleAr: text('title_ar').notNull(),
  titleFr: text('title_fr').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  scope: syllabusScopeEnum('scope').notNull(),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  status: contentStatusEnum('status').notNull().default('PUBLISHED'),
}, (t) => [uniqueIndex('syllabus_key_uq').on(t.key), index('syllabus_parent_idx').on(t.parentId)]);

export const learningObjectives = pgTable('learning_objectives', {
  id: id(),
  key: text('key').notNull(),
  nodeId: uuid('node_id').notNull().references(() => syllabusNodes.id, { onDelete: 'cascade' }),
  textAr: text('text_ar').notNull(),
  textFr: text('text_fr').notNull(),
  sourceChunkId: uuid('source_chunk_id').references(() => sourceChunks.id, { onDelete: 'set null' }),
  status: contentStatusEnum('status').notNull().default('PUBLISHED'),
}, (t) => [uniqueIndex('objectives_key_uq').on(t.key)]);

/** Family ↔ syllabus subject/topic linkage (which shared/specialty nodes a family uses, with exam weight). */
export const familySyllabus = pgTable('family_syllabus', {
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').notNull().references(() => syllabusNodes.id, { onDelete: 'cascade' }),
  weight: real('weight').notNull().default(1),
}, (t) => [primaryKey({ columns: [t.familyId, t.nodeId] })]);

export const lessons = pgTable('lessons', {
  id: id(),
  nodeId: uuid('node_id').notNull().references(() => syllabusNodes.id, { onDelete: 'cascade' }),
  language: text('language').notNull().default('ar'),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
  estMinutes: integer('est_minutes').notNull().default(10),
  origin: questionOriginEnum('origin').notNull().default('AUTHORED'),
  status: contentStatusEnum('status').notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  updatedAt: updatedAt(),
}, (t) => [index('lessons_node_idx').on(t.nodeId)]);

/** Lessons a user marked as read (XP once per lesson; ticks LESSON items of the daily plan). */
export const lessonCompletions = pgTable('lesson_completions', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.lessonId] })]);

// ───────────── Question bank ─────────────
export const questions = pgTable('questions', {
  id: id(),
  extId: text('ext_id'),
  type: questionTypeEnum('type').notNull(),
  domain: domainEnum('domain').notNull(),
  language: text('language').notNull(),
  stem: text('stem').notNull(),
  options: jsonb('options').notNull().default([]),
  correct: jsonb('correct').notNull(),
  explanation: text('explanation').notNull(),
  difficulty: difficultyEnum('difficulty').notNull(),
  rating: real('rating').notNull().default(1000), // calibrated Elo difficulty
  topicId: uuid('topic_id').notNull().references(() => syllabusNodes.id),
  isGeneral: boolean('is_general').notNull().default(true), // usable by every family that uses its domain/topic
  origin: questionOriginEnum('origin').notNull(),
  pastExamId: uuid('past_exam_id').references(() => pastExams.id, { onDelete: 'set null' }),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  year: integer('year'),
  validUntil: date('valid_until'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  status: contentStatusEnum('status').notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by').references(() => users.id),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  aiModel: text('ai_model'),
  aiPromptVersion: text('ai_prompt_version'),
  attemptsCount: integer('attempts_count').notNull().default(0),
  correctCount: integer('correct_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('questions_ext_id_uq').on(t.extId).where(sql`${t.extId} is not null`),
  index('questions_topic_idx').on(t.topicId),
  index('questions_status_domain_idx').on(t.status, t.domain),
]);

export const questionObjectives = pgTable('question_objectives', {
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  objectiveId: uuid('objective_id').notNull().references(() => learningObjectives.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.questionId, t.objectiveId] })]);

export const questionFamilies = pgTable('question_families', {
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.questionId, t.familyId] })]);

export const questionReports = pgTable('question_reports', {
  id: id(),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  comment: text('comment'),
  status: text('status').notNull().default('OPEN'), // OPEN | RESOLVED | REJECTED
  createdAt: createdAt(),
});

// ───────────── Learning activity ─────────────
export const enrollments = pgTable('enrollments', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
  positionId: uuid('position_id').references(() => positions.id, { onDelete: 'set null' }),
  targetExamDate: date('target_exam_date'),
  dailyMinutes: integer('daily_minutes').notNull().default(30),
  isPrimary: boolean('is_primary').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('enrollments_user_family_uq').on(t.userId, t.familyId)]);

export const follows = pgTable('follows', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.familyId] })]);

export const attempts = pgTable('attempts', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: attemptKindEnum('kind').notNull(),
  familyId: uuid('family_id').references(() => competitionFamilies.id, { onDelete: 'set null' }),
  positionId: uuid('position_id').references(() => positions.id, { onDelete: 'set null' }),
  blueprintId: uuid('blueprint_id').references(() => blueprints.id, { onDelete: 'set null' }),
  questionIds: uuid('question_ids').array().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  durationS: integer('duration_s'),
  correctCount: integer('correct_count'),
  score: real('score'), // 0..1
  result: jsonb('result'),
}, (t) => [index('attempts_user_idx').on(t.userId, t.kind)]);

export const attemptAnswers = pgTable('attempt_answers', {
  id: id(),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  answer: jsonb('answer'),
  isCorrect: boolean('is_correct').notNull(),
  timeMs: integer('time_ms'),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('attempt_answers_uq').on(t.attemptId, t.questionId), index('attempt_answers_question_idx').on(t.questionId)]);

export const mastery = pgTable('mastery', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').notNull().references(() => syllabusNodes.id, { onDelete: 'cascade' }),
  rating: real('rating').notNull().default(950),
  attempts: integer('attempts').notNull().default(0),
  correct: integer('correct').notNull().default(0),
  streakCorrect: integer('streak_correct').notNull().default(0),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.userId, t.nodeId] })]);

/** Per-user per-question state: mistakes notebook, bookmarks, spaced repetition of errors. */
export const userQuestionState = pgTable('user_question_state', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  timesSeen: integer('times_seen').notNull().default(0),
  timesWrong: integer('times_wrong').notNull().default(0),
  lastCorrect: boolean('last_correct'),
  lastAnsweredAt: timestamp('last_answered_at', { withTimezone: true }),
  nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
  bookmarked: boolean('bookmarked').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.userId, t.questionId] })]);

export const studyPlanDays = pgTable('study_plan_days', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  enrollmentId: uuid('enrollment_id').references(() => enrollments.id, { onDelete: 'set null' }),
  items: jsonb('items').notNull(),
  completed: jsonb('completed').notNull().default([]),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.date] })]);

export const weaknessEvents = pgTable('weakness_events', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').notNull().references(() => syllabusNodes.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').references(() => questions.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const readinessSnapshots = pgTable('readiness_snapshots', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familyId: uuid('family_id').notNull().references(() => competitionFamilies.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  preparation: integer('preparation').notNull(),
  overall: integer('overall').notNull(),
  coverage: integer('coverage').notNull(),
  label: text('label').notNull(),
}, (t) => [uniqueIndex('readiness_user_family_date_uq').on(t.userId, t.familyId, t.date)]);

export const tutorCache = pgTable('tutor_cache', {
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  answerKey: text('answer_key').notNull(),
  locale: text('locale').notNull(),
  response: jsonb('response').notNull(),
  model: text('model'),
  hits: integer('hits').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.questionId, t.answerKey, t.locale] })]);

export const usageCounters = pgTable('usage_counters', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  questions: integer('questions').notNull().default(0),
  tutor: integer('tutor').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.date] })]);

// ───────────── Gamification ─────────────
export const userStats = pgTable('user_stats', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  xpTotal: integer('xp_total').notNull().default(0),
  streakCurrent: integer('streak_current').notNull().default(0),
  streakLongest: integer('streak_longest').notNull().default(0),
  streakFreezes: integer('streak_freezes').notNull().default(1),
  lastActiveDate: date('last_active_date'),
  questionsAnswered: integer('questions_answered').notNull().default(0),
  mistakesFixed: integer('mistakes_fixed').notNull().default(0),
});

export const xpEvents = pgTable('xp_events', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familyId: uuid('family_id').references(() => competitionFamilies.id, { onDelete: 'set null' }),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
}, (t) => [index('xp_events_user_time_idx').on(t.userId, t.createdAt), index('xp_events_time_idx').on(t.createdAt)]);

export const userBadges = pgTable('user_badges', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  awardedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.code] })]);

// ───────────── Candidate tools ─────────────
export const userDocumentChecks = pgTable('user_document_checks', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  factId: uuid('fact_id').notNull().references(() => competitionFacts.id, { onDelete: 'cascade' }),
  checkedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.factId] })]);

export const physicalLogs = pgTable('physical_logs', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  testCode: text('test_code').notNull(), // RUN_100M | RUN_1000M | PUSHUPS | ...
  value: real('value').notNull(),
  unit: text('unit').notNull(),
  notes: text('notes'),
  loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
});

// ───────────── Notifications & alerts ─────────────
export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  url: text('url'),
  data: jsonb('data').notNull().default({}),
  dedupeKey: text('dedupe_key'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt), uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`)]);

export const notificationDeliveries = pgTable('notification_deliveries', {
  id: id(),
  notificationId: uuid('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(), // IN_APP | PUSH | EMAIL
  status: text('status').notNull(), // SENT | FAILED | SKIPPED
  error: text('error'),
  sentAt: createdAt(),
});

export const alertMatches = pgTable('alert_matches', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  positionId: uuid('position_id').references(() => positions.id, { onDelete: 'cascade' }),
  eligibility: jsonb('eligibility').notNull(), // EligibilityResult
  notificationId: uuid('notification_id').references(() => notifications.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('alert_matches_uq').on(t.userId, t.competitionId, t.positionId)]);

export const emailOutbox = pgTable('email_outbox', {
  id: id(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  text: text('text'),
  status: text('status').notNull().default('PENDING'), // PENDING | SENT | FAILED | LOGGED
  error: text('error'),
  createdAt: createdAt(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});

// ───────────── Billing ─────────────
export const plans = pgTable('plans', {
  id: id(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameFr: text('name_fr').notNull(),
  priceMillimes: integer('price_millimes').notNull(),
  period: text('period').notNull(),
  durationDays: integer('duration_days').notNull(),
  features: jsonb('features').notNull(),
  isActive: boolean('is_active').notNull().default(true),
}, (t) => [uniqueIndex('plans_code_uq').on(t.code)]);

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  status: subscriptionStatusEnum('status').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  source: text('source').notNull().default('PAYMENT'), // PAYMENT | REFERRAL | ADMIN_GRANT | PROMO
  paymentId: uuid('payment_id'),
  createdAt: createdAt(),
}, (t) => [
  index('subscriptions_user_idx').on(t.userId, t.endsAt),
  // A payment activates at most one subscription (billing also enforces this in code).
  uniqueIndex('subscriptions_payment_uq').on(t.paymentId).where(sql`${t.paymentId} is not null`),
]);

export const payments = pgTable('payments', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  amountMillimes: integer('amount_millimes').notNull(),
  currency: text('currency').notNull().default('TND'),
  provider: paymentProviderEnum('provider').notNull(),
  providerRef: text('provider_ref'),
  status: paymentStatusEnum('status').notNull().default('PENDING'),
  promoCode: text('promo_code'),
  manualReference: text('manual_reference'),
  raw: jsonb('raw'),
  createdAt: createdAt(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
}, (t) => [uniqueIndex('payments_provider_ref_uq').on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`)]);

export const promoCodes = pgTable('promo_codes', {
  code: text('code').primaryKey(),
  percentOff: integer('percent_off').notNull(),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
});

export const referrals = pgTable('referrals', {
  id: id(),
  referrerId: uuid('referrer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  referredId: uuid('referred_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rewardedAt: timestamp('rewarded_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('referrals_referred_uq').on(t.referredId)]);

// ───────────── Growth, admin & audit ─────────────
export const waitlist = pgTable('waitlist', {
  id: id(),
  email: text('email'),
  phone: text('phone'),
  familySlug: text('family_slug'),
  willingness: text('willingness'),
  utm: jsonb('utm'),
  createdAt: createdAt(),
  /** When the "your concours is now on Concours TN" email was sent (once per entry). */
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
});

export const analyticsEvents = pgTable('analytics_events', {
  id: id(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  props: jsonb('props').notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index('analytics_name_time_idx').on(t.name, t.createdAt)]);

export const contentReviews = pgTable('content_reviews', {
  id: id(),
  entityType: text('entity_type').notNull(), // question | fact | lesson | syllabus | edition | position
  entityId: uuid('entity_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  comment: text('comment'),
  createdAt: createdAt(),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  diff: jsonb('diff'),
  createdAt: createdAt(),
});

export const aiJobs = pgTable('ai_jobs', {
  id: id(),
  kind: text('kind').notNull(), // GENERATE_QUESTIONS | EXTRACT_FACTS | VALIDATE_QUESTION | LESSON
  status: text('status').notNull().default('QUEUED'), // QUEUED | RUNNING | DONE | FAILED
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  model: text('model'),
  promptVersion: text('prompt_version'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});


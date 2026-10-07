CREATE TYPE "public"."attempt_kind" AS ENUM('DIAGNOSTIC', 'PRACTICE', 'DAILY', 'MOCK', 'REVIEW');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('DRAFT', 'AI_REVIEWED', 'HUMAN_REVIEWED', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('EASY', 'MEDIUM', 'HARD', 'EXPERT');--> statement-breakpoint
CREATE TYPE "public"."diploma_level" AS ENUM('NONE', 'PRIMARY', 'NINTH', 'SECONDARY', 'BAC', 'BAC_PLUS_2', 'LICENCE', 'MASTER', 'ENGINEER', 'DOCTORATE', 'MEDICINE');--> statement-breakpoint
CREATE TYPE "public"."domain" AS ENUM('CULTURE_GENERALE', 'ARABIC', 'FRENCH', 'ENGLISH', 'LOGIC', 'NUMERICAL', 'PSYCHOTECH', 'SPECIALTY');--> statement-breakpoint
CREATE TYPE "public"."edition_status" AS ENUM('EXPECTED', 'ANNOUNCED', 'OPEN', 'CLOSED', 'EXAM_DONE', 'RESULTS');--> statement-breakpoint
CREATE TYPE "public"."field" AS ENUM('SECURITY', 'CUSTOMS', 'EDUCATION', 'HEALTH', 'FINANCE', 'PUBLIC_COMPANY', 'ADMINISTRATION', 'DEFENSE', 'TECHNICAL');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('KONNECT', 'FLOUCI', 'MANUAL', 'MOCK');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."phase_kind" AS ENUM('WRITTEN', 'PHYSICAL', 'ORAL', 'PSYCHOTECH', 'MEDICAL', 'FILE_REVIEW', 'INTERVIEW', 'TRAINING');--> statement-breakpoint
CREATE TYPE "public"."question_origin" AS ENUM('PAST_EXAM_VERBATIM', 'PAST_EXAM_REWRITTEN', 'AUTHORED', 'AI_GENERATED', 'ALGORITHMIC');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'MATCHING', 'ORDERING', 'NUMERIC');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('OFFICIAL', 'SECONDARY', 'COMMUNITY', 'SUGGESTED');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."syllabus_level" AS ENUM('SUBJECT', 'UNIT', 'TOPIC');--> statement-breakpoint
CREATE TYPE "public"."syllabus_scope" AS ENUM('OFFICIAL_PROGRAM', 'INFERRED_FROM_PAST_EXAMS', 'GENERAL_SKILL', 'SUGGESTED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'EDITOR', 'ADMIN');--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"model" text,
	"prompt_version" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alert_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"position_id" uuid,
	"eligibility" jsonb NOT NULL,
	"notification_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempt_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" jsonb,
	"is_correct" boolean NOT NULL,
	"time_ms" integer,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "attempt_kind" NOT NULL,
	"family_id" uuid,
	"position_id" uuid,
	"blueprint_id" uuid,
	"question_ids" uuid[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"duration_s" integer,
	"correct_count" integer,
	"score" real,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"title" text NOT NULL,
	"total_minutes" integer NOT NULL,
	"fidelity" text DEFAULT 'APPROXIMATED' NOT NULL,
	"sections" jsonb NOT NULL,
	"status" "content_status" DEFAULT 'PUBLISHED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"position_id" uuid,
	"key" text NOT NULL,
	"display_ar" text NOT NULL,
	"display_fr" text NOT NULL,
	"details_ar" text,
	"details_fr" text,
	"value" jsonb,
	"source_id" uuid,
	"source_page" integer,
	"source_quote" text,
	"confidence" "confidence" DEFAULT 'LOW' NOT NULL,
	"needs_verification" boolean DEFAULT true NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" "content_status" DEFAULT 'PUBLISHED' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"field" "field" NOT NULL,
	"name_ar" text NOT NULL,
	"name_fr" text NOT NULL,
	"description_ar" text DEFAULT '' NOT NULL,
	"description_fr" text DEFAULT '' NOT NULL,
	"frequency" text DEFAULT 'UNKNOWN' NOT NULL,
	"popularity" integer DEFAULT 3 NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"tips_ar" text[] DEFAULT '{}'::text[] NOT NULL,
	"tips_fr" text[] DEFAULT '{}'::text[] NOT NULL,
	"research_notes" text,
	"status" "content_status" DEFAULT 'PUBLISHED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"session_label" text,
	"status" "edition_status" DEFAULT 'EXPECTED' NOT NULL,
	"registration_open" date,
	"registration_deadline" date,
	"exam_date" date,
	"positions_count" integer,
	"candidates_count" integer,
	"position_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"announcement_url" text,
	"source_id" uuid,
	"confidence" "confidence" DEFAULT 'MEDIUM' NOT NULL,
	"needs_verification" boolean DEFAULT true NOT NULL,
	"content_status" "content_status" DEFAULT 'PUBLISHED' NOT NULL,
	"alerts_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reviewer_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"position_id" uuid,
	"target_exam_date" date,
	"daily_minutes" integer DEFAULT 30 NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"phase_order" integer DEFAULT 1 NOT NULL,
	"domain" "domain" NOT NULL,
	"specialty_key" text,
	"name_ar" text NOT NULL,
	"name_fr" text NOT NULL,
	"coefficient" real,
	"duration_minutes" integer,
	"question_count" integer,
	"source_id" uuid,
	"confidence" "confidence" DEFAULT 'LOW' NOT NULL,
	"needs_verification" boolean DEFAULT true NOT NULL,
	"source_quote" text
);
--> statement-breakpoint
CREATE TABLE "family_syllabus" (
	"family_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	CONSTRAINT "family_syllabus_family_id_node_id_pk" PRIMARY KEY("family_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_user_id_family_id_pk" PRIMARY KEY("user_id","family_id")
);
--> statement-breakpoint
CREATE TABLE "ingest_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watched_source_id" uuid,
	"url" text,
	"title" text NOT NULL,
	"raw_text" text,
	"sha256" text NOT NULL,
	"family_slug_guess" text,
	"extracted" jsonb,
	"status" text DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"node_id" uuid NOT NULL,
	"text_ar" text NOT NULL,
	"text_fr" text NOT NULL,
	"source_chunk_id" uuid,
	"status" "content_status" DEFAULT 'PUBLISHED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"language" text DEFAULT 'ar' NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"est_minutes" integer DEFAULT 10 NOT NULL,
	"origin" "question_origin" DEFAULT 'AUTHORED' NOT NULL,
	"status" "content_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery" (
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"rating" real DEFAULT 950 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"streak_correct" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	CONSTRAINT "mastery_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_fr" text NOT NULL,
	"ministry_fr" text,
	"website" text
);
--> statement-breakpoint
CREATE TABLE "past_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"source_type" "source_type" DEFAULT 'COMMUNITY' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"document_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"amount_millimes" integer NOT NULL,
	"currency" text DEFAULT 'TND' NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_ref" text,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"promo_code" text,
	"manual_reference" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"kind" "phase_kind" NOT NULL,
	"name_ar" text NOT NULL,
	"name_fr" text NOT NULL,
	"is_eliminatory" boolean DEFAULT true NOT NULL,
	"duration_minutes" integer,
	"description_ar" text,
	"description_fr" text,
	"source_id" uuid,
	"confidence" "confidence" DEFAULT 'LOW' NOT NULL,
	"needs_verification" boolean DEFAULT true NOT NULL,
	"source_quote" text
);
--> statement-breakpoint
CREATE TABLE "physical_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"test_code" text NOT NULL,
	"value" real NOT NULL,
	"unit" text NOT NULL,
	"notes" text,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_fr" text NOT NULL,
	"price_millimes" integer NOT NULL,
	"period" text NOT NULL,
	"duration_days" integer NOT NULL,
	"features" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_fr" text NOT NULL,
	"diploma_level" "diploma_level" DEFAULT 'BAC' NOT NULL,
	"eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eligibility_source_id" uuid,
	"eligibility_confidence" "confidence" DEFAULT 'LOW' NOT NULL,
	"eligibility_needs_verification" boolean DEFAULT true NOT NULL,
	"eligibility_quote" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"status" "content_status" DEFAULT 'PUBLISHED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"percent_off" integer NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_families" (
	"question_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	CONSTRAINT "question_families_question_id_family_id_pk" PRIMARY KEY("question_id","family_id")
);
--> statement-breakpoint
CREATE TABLE "question_objectives" (
	"question_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	CONSTRAINT "question_objectives_question_id_objective_id_pk" PRIMARY KEY("question_id","objective_id")
);
--> statement-breakpoint
CREATE TABLE "question_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid,
	"reason" text NOT NULL,
	"comment" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ext_id" text,
	"type" "question_type" NOT NULL,
	"domain" "domain" NOT NULL,
	"language" text NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"rating" real DEFAULT 1000 NOT NULL,
	"topic_id" uuid NOT NULL,
	"is_general" boolean DEFAULT true NOT NULL,
	"origin" "question_origin" NOT NULL,
	"past_exam_id" uuid,
	"source_id" uuid,
	"year" integer,
	"valid_until" date,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "content_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"ai_model" text,
	"ai_prompt_version" text,
	"attempts_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"date" date NOT NULL,
	"preparation" integer NOT NULL,
	"overall" integer NOT NULL,
	"coverage" integer NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referred_id" uuid NOT NULL,
	"rewarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"storage_key" text NOT NULL,
	"filename" text,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"page_count" integer,
	"language" text,
	"ocr_status" text DEFAULT 'PENDING' NOT NULL,
	"extracted_text" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_key" text,
	"title" text NOT NULL,
	"url" text,
	"publisher" text,
	"source_type" "source_type" NOT NULL,
	"publication_date" date,
	"retrieved_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"confidence" "confidence" DEFAULT 'MEDIUM' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plan_days" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"enrollment_id" uuid,
	"items" jsonb NOT NULL,
	"completed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_plan_days_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'PAYMENT' NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "syllabus_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"parent_id" uuid,
	"family_id" uuid,
	"level" "syllabus_level" NOT NULL,
	"domain" "domain" NOT NULL,
	"title_ar" text NOT NULL,
	"title_fr" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"scope" "syllabus_scope" NOT NULL,
	"source_id" uuid,
	"status" "content_status" DEFAULT 'PUBLISHED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_cache" (
	"question_id" uuid NOT NULL,
	"answer_key" text NOT NULL,
	"locale" text NOT NULL,
	"response" jsonb NOT NULL,
	"model" text,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_cache_question_id_answer_key_locale_pk" PRIMARY KEY("question_id","answer_key","locale")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"questions" integer DEFAULT 0 NOT NULL,
	"tutor" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_id_code_pk" PRIMARY KEY("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "user_document_checks" (
	"user_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_document_checks_user_id_fact_id_pk" PRIMARY KEY("user_id","fact_id")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"birth_date" date,
	"gender" text,
	"diploma_level" "diploma_level",
	"specialties" text[] DEFAULT '{}'::text[] NOT NULL,
	"governorate" text,
	"height_cm" integer,
	"marital_status" text,
	"nationality" text DEFAULT 'TN' NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"alert_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"alert_channels" text[] DEFAULT '{IN_APP,PUSH,EMAIL}'::text[] NOT NULL,
	"daily_reminder_hour" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_question_state" (
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"times_seen" integer DEFAULT 0 NOT NULL,
	"times_wrong" integer DEFAULT 0 NOT NULL,
	"last_correct" boolean,
	"last_answered_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"bookmarked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_question_state_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"xp_total" integer DEFAULT 0 NOT NULL,
	"streak_current" integer DEFAULT 0 NOT NULL,
	"streak_longest" integer DEFAULT 0 NOT NULL,
	"streak_freezes" integer DEFAULT 1 NOT NULL,
	"last_active_date" date,
	"questions_answered" integer DEFAULT 0 NOT NULL,
	"mistakes_fixed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"password_hash" text,
	"name" text,
	"phone" text,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"is_guest" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"google_sub" text,
	"email_verified_at" timestamp with time zone,
	"referral_code" text NOT NULL,
	"referred_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"phone" text,
	"family_slug" text,
	"willingness" text,
	"utm" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"label" text NOT NULL,
	"family_slug" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_sha256" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weakness_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"question_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_matches" ADD CONSTRAINT "alert_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_matches" ADD CONSTRAINT "alert_matches_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_matches" ADD CONSTRAINT "alert_matches_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_matches" ADD CONSTRAINT "alert_matches_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_facts" ADD CONSTRAINT "competition_facts_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_facts" ADD CONSTRAINT "competition_facts_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_facts" ADD CONSTRAINT "competition_facts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_families" ADD CONSTRAINT "competition_families_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_syllabus" ADD CONSTRAINT "family_syllabus_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_syllabus" ADD CONSTRAINT "family_syllabus_node_id_syllabus_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."syllabus_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_candidates" ADD CONSTRAINT "ingest_candidates_watched_source_id_watched_sources_id_fk" FOREIGN KEY ("watched_source_id") REFERENCES "public"."watched_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_node_id_syllabus_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."syllabus_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_source_chunk_id_source_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."source_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_node_id_syllabus_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."syllabus_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery" ADD CONSTRAINT "mastery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery" ADD CONSTRAINT "mastery_node_id_syllabus_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."syllabus_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "past_exams" ADD CONSTRAINT "past_exams_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "past_exams" ADD CONSTRAINT "past_exams_document_id_source_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_logs" ADD CONSTRAINT "physical_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_eligibility_source_id_sources_id_fk" FOREIGN KEY ("eligibility_source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_families" ADD CONSTRAINT "question_families_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_families" ADD CONSTRAINT "question_families_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_objectives" ADD CONSTRAINT "question_objectives_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_objectives" ADD CONSTRAINT "question_objectives_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_reports" ADD CONSTRAINT "question_reports_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_reports" ADD CONSTRAINT "question_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_syllabus_nodes_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."syllabus_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_past_exam_id_past_exams_id_fk" FOREIGN KEY ("past_exam_id") REFERENCES "public"."past_exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_snapshots" ADD CONSTRAINT "readiness_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_snapshots" ADD CONSTRAINT "readiness_snapshots_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_users_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_document_id_source_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plan_days" ADD CONSTRAINT "study_plan_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plan_days" ADD CONSTRAINT "study_plan_days_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_nodes" ADD CONSTRAINT "syllabus_nodes_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_nodes" ADD CONSTRAINT "syllabus_nodes_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_cache" ADD CONSTRAINT "tutor_cache_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_document_checks" ADD CONSTRAINT "user_document_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_document_checks" ADD CONSTRAINT "user_document_checks_fact_id_competition_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."competition_facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_question_state" ADD CONSTRAINT "user_question_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_question_state" ADD CONSTRAINT "user_question_state_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weakness_events" ADD CONSTRAINT "weakness_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weakness_events" ADD CONSTRAINT "weakness_events_node_id_syllabus_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."syllabus_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weakness_events" ADD CONSTRAINT "weakness_events_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_family_id_competition_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."competition_families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_matches_uq" ON "alert_matches" USING btree ("user_id","competition_id","position_id");--> statement-breakpoint
CREATE INDEX "analytics_name_time_idx" ON "analytics_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_answers_uq" ON "attempt_answers" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE INDEX "attempt_answers_question_idx" ON "attempt_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "attempts_user_idx" ON "attempts" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "facts_family_idx" ON "competition_facts" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "facts_position_idx" ON "competition_facts" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "families_slug_uq" ON "competition_families" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "competitions_family_idx" ON "competitions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "competitions_status_idx" ON "competitions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_user_family_uq" ON "enrollments" USING btree ("user_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_candidates_sha_uq" ON "ingest_candidates" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "objectives_key_uq" ON "learning_objectives" USING btree ("key");--> statement-breakpoint
CREATE INDEX "lessons_node_idx" ON "lessons" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_uq" ON "payments" USING btree ("provider","provider_ref") WHERE "payments"."provider_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_uq" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_family_slug_uq" ON "positions" USING btree ("family_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_ext_id_uq" ON "questions" USING btree ("ext_id") WHERE "questions"."ext_id" is not null;--> statement-breakpoint
CREATE INDEX "questions_topic_idx" ON "questions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "questions_status_domain_idx" ON "questions" USING btree ("status","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_user_family_date_uq" ON "readiness_snapshots" USING btree ("user_id","family_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_uq" ON "referrals" USING btree ("referred_id");--> statement-breakpoint
CREATE INDEX "source_chunks_doc_idx" ON "source_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_sha_uq" ON "source_documents" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_seed_key_uq" ON "sources" USING btree ("seed_key") WHERE "sources"."seed_key" is not null;--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "syllabus_key_uq" ON "syllabus_nodes" USING btree ("key");--> statement-breakpoint
CREATE INDEX "syllabus_parent_idx" ON "syllabus_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email")) WHERE "users"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uq" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_sub") WHERE "users"."google_sub" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "watched_sources_url_uq" ON "watched_sources" USING btree ("url");--> statement-breakpoint
CREATE INDEX "xp_events_user_time_idx" ON "xp_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "xp_events_time_idx" ON "xp_events" USING btree ("created_at");
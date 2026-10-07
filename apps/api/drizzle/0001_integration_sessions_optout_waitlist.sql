CREATE TABLE "lesson_completions" (
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_completions_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "leaderboard_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_completions" ADD CONSTRAINT "lesson_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_completions" ADD CONSTRAINT "lesson_completions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_family_year_session_uq" ON "competitions" USING btree ("family_id","year",coalesce("session_label", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_payment_uq" ON "subscriptions" USING btree ("payment_id") WHERE "subscriptions"."payment_id" is not null;
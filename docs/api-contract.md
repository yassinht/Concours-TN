# API contract (NestJS ↔ Next.js)

- Base URL from the browser: **`/api`** (Next rewrites `/api/:path*` → `http://localhost:4000/:path*`). Server components call the API directly via `serverApi()` (`apps/web/lib/api-server.ts`) and forward cookies.
- Auth: httpOnly cookie `ctn_session` (JWT). Every visitor can get a **guest session** (`POST /auth/guest`) so the diagnostic works without signup; `POST /auth/register` converts the guest account (keeps its attempts).
- Bodies are validated with the zod schemas in `packages/shared/src/contracts.ts`; response types are the `*DTO` interfaces there.
- Errors: `{ statusCode, message }` where `message` is a stable code (`SESSION_REQUIRED`, `REGISTRATION_REQUIRED`, `FORBIDDEN`, `VALIDATION_FAILED`, `NOT_FOUND`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `LIMIT_REACHED`, `PREMIUM_REQUIRED`, `ATTEMPT_CLOSED`…).
- Guards (`apps/api/src/common/auth.guards.ts`): `UserGuard` (guest or registered), `RegisteredGuard`, `RolesGuard` + `@Roles('ADMIN','EDITOR')`; `@CurrentUser()` gives `{ id, role, isGuest }`.
- Bilingual fields use `_ar` / `_fr` suffixes in DTOs.

## auth — `apps/api/src/modules/auth`
| Method | Path | Guard | Body | Response |
|---|---|---|---|---|
| POST | /auth/guest | – | `{ locale? }` | `{ user: MeDTO }` (reuses the current session if any) |
| POST | /auth/register | – | `RegisterInput` | `{ user: MeDTO }` (converts guest; applies referral code; triggers `AlertsService.matchUser`) |
| POST | /auth/login | – | `LoginInput` | `{ user: MeDTO }` (guest attempts are merged into the account) |
| POST | /auth/logout | – | – | `{ ok: true }` |
| GET | /auth/me | – | – | `{ user: MeDTO \| null }` |
| POST | /auth/magic-link | – | `MagicLinkInput` | `{ ok: true, devLink? }` (devLink only when NODE_ENV≠production) |
| GET | /auth/magic/:token | – | – | sets cookie, 302 → `${APP_URL}/app` |
| POST | /auth/password/forgot | – | `ForgotPasswordInput` | `{ ok: true, devLink? }` |
| POST | /auth/password/reset | – | `ResetPasswordInput` | `{ user: MeDTO }` |
| GET | /auth/google | – | – | 302 to Google (404 `GOOGLE_DISABLED` when not configured) |
| GET | /auth/google/callback | – | – | sets cookie, 302 → `/app` |

## users — `apps/api/src/modules/users`
| Method | Path | Guard | Body | Response |
|---|---|---|---|---|
| GET | /me/profile | User | – | `ProfileDTO` |
| PUT | /me/profile | User | `ProfileInput` | `ProfileDTO` (re-runs alert matching when eligibility fields change) |
| GET | /me/enrollments | User | – | `{ id, familySlug, familyName_ar, familyName_fr, positionSlug, positionTitle_ar, positionTitle_fr, targetExamDate, dailyMinutes, isPrimary }[]` |
| POST | /me/enrollments | User | `EnrollmentInput` | enrollment (upsert by family; also follows the family) |
| PATCH | /me/enrollments/:id | User | partial `EnrollmentInput` | enrollment |
| DELETE | /me/enrollments/:id | User | – | `{ ok }` |
| GET | /me/follows | User | – | `{ familySlug }[]` |
| POST / DELETE | /me/follows/:familySlug | User | – | `{ ok }` |
| GET | /me/checklist/:familySlug | User | – | `{ positionSlug, items: (FactDTO & { checked: boolean })[] }[]` (REQUIRED_DOCUMENT facts) |
| PUT | /me/checklist/:factId | User | `{ checked: boolean }` | `{ ok }` |
| GET | /me/physical-logs | User | – | `{ id, testCode, value, unit, notes, loggedAt }[]` |
| POST | /me/physical-logs | User | `PhysicalLogInput` | log |
| DELETE | /me/physical-logs/:id | User | – | `{ ok }` |
| GET | /me/referral | Registered | – | `{ code, link, invited, rewarded, rewardDays }` |
| GET | /me/export | Registered | – | JSON export of all personal data (legal: access right) |
| DELETE | /me | Registered | `{ confirm: 'DELETE' }` | `{ ok }` (soft delete + anonymise) |

## catalog — `apps/api/src/modules/catalog` (public)
| Method | Path | Response |
|---|---|---|
| GET | /catalog/families?field=&q= | `FamilySummaryDTO[]` (sorted: open editions first, then popularity) |
| GET | /catalog/families/:slug | `FamilyDetailDTO` |
| GET | /catalog/editions?status=OPEN,ANNOUNCED&from=&to= | `EditionDTO[]` (calendar; default upcoming 12 months + currently open) |
| POST | /catalog/eligibility | body `EligibilityInput` → `{ positionSlug, title_ar, title_fr, result: EligibilityResult, provenance: Provenance }[]` (uses the saved profile when logged in and `profile` omitted) |
| GET | /catalog/syllabus/:familySlug | `SyllabusNodeDTO[]` tree (with `mastery` when a session exists) |
| GET | /catalog/lessons/:topicKey?lang= | `{ topic: SyllabusNodeDTO, lessons: { id, title, bodyMd, estMinutes, unreviewed }[] }` |
| GET | /catalog/search?q= | `{ families: FamilySummaryDTO[], topics: { key, title_ar, title_fr, domain }[] }` |
| GET | /catalog/stats | `{ families, questions, sources, officialFacts }` (landing page counters) |

## practice — `apps/api/src/modules/practice`
| Method | Path | Guard | Body | Response |
|---|---|---|---|---|
| POST | /attempts | User | `StartAttemptInput` | `AttemptSessionDTO` |
| GET | /attempts/:id | User | – | `AttemptSessionDTO` (in progress) or `{ result: AttemptResultDTO }` (submitted) |
| POST | /attempts/:id/answers | User | `AnswerInput` | `AnswerFeedbackDTO` |
| POST | /attempts/:id/submit | User | – | `AttemptResultDTO` |
| GET | /attempts?kind=&limit= | User | – | `{ id, kind, familySlug, score, total, submittedAt }[]` |
| GET | /me/mistakes?limit= | User | – | `{ question: QuestionDTO (with correct+explanation), timesWrong, lastAnsweredAt }[]` |
| GET | /me/bookmarks | User | – | `QuestionDTO[]` |
| POST / DELETE | /me/bookmarks/:questionId | User | – | `{ ok }` |
| POST | /questions/:id/report | User | `ReportQuestionInput` | `{ ok }` |
| GET | /offline/pack/:familySlug | User (premium) | – | `{ generatedAt, questions: QuestionDTO (with correct+explanation)[], lessons }` |

Attempt kinds:
- **DIAGNOSTIC** — 24 questions spread over the family's domains (blueprint weights), mode `exam` (no feedback until submit), no daily limit, once per family is enough (can retake).
- **PRACTICE** — `count` (default 10) on `topicKey` or `domain` or the family, adaptive difficulty around the user's rating, mode `instant`. Counts toward the free daily limit (`EntitlementsService.consume`).
- **DAILY** — today's plan practice items, mode `instant`.
- **MOCK** — built from the position's blueprint (same count/time/sections), mode `exam`, `expiresAt = startedAt + totalMinutes`. Free users: 1 mock in total.
- **REVIEW** — due mistakes (`user_question_state.next_review_at <= now` or wrong last time), mode `instant`.

Question selection only serves `PUBLISHED` questions, plus `AI_REVIEWED`/`HUMAN_REVIEWED` when `CONTENT_BETA_MODE=true` (those carry `unreviewed: true`). Questions with `valid_until < today` are excluded. A question is usable by a family when `is_general` and its topic/domain is in the family's syllabus/blueprint, or when linked via `question_families`.

## learning — `apps/api/src/modules/learning`
| Method | Path | Guard | Response |
|---|---|---|---|
| GET | /me/plan/today?familySlug= | User | `TodayPlanDTO` (generated once per day per user with `buildDailyPlan`, stored in study_plan_days) |
| POST | /me/plan/today/:index/done | User | `TodayPlanDTO` |
| GET | /me/readiness/:familySlug | User | `ReadinessDTO` (computeReadiness; snapshot stored daily) |
| GET | /me/progress | User | `{ totals: { answered, correct, accuracy, studyDays }, byDomain: { domain, answered, accuracy }[], last30d: { date, answered, correct }[], mastery: { key, title_ar, title_fr, domain, mastery, attempts }[] }` |

## tutor — `apps/api/src/modules/tutor`
| POST | /tutor/explain | User | `TutorInput` → `TutorResponseDTO` (cache by question+answer+locale; free 3/day; deterministic fallback without AI) |

## gamification — `apps/api/src/modules/gamification`
| GET | /me/gamification | User | `GamificationDTO` |
| GET | /leaderboard?familySlug=&period=week\|all | User | `LeaderboardDTO` (display names are first name + initial; opt-out = hidden) |

## notifications — `apps/api/src/modules/notifications`
| Method | Path | Guard | Response |
|---|---|---|---|
| GET | /me/notifications?limit= | User | `{ items: NotificationDTO[], unread: number }` |
| POST | /me/notifications/:id/read | User | `{ ok }` |
| POST | /me/notifications/read-all | User | `{ ok }` |
| GET | /push/vapid-public-key | – | `{ key: string \| null }` |
| POST | /push/subscribe | User | `PushSubscribeInput` → `{ ok }` |
| POST | /push/unsubscribe | User | `{ endpoint }` → `{ ok }` |
| GET | /me/alerts | User | `{ competition: EditionDTO, positionSlug, positionTitle_ar, positionTitle_fr, eligibility: EligibilityResult, createdAt }[]` (concours matching my profile) |

Cron jobs (`@nestjs/schedule`, disabled when `CRON_ENABLED=false`): hourly alert matching for OPEN/ANNOUNCED editions without `alerts_sent_at`; daily 08:00 Africa/Tunis deadline reminders (D-7, D-2, D-0 for followed/enrolled families) and exam reminders (D-7, D-1); daily study reminder at the user's `dailyReminderHour`; 20:00 streak-at-risk; daily subscription expiry.

## billing — `apps/api/src/modules/billing`
| Method | Path | Guard | Body | Response |
|---|---|---|---|---|
| GET | /billing/plans | – | – | `PlanDTO[]` |
| POST | /billing/promo/validate | Registered | `{ code, planCode }` | `{ valid, percentOff, amountMillimes }` |
| POST | /billing/checkout | Registered | `CheckoutInput` | `CheckoutResultDTO` (KONNECT/FLOUCI → redirectUrl; MANUAL → instructions (D17 / virement); MOCK → auto-paid in dev) |
| POST | /billing/manual-proof | Registered | `ManualProofInput` | `{ ok }` |
| GET | /billing/me | Registered | – | `BillingMeDTO` |
| GET | /billing/return?paymentId= | – | – | verifies with provider, 302 → `/app/billing/return?status=…` |
| GET/POST | /billing/webhooks/konnect?payment_ref= | – | – | verifies via Konnect API, activates subscription (idempotent) |
| POST | /billing/webhooks/flouci | – | – | verifies via Flouci API (idempotent) |

## admin — `apps/api/src/modules/admin` (RolesGuard: ADMIN, EDITOR; user/payment management ADMIN only)
| Method | Path | Notes |
|---|---|---|
| GET | /admin/stats | `AdminStatsDTO` |
| GET | /admin/review?entity=question\|fact\|lesson\|edition&status=AI_REVIEWED&limit= | review queue items with full content |
| POST | /admin/review/:entity/:id | `ReviewActionInput` — enforces CONTENT_TRANSITIONS; `publish` requires a human reviewer (sets reviewed_by) |
| POST | /admin/review/questions/bulk | `{ ids: string[], action }` |
| GET | /admin/questions?status=&domain=&topicKey=&q=&page= | paginated `{ items, total }` with stats (attempts, accuracy, open reports) |
| GET / POST / PATCH | /admin/questions/:id | `QuestionUpsertInput`; edits bump version, reset status to HUMAN_REVIEWED when an editor saves |
| GET | /admin/families | list with counts | 
| POST / PATCH | /admin/families/:slug | family fields |
| POST / PATCH | /admin/families/:slug/positions/:positionSlug | position + eligibility |
| GET / POST | /admin/editions, PATCH /admin/editions/:id | `EditionUpsertInput`; setting status OPEN/ANNOUNCED (or `POST /admin/editions/:id/notify`) runs `AlertsService.matchCompetition` |
| GET | /admin/facts?needsVerification=true&familySlug= | facts/phases/subjects/eligibility to verify |
| PATCH | /admin/facts/:kind/:id | `FactVerifyInput` (kind = fact\|phase\|subject\|eligibility\|edition) |
| GET / POST | /admin/sources | `SourceUpsertInput` |
| GET / POST / PATCH | /admin/blueprints, /admin/blueprints/:id | blueprint sections |
| GET | /admin/reports?status=OPEN | question reports; PATCH /admin/reports/:id `{ status }` |
| GET | /admin/users?q=&page= | users; PATCH /admin/users/:id `{ role?, grantDays? }` (ADMIN) |
| GET | /admin/payments?status= | payments; POST /admin/payments/:id/approve, /reject (ADMIN, manual payments) |
| POST | /admin/notifications/broadcast | `BroadcastInput` → `{ sent }` |
| GET | /admin/waitlist | entries + willingness stats |
| GET | /admin/audit?limit= | audit log |

## ingestion & ai — `apps/api/src/modules/ingestion`, `apps/api/src/modules/ai`
| Method | Path | Notes |
|---|---|---|
| POST | /admin/documents (multipart `file`, `sourceId?`) | stores PDF (UPLOAD_DIR), sha256 dedupe, text layer extraction (pdf-parse), chunks per page |
| GET | /admin/documents, /admin/documents/:id | with chunks |
| POST | /admin/ai/extract | `AiExtractInput` → creates draft facts proposal `{ editions[], eligibility, phases[], subjects[], documents[] }` each with `source_quote` + page; nothing is published |
| POST | /admin/ai/generate-questions | `AiGenerateInput` → job; generated questions inserted as DRAFT → auto-validated → AI_REVIEWED (or rejected with reason) |
| GET | /admin/ai/jobs | job list |
| GET / POST | /admin/watch | watched official URLs (concours.gov.tn, ministries…) |
| POST | /admin/watch/check-now | fetch watched URLs, detect changes (sha256), create `ingest_candidates` |
| GET | /admin/ingest | candidates; POST /admin/ingest/:id/draft `{ familySlug }` → draft edition (needs_verification=true); POST /admin/ingest/:id/ignore |

## growth — `apps/api/src/modules/growth`
| POST | /waitlist | `WaitlistInput` → `{ ok }` |
| POST | /events | `{ name, props }` → `{ ok }` (lightweight funnel analytics: landing_view, diagnostic_start, diagnostic_done, signup, paywall_view, checkout_start, paid) |

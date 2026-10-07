# E. Data Model — نموذج البيانات

> المبدأ: **كل معلومة عن المناظرة قابلة للتتبّع إلى مصدر**. لا يوجد حقل "حقيقة" بدون `source`.
> قاعدة البيانات: PostgreSQL. الـ ORM المقترح: Prisma (أو Drizzle). الأسماء بالإنجليزية، المحتوى ثنائي اللغة (ar/fr).

---

## 1. الفكرة الأساسية: Fact + Provenance

بدل أن نخزّن `exam_duration = "2h"` كنص حرّ في جدول المناظرة، نخزّن كل معلومة مهمة كـ **Fact** مرتبط بـ **Source**:

```
Competition ──< CompetitionFact >── Source ──< SourceDocument (PDF/page)
```

هكذا نعرف دائمًا: من قال هذا؟ متى نُشر؟ متى تحققنا منه آخر مرة؟ ما درجة الثقة؟

### Enums

```text
SourceType        = OFFICIAL | SECONDARY | COMMUNITY
Confidence        = HIGH | MEDIUM | LOW
                    HIGH   = نص رسمي صريح (بلاغ/قرار/رائد رسمي) + رقم الصفحة
                    MEDIUM = مصدر رسمي لكن قديم (دورة سابقة) أو مصدر ثانوي موثوق (صحيفة نقلت البلاغ)
                    LOW    = مجتمع/تجارب مترشحين/غير مؤكد
ContentStatus     = DRAFT | AI_REVIEWED | HUMAN_REVIEWED | PUBLISHED | ARCHIVED
FactKey           = ELIGIBILITY | AGE_LIMIT | DIPLOMA | REGISTRATION_DEADLINE | EXAM_DATE
                  | PHASE | SUBJECT | PROGRAM | DURATION | COEFFICIENT | SCORING
                  | PHYSICAL_TEST | ORAL_TEST | PSYCHOTECH_TEST | MEDICAL_TEST
                  | REQUIRED_DOCUMENT | POSITIONS_COUNT | FEE | OTHER
QuestionType      = MCQ_SINGLE | MCQ_MULTI | TRUE_FALSE | MATCHING | ORDERING
                  | NUMERIC | SHORT_TEXT
QuestionDomain    = CULTURE_GENERALE | FRENCH | ARABIC | ENGLISH | LOGIC
                  | NUMERICAL | PSYCHOTECH | SPECIALTY
Difficulty        = EASY | MEDIUM | HARD | EXPERT
QuestionOrigin    = PAST_EXAM_VERBATIM | PAST_EXAM_REWRITTEN | AUTHORED | AI_GENERATED
```

---

## 2. الجداول (Schema مختصر)

### 2.1 المصادر

```sql
source (
  id, title, url, publisher,            -- مثال: "concours.gov.tn", "JORT n°45"
  source_type  SourceType,
  publication_date date,
  retrieved_at timestamptz,
  last_verified_at timestamptz,
  confidence Confidence,
  notes text
)

source_document (                         -- الملف نفسه (PDF، صورة، HTML snapshot)
  id, source_id → source,
  storage_key text,                       -- S3 key
  sha256 text UNIQUE,                     -- لمعرفة إن تغيّر البلاغ
  mime, page_count, language,
  ocr_status, extracted_text_key
)

source_chunk (                            -- مقاطع نصية لكل صفحة (للـ traceability و RAG)
  id, document_id → source_document,
  page int, chunk_index int,
  text text, embedding vector(1024),      -- pgvector
  tsv tsvector                            -- PostgreSQL FTS
)
```

### 2.2 المناظرات

```sql
organization (id, name_ar, name_fr, ministry, website)

competition_family (                      -- "مناظرة حافظ أمن" ككيان دائم عبر السنوات
  id, organization_id, slug, name_ar, name_fr, description
)

competition (                             -- دورة محددة: "حافظ أمن 2026"
  id, family_id, year, session_label,
  status  ('ANNOUNCED','OPEN','CLOSED','EXAM_DONE','RESULTS'),
  announcement_source_id → source,
  registration_open date, registration_deadline date,
  content_status ContentStatus
)

position (                                -- رتبة/خطة داخل المناظرة
  id, competition_id, title_ar, title_fr,
  positions_count int NULL, gender_rule text NULL, diploma_level text
)

phase (                                   -- مراحل الاختبار بالترتيب
  id, position_id, order_index,
  kind ('WRITTEN','PHYSICAL','ORAL','PSYCHOTECH','MEDICAL','FILE_REVIEW','INTERVIEW'),
  is_eliminatory bool, duration_minutes int NULL,
  fact_id → competition_fact               -- مصدر المعلومة
)

exam_subject (                            -- مواد مرحلة كتابية
  id, phase_id, domain QuestionDomain,
  name_ar, name_fr, coefficient numeric NULL, duration_minutes int NULL,
  question_count int NULL,                 -- إن كان معروفًا رسميًا
  fact_id → competition_fact
)

competition_fact (                        -- قلب نظام الـ provenance
  id, competition_id, position_id NULL,
  key FactKey,
  value_json jsonb,                       -- {"min_age":18,"max_age":30}
  display_ar text, display_fr text,
  source_id → source, source_page int NULL, source_quote text,   -- اقتباس حرفي
  source_type SourceType,                 -- denormalized للعرض السريع
  confidence Confidence,
  last_verified_at timestamptz,
  status ContentStatus,
  superseded_by → competition_fact NULL
)
```

**قاعدة عرض في الواجهة:** كل fact يظهر معه شارة:
- 🟢 `رسمي` + رابط + تاريخ آخر تحقق
- 🟡 `مصدر ثانوي`
- ⚪ `تجربة مترشحين — غير رسمي`

### 2.3 المنهج (Curriculum)

```sql
syllabus_node (                           -- شجرة: مادة → محور → موضوع
  id, family_id, parent_id NULL,
  level ('SUBJECT','UNIT','TOPIC'),
  domain QuestionDomain,
  title_ar, title_fr, order_index,
  scope ('OFFICIAL_PROGRAM','INFERRED_FROM_PAST_EXAMS','GENERAL_SKILL'),
  source_id NULL, source_page NULL,        -- إلزامي إن scope = OFFICIAL_PROGRAM
  status ContentStatus
)

learning_objective (
  id, syllabus_node_id, text_ar, text_fr,
  source_chunk_id NULL, status ContentStatus
)

lesson (id, syllabus_node_id, title, body_md, est_minutes, status, version)
```

`scope` مهم جدًا: إن لم يكن هناك برنامج رسمي منشور (حالة شائعة في مناظرات الأمن)،
نقول صراحة للمستخدم إن الموضوع **مستنتج من امتحانات سابقة** وليس من برنامج رسمي.

### 2.4 بنك الأسئلة

```sql
question (
  id, type QuestionType, domain QuestionDomain, language ('ar','fr','en'),
  stem text, stem_media_key NULL,
  options jsonb,                -- [{id:"a", text:"..."}]
  correct jsonb,                -- ["a"] أو {"pairs":[...]} أو {"value":42,"tolerance":0}
  explanation text,
  difficulty Difficulty, difficulty_irt numeric NULL,  -- يُحسب لاحقًا من بيانات الإجابة
  origin QuestionOrigin,
  past_exam_id NULL → past_exam,         -- إن كان من امتحان سابق
  source_id NULL, source_page NULL,
  status ContentStatus, version int,
  created_by, reviewed_by NULL, reviewed_at NULL,
  ai_model NULL, ai_prompt_version NULL  -- إن كان AI_GENERATED
)

question_objective (question_id, learning_objective_id)   -- many-to-many
question_competition (question_id, family_id, position_id NULL)

past_exam (
  id, family_id, year, position_id NULL,
  source_id, source_type, file_document_id,
  is_verified bool                         -- هل الامتحان أصلي ومؤكد؟
)

question_report (id, question_id, user_id, reason, comment, status)  -- "أبلغ عن خطأ"
```

**سلسلة الـ traceability المطلوبة:**
`question → question_objective → learning_objective → syllabus_node → source → source_document (page)`

قاعدة validation في الـ backend: سؤال `AI_GENERATED` لا يمكن أن يصبح `PUBLISHED` إذا لم يكن مربوطًا بـ learning_objective واحد على الأقل
ومراجعًا من إنسان (`reviewed_by IS NOT NULL`).

### 2.5 الامتحانات والتجارب

```sql
exam_blueprint (                          -- "وصفة" Mock Exam تحاكي الحقيقي
  id, position_id, title, total_minutes,
  sections jsonb,                         -- [{domain:"FRENCH", count:20, minutes:30, difficulty_mix:{EASY:.3,MEDIUM:.5,HARD:.2}}]
  fidelity ('OFFICIAL_FORMAT','APPROXIMATED'),   -- هل البنية مأخوذة من نص رسمي أم تقديرية
  fact_ids uuid[]                         -- الحقائق الرسمية التي بُنيت عليها
)

attempt (
  id, user_id, kind ('DIAGNOSTIC','PRACTICE','DAILY','MOCK'),
  blueprint_id NULL, started_at, submitted_at, duration_s,
  score numeric, result_json jsonb
)

attempt_answer (
  attempt_id, question_id, answer jsonb, is_correct bool,
  time_ms int, confidence_self NULL, answered_at
)
```

### 2.6 المستخدم والتعلّم التكيفي

```sql
app_user (id, email, phone NULL, name, locale, created_at, auth_provider)

enrollment (                              -- المستخدم يحضّر لمناظرة محددة
  id, user_id, family_id, position_id NULL, target_exam_date NULL,
  daily_minutes int, eligibility_json jsonb, created_at
)

mastery (                                 -- حالة إتقان المستخدم لكل موضوع
  user_id, syllabus_node_id,
  p_mastery numeric,                      -- 0..1 (Elo/BKT مبسط)
  attempts int, correct int, last_seen_at,
  next_review_at,                         -- spaced repetition
  PRIMARY KEY (user_id, syllabus_node_id)
)

study_plan_day (user_id, date, items jsonb, completed_json jsonb)

weakness_event (user_id, syllabus_node_id, question_id, created_at)   -- يسجّله الـ AI tutor

-- gamification (خفيفة)
xp_event (user_id, amount, reason, created_at)
streak (user_id, current, longest, last_active_date)
```

### 2.7 الاشتراكات

```sql
plan (id, code, name, price_tnd_millimes int, period ('MONTH','EXAM_PASS','YEAR'), features jsonb)
subscription (id, user_id, plan_id, status, starts_at, ends_at, provider, provider_ref)
payment (id, user_id, amount_millimes, currency, provider, provider_ref, status, raw jsonb, created_at)
```
ملاحظة: الدينار التونسي يُقسّم إلى 1000 مليم → خزّن المبالغ كـ integer بالمليم.

### 2.8 الإدارة والتدقيق

```sql
content_review (id, entity_type, entity_id, from_status, to_status, reviewer_id, comment, created_at)
audit_log (id, actor_id, action, entity_type, entity_id, diff jsonb, created_at)
ai_job (id, kind, input_ref, output_ref, model, prompt_version, tokens_in, tokens_out, cost_usd, status)
```

---

## 3. لماذا هذا التصميم مناسب لـ Solo Founder

- **جدول واحد للحقائق** (`competition_fact`) بدل عشرات الأعمدة المتغيرة لكل مناظرة: المناظرات التونسية تختلف كثيرًا في البنية.
- `jsonb` للأجزاء المتغيرة (options, blueprint sections) بدون تعقيد.
- `pgvector` + `tsvector` داخل نفس PostgreSQL ⇒ لا حاجة لـ OpenSearch في V1.
- `content_status` موحد لكل أنواع المحتوى ⇒ dashboard مراجعة واحد.

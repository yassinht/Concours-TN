# F. System Architecture · H. AI Architecture · I. Question Generation Pipeline

> القاعدة: **Boring technology**. كل مكوّن إضافي = ساعات صيانة يدفعها شخص واحد.

---

## F. System Architecture

### F.1 الاختيار: PWA وليس Flutter/React Native في V1

| المعيار | PWA (Next.js) | Flutter / React Native |
|---|---|---|
| الوصول من رابط TikTok/Facebook مباشرة | ✅ رابط → اختبار فورًا، بدون تثبيت | ❌ يتطلب store → تثبيت → فتح (تسرّب كبير) |
| SEO (صفحات "مناظرة الديوانة 2026") | ✅ أساسي للاكتساب | ❌ |
| رسوم المتجر على الاشتراكات | لا شيء | Google Play billing (15–30%) + صعوبة الدفع المحلي داخل التطبيق |
| Offline | ✅ Service Worker + IndexedDB | ✅ |
| Push notifications | ✅ Android/Chrome. iOS فقط إذا ثُبّت على الشاشة الرئيسية (iOS ≥ 16.4) | ✅ |
| كلفة solo dev | قاعدة كود واحدة | قاعدة ثانية |

**القرار:** PWA في V1. السوق التونسي يغلب عليه Android (يجب التأكد بأرقام StatCounter قبل الإطلاق)، وWeb Push يعمل جيدًا عليه.
إن احتجنا متجر Play لاحقًا: تغليف الـ PWA عبر **TWA (Trusted Web Activity)** دون إعادة كتابة.

### F.2 Stack

| طبقة | الاختيار | لماذا |
|---|---|---|
| Frontend | **Next.js (React) + TypeScript + Tailwind**، RTL أصلي | SSR للـ SEO، PWA، نظام واحد |
| Backend | **NestJS 11** (modular monolith) + **Drizzle ORM** | اقترحته؛ بنية واضحة، DI؛ Drizzle بدون محرك ثنائي (أبسط للنشر) |
| DB | **PostgreSQL 16** | علاقات + jsonb + بحث نصي؛ pgvector لاحقًا |
| Jobs | `@nestjs/schedule` (cron) + مهام داخل العملية | كافٍ لـ V1؛ Redis/BullMQ عند الحاجة للتوسع (docker-compose جاهز) |
| Storage | S3-compatible (Cloudflare R2 أو Backblaze B2) | PDFs، صور الأسئلة |
| OCR | Tesseract (ara+fra) محليًا أولًا؛ OCR سحابي فقط للملفات الرديئة | التكلفة |
| AI | LLM API (Claude: نموذج قوي للتوليد/المراجعة، نموذج سريع ورخيص للـ tutor) | لا تدريب نماذج خاصة في V1 |
| Auth | Email magic link + Google. (رقم الهاتف OTP لاحقًا إن ثبتت الحاجة — كلفة SMS) | Apple Sign-In غير ضروري لـ PWA |
| Payments | Konnect + Flouci + يدوي (D17/تحويل) + Mock للتطوير — انظر `08-monetization-financial.md` | Stripe غير متاح للمقيمين |
| Notifications | In-app + **Web Push (VAPID)** + Email (SMTP/Brevo) — محرك تنبيهات حسب الملف | |
| Hosting | VPS واحد (Docker Compose) + Postgres مُدار أو backup يومي إلى S3 | ~20–40 USD/شهر |
| Monitoring | Sentry + Uptime Kuma + PostHog (analytics, self-host أو cloud) | |
| Email | Resend/Brevo | |

⚠️ **مكان الاستضافة**: قانون 2004-63 ينظم نقل المعطيات الشخصية إلى الخارج (يحتاج ترخيص الهيئة الوطنية لحماية المعطيات الشخصية INPDP في حالات معينة). **قبل الإطلاق: مراجعة قانونية** حول استضافة بيانات المستخدمين خارج تونس. انظر `09-legal.md`.

### F.3 المخطط

```
                ┌──────────────────────── Cloudflare (CDN, cache static, WAF) ─────────────────────┐
 Mobile browser │                                                                                   │
 (PWA, SW cache)├──► Next.js (SSR pages: landing, /concours/[slug], SEO)                             │
                │        │                                                                          │
                │        ▼ REST/JSON                                                                │
                │    NestJS API (monolith)                                                          │
                │     ├─ auth        ├─ competitions/facts   ├─ syllabus      ├─ questions          │
                │     ├─ attempts    ├─ adaptive/plan        ├─ tutor (AI)    ├─ billing            │
                │     ├─ admin/review├─ ingestion            └─ gamification                        │
                │        │                     │                                                   │
                │   PostgreSQL+pgvector     Redis/BullMQ ──► Workers: ocr · extract · generate ·    │
                │                                             validate · embed · notify            │
                │                         S3/R2 (PDFs, snapshots)      LLM API                      │
                └───────────────────────────────────────────────────────────────────────────────────┘
```

### F.4 الأداء على اتصال ضعيف

- صفحة الاختبار: JS < 150KB، لا مكتبات UI ثقيلة.
- تحميل **حزمة أسئلة** (20–50 سؤالًا JSON مضغوطًا، ~20–40KB) دفعة واحدة؛ الإجابات تُخزّن في IndexedDB وتُرسل batch عند عودة الاتصال (background sync).
- "تحميل للمراجعة offline": دروس + حزم أسئلة لمادة كاملة (Premium).
- **Mock exam**: الأسئلة تُحمّل مسبقًا بالكامل، المؤقت محلي، الإرسال يُعاد تلقائيًا ⇒ انقطاع الشبكة لا يُفسد الامتحان.
- الإجابة الصحيحة لا تُرسل للعميل قبل الإجابة في الـ mock (منع الغش في الترتيب)؛ في التدريب العادي يمكن إرسالها لتصحيح فوري offline.

---

## H. AI Architecture

### H.1 أين نستخدم AI — وأين لا نستخدمه

| الاستخدام | AI؟ | ملاحظة |
|---|---|---|
| استخراج بنية البلاغ الرسمي (مراحل، شروط، مواعيد) | ✅ مساعدة | **إنسان يؤكد كل fact** مع اقتباس الصفحة |
| تحديد أن موضوعًا ما "ضمن المنهج" | ❌ | قرار بشري مبني على نص رسمي أو امتحانات سابقة |
| مسودات أسئلة | ✅ | لا تُنشر بدون مراجعة بشرية |
| شرح الخطأ للمستخدم (Tutor) | ✅ | مقيّد بـ (السؤال + الشرح المراجَع + مقاطع المصدر) |
| حساب الجاهزية/الخطة | ❌ | خوارزميات حتمية قابلة للتفسير |
| الإجابة عن "متى المناظرة؟/ما الشروط؟" | ⚠️ RAG فقط على facts المنشورة، مع ذكر المصدر؛ وإلا "لا نعرف" | |

### H.2 AI Tutor (عند الإجابة الخاطئة)

**المدخلات المحقونة في الـ prompt (grounding):**
1. السؤال، الخيارات، الإجابة الصحيحة، إجابة المستخدم.
2. `explanation` المراجَع بشريًا (المرجع الأساسي).
3. الـ learning objective + 1–3 مقاطع `source_chunk` المرتبطة.
4. حالة إتقان المستخدم للموضوع.

**المخرجات (JSON منظم):**
```json
{
  "why_wrong": "...",          // لماذا اختيارك خاطئ (مرتبط بالخيار الذي اختاره)
  "concept": "...",            // المفهوم في 3-5 جمل
  "example": "...",
  "similar_question_id": "q_123",   // من البنك المنشور — لا نولّد سؤالًا جديدًا غير مراجَع
  "review_topic_id": "node_45",
  "citations": ["source_chunk:991"]
}
```
- **السؤال المشابه يُختار من البنك المنشور** (نفس الـ objective، صعوبة مماثلة) — لا يُولَّد لحظيًا.
- الـ weakness يُسجَّل بشكل حتمي من بيانات الإجابة (ليس قرار AI).
- تخزين الشرح المولّد في cache بالمفتاح `(question_id, chosen_option)` ⇒ نفس الخطأ يتكرر عند آلاف المستخدمين ⇒ **تكلفة AI تنخفض بشدة**. ويمكن ترقية الشروحات الأكثر استعمالًا إلى محتوى مراجَع بشريًا.
- Guardrails: إن لم يجد سندًا في المصدر → "راجع الشرح الرسمي" بدل الاختلاق. الحد اليومي للطلبات (Free: 3/يوم).

### H.3 التعلم التكيفي (بدون AI معقد)

**نموذج الإتقان (V1):** Elo مبسط لكل (user, topic):
```
expected = 1 / (1 + 10^((d_q - θ_u,t)/400))
θ_u,t   += K * (correct - expected)          K = 32 مبدئيًا
p_mastery = sigmoid((θ_u,t - 1000)/150)
```
صعوبة السؤال `d_q` تبدأ من التصنيف اليدوي (Easy=900, Medium=1000, Hard=1100, Expert=1200) ثم تُعاير من بيانات الإجابات.

**الخطة اليومية:** 
```
weight(topic) = exam_weight(topic) × (1 - p_mastery) × recency_boost
```
- `exam_weight` من الـ blueprint (وزن المادة في الامتحان الحقيقي إن عُرف رسميًا، وإلا تقديري معلَن).
- توزيع الوقت اليومي (مثلًا 30 دقيقة) على المواضيع بنسب الأوزان + 20% مراجعة متباعدة (`next_review_at`).
- Mock exam أسبوعي إن كان الموعد قريبًا (< 6 أسابيع).

### H.4 Readiness Score

```
topic_score    = p_mastery مُعدَّل بعدد المحاولات (shrinkage: لا ثقة بـ 3 أسئلة)
domain_score   = Σ topic_score × weight / Σ weight
overall        = Σ domain_score × exam_coefficient
mock_component = متوسط آخر 2 mock exams (إن وُجدت)
preparation    = 0.6 × overall + 0.4 × mock_component
coverage       = نسبة مواضيع المنهج التي جُرّب فيها ≥ 10 أسئلة
```

| Label | الشرط (يُعرض مع السبب) |
|---|---|
| Excellent preparation | preparation ≥ 80% **و** coverage ≥ 80% **و** ≥ 2 mocks |
| Good preparation | ≥ 65% و coverage ≥ 60% |
| Needs improvement | ≥ 45% |
| Not ready yet | < 45% أو coverage < 30% |

**نص ثابت تحت كل نتيجة:** "هذا مؤشر لمستوى تحضيرك داخل المنصة، وليس توقعًا لنتيجة المناظرة. النجاح يعتمد أيضًا على عدد المترشحين والمراحل الأخرى (رياضية، شفاهية، طبية)."
الأسباب تُولّد حتميًا: "لم تُجرِ أي Mock exam بعد"، "مادة الفرنسية 52% ووزنها 30% من الامتحان".

### H.5 تكلفة AI تقديرية (للتخطيط فقط)

- Tutor: ~1.5K tokens in / 400 out لكل شرح. مع cache بمعدل إصابة 60–80% وحد يومي للطلبات، الهدف **< 0.30 TND / مستخدم نشط / شهر** بنموذج سريع. (أعد الحساب بأسعار الـ API وقت الإطلاق — هذا رقم تخطيطي وليس سعرًا مؤكدًا.)
- التوليد: دفعات batch offline ⇒ تكلفة ثابتة صغيرة لكل 1000 سؤال؛ الكلفة الحقيقية هي **وقت المراجعة البشرية**.

---

## I. Content Engine & Question Generation Pipeline

```
[1] Ingest           رفع PDF / رابط → snapshot + sha256 + Source (OFFICIAL/SECONDARY/COMMUNITY)
      ↓
[2] Extract          pdf text layer؛ إن فارغ → OCR (ara+fra) ؛ تقسيم صفحات → source_chunk
      ↓
[3] Structure        LLM يقترح: مراحل/شروط/مواد/مواعيد كـ JSON + رقم الصفحة + اقتباس حرفي
      ↓                → competition_fact بحالة DRAFT
[4] Human verify     الأدمن يقارن الاقتباس بالصفحة (عرض جنبًا إلى جنب) → يقبل/يعدّل
      ↓
[5] Syllabus         من البرنامج الرسمي (إن وُجد) أو من تحليل الامتحانات السابقة
      ↓                كل syllabus_node يحمل scope + source
[6] Objectives       LLM يقترح learning objectives لكل topic → مراجعة بشرية
      ↓
[7] Generate Qs      لكل objective: N أسئلة بـ prompt مقيّد بالمقاطع المصدرية + أمثلة من امتحانات سابقة (style)
      ↓
[8] Auto-validate    (أ) JSON schema  (ب) إجابة صحيحة واحدة بالضبط  (ج) LLM ثانٍ يحل السؤال بدون معرفة الإجابة → يجب أن يتفق
      ↓                (د) كشف التكرار (تشابه Jaccard للكلمات > 0.8؛ embeddings في V2)  (هـ) لغة/إملاء  (و) لا خيار "كل ما سبق" عشوائيًا
      ↓                → AI_REVIEWED  (أو مرفوض تلقائيًا مع السبب)
[9] Human review     واجهة سريعة: قبول / تعديل / رفض (اختصارات لوحة المفاتيح) → HUMAN_REVIEWED
      ↓
[10] Publish         يدخل البنك؛ يُراقب: نسبة الإجابات الصحيحة، تقارير "خطأ في السؤال"، discrimination index
      ↓
[11] Archive         عند تغيّر البرنامج أو التقارير المتكررة
```

**قواعد صارمة:**
1. لا يوجد سؤال منشور بدون `learning_objective` ⇒ لا يوجد سؤال منشور بدون أثر للمصدر.
2. أسئلة الامتحانات السابقة: تُعلَّم `PAST_EXAM_VERBATIM` أو `PAST_EXAM_REWRITTEN` مع السنة والمصدر، و`is_verified` إن تأكدنا من أصالتها. (انظر الملاحظات القانونية.)
3. Culture générale / الأحداث الجارية: كل سؤال يحمل `valid_until` لأن الإجابات تتقادم (وزراء، أرقام).
4. Psychotechnique (متتاليات، مصفوفات، إلخ): يمكن توليدها **خوارزميًا** (parametric generators) بدل LLM ⇒ صحيحة رياضيًا 100% وغير محدودة العدد.
5. KPI المراجعة: هدف ~60–100 سؤال/ساعة للمراجعة السريعة. 1500 سؤال MVP ≈ 20–30 ساعة مراجعة.


---

## Alerts engine — "نبّهني عندما تُفتح مناظرة تناسب ملفي"

```
Admin opens/announces an edition  ─┐
Watcher detects a new announcement ─┼─► AlertsService.matchCompetition(edition)
Hourly cron (alerts_sent_at null)  ─┘        │
                                             ├─ candidates = users with alerts on ∧ (field ∈ alert_fields ∨ follows/enrolled)
                                             ├─ for each targeted position: checkEligibility(rules, profile, refDate) (@ctn/shared)
                                             ├─ ELIGIBLE / PARTIAL ⇒ alert_matches + ONE notification per user (dedupe key)
                                             └─ deliver: in-app · Web Push · Email (per user channels)
Profile updated / user registers ──────► AlertsService.matchUser(user) (all open editions)
Daily 08:00 (Africa/Tunis) ───────────► deadline reminders D-7/D-2/D-0 · exam reminders D-7/D-1
```
- المطابقة **حتمية** (لا AI) وقابلة للتفسير: كل تنبيه يحمل قائمة الشروط (✓/✗/؟).
- PARTIAL = ملف ناقص ⇒ ننبه مع دعوة لإكمال الملف بدل تفويت المناظرة.
- شروط غير موثقة (`needs_verification`) ⇒ التنبيه يقول صراحة "الشروط بحاجة إلى تحقق — ارجع للبلاغ الرسمي".

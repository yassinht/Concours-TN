# Concours TN — Product Strategy (index)

> **The operating system for preparing Tunisian candidates for public-sector competitive exams.**
> الأولوية: Accurate content > User outcomes > Distribution > Monetization > Fancy technology

## الخلاصة التنفيذية (Executive summary)

1. **السوق**: 26.6% بطالة لدى حاملي الشهادات، >130 ألف مسجل في ANETI، 84% يملكون هاتفًا ذكيًا. المناظرات العمومية مستمرة في 2026 (الأسلاك الأمنية ~3,500 خطة/سنة على عدة دورات، 66,125 مترشحًا لـ 1,630 خطة أستاذ ثانوي، بنوك، مالية، مؤسسات). لكن جزءًا كبيرًا من "الانتدابات" تسويات أو قوائم انتظار — **ليست كلها أسواق تحضير**.
2. **الفراغ**: لا يوجد منتج تونسي منظم ومدفوع للتحضير لهذه المناظرات. البديل = Facebook + PDFs + منتديات (مترشحون يطلبون روابط QCM).
3. **أول مناظرة**: حزمة **الأسلاك الأمنية** (حافظ أمن، عرفاء الحرس، الحماية المدنية، السجون) — متكررة، نفس الشروط ونفس صيغة الكتابي، جمهور واسع على TikTok/Facebook — ثم **الديوانة**. الأساتذة: waitlist فقط.
4. **التموضع**: معلومة موثقة بمصدرها + **تنبيه شخصي عند فتح مناظرة تطابق ملفك** + تشخيص + محاكاة حقيقية + شرح الأخطاء + خطة يومية.
5. **النموذج**: Freemium + Premium 19 د.ت/شهر، 45 د.ت/3 أشهر، **باس المناظرة 59 د.ت**؛ دفع Konnect/Flouci/D17. التعادل ≈ 125 دافعًا. مشروع مربح لمؤسس واحد، ليس VC-scale إلا بالتوسع المغاربي.
6. **الخطر الأكبر**: رغبة الدفع لدى جمهور شاب بلا دخل ⇒ **Pre-sale قبل الاستثمار في المحتوى الكثيف**. معايير توقف واضحة.

## الوثائق

| | الوثيقة |
|---|---|
| A, B, C | [01-market-research.md](01-market-research.md) — جدول المناظرات، المنافسون، حجم السوق، أفضل 3 فرص، أول مناظرة |
| D | [02-curriculum.md](02-curriculum.md) — بنية المنهج و scopes |
| E | [05-data-model.md](05-data-model.md) + المخطط الفعلي `apps/api/src/db/schema.ts` |
| F, H, I | [06-architecture-ai.md](06-architecture-ai.md) — المعمارية، AI tutor، التعلم التكيفي، الجاهزية، خط إنتاج الأسئلة، محرك التنبيهات |
| G, J, QC | [07-ux-admin.md](07-ux-admin.md) — مسار المستخدم، الشاشات، لوحة الأدمن، مراقبة الجودة |
| K, P | [08-monetization-financial.md](08-monetization-financial.md) — الأسعار والنموذج المالي |
| L + Validation | [09-acquisition-validation.md](09-acquisition-validation.md) — التحقق من رغبة الدفع، أول 10/100/500/1000، أمثلة محتوى |
| M | [10-legal.md](10-legal.md) — ما يحتاج مراجعة قانونية |
| N, O, Q, R | [11-mvp-roadmap-risks.md](11-mvp-roadmap-risks.md) — MVP، 30/60/90، المخاطر، معايير التوقف |
| تقني | [api-contract.md](api-contract.md) · [BUILD-GUIDE.md](BUILD-GUIDE.md) |
| مصادر خام | [research/01-market-raw.md](research/01-market-raw.md) · [research/02-competitors-payments-legal-raw.md](research/02-competitors-payments-legal-raw.md) |
| المحتوى | [`content/`](../content) — المناظرات (مع المصادر و`needs_verification`) وبنوك الأسئلة وتقارير مراجعتها |

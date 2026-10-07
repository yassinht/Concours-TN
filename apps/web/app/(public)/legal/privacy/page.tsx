import type { Metadata } from 'next';
import { LegalDoc, type DocSection } from '@/components/public/legal-doc';
import { ContactLine, Container, DraftNotice, PageHeader, Prose } from '@/components/public/sections';
import { pageMetadata } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { formatDate, t } from '@/lib/i18n';

const UPDATED = '2026-10-07';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata(locale, {
    title: { ar: 'سياسة الخصوصية', fr: 'Politique de confidentialité' },
    description: { ar: 'ما المعطيات التي نجمعها، لماذا، وكيف تمارس حقوقك طبق القانون الأساسي عدد 63 لسنة 2004.', fr: 'Quelles données nous collectons, pourquoi, et comment exercer vos droits (loi organique n° 2004-63).' },
    path: '/legal/privacy',
  });
}

const SECTIONS: DocSection[] = [
  {
    id: 'controller',
    title: { ar: 'المسؤول عن المعالجة', fr: 'Responsable du traitement' },
    body: [
      { ar: 'Concours TN منصة تونسية مستقلة للتحضير للمناظرات العمومية. بيانات الهوية القانونية للمؤسسة (المعرف الجبائي والعنوان) تُنشر هنا عند استكمال التسجيل القانوني.', fr: 'Concours TN est une plateforme tunisienne indépendante de préparation aux concours publics. Les informations légales de l’entreprise (matricule fiscal, adresse) seront publiées ici à l’issue de son immatriculation.' },
      { ar: 'نخضع للقانون الأساسي عدد 63 لسنة 2004 المتعلق بحماية المعطيات الشخصية. التصريح المسبق لدى الهيئة الوطنية لحماية المعطيات الشخصية (INPDP) في طور الإنجاز قبل الإطلاق التجاري.', fr: 'Nous sommes soumis à la loi organique n° 2004-63 relative à la protection des données personnelles. La déclaration préalable auprès de l’INPDP est en cours, avant le lancement commercial.' },
    ],
  },
  {
    id: 'data',
    title: { ar: 'المعطيات التي نجمعها', fr: 'Données collectées' },
    body: [
      {
        list: [
          { ar: 'حساب ضيف: معرّف تقني فقط، دون اسم أو بريد، حتى تجرب الاختبار التشخيصي دون تسجيل.', fr: 'Compte invité : un identifiant technique, sans nom ni e-mail, pour essayer le diagnostic sans inscription.' },
          { ar: 'الحساب المسجل: الاسم، البريد الإلكتروني، وكلمة السر مخزنة بشكل مشفر (لا يمكن لأحد قراءتها).', fr: 'Compte inscrit : nom, e-mail et mot de passe stocké sous forme chiffrée (illisible, y compris pour nous).' },
          { ar: 'ملف الأهلية (اختياري): تاريخ الميلاد، الجنس، المستوى الدراسي، الاختصاص، الولاية، الطول، الحالة المدنية، رقم الهاتف.', fr: 'Profil d’éligibilité (facultatif) : date de naissance, sexe, diplôme, spécialité, gouvernorat, taille, situation familiale, téléphone.' },
          { ar: 'نشاط التعلم: إجاباتك، نتائجك، تقدمك، وأخطاؤك المحفوظة للمراجعة.', fr: 'Activité d’apprentissage : réponses, résultats, progression et erreurs enregistrées pour la révision.' },
          { ar: 'التنبيهات: تفضيلاتك (المجالات، القنوات) وعنوان الاشتراك التقني في إشعارات المتصفح إن فعّلتها.', fr: 'Alertes : vos préférences (domaines, canaux) et l’adresse technique d’abonnement aux notifications du navigateur si vous les activez.' },
          { ar: 'الدفع: سجل المعاملات (المبلغ، المزود، الحالة، مرجع العملية). بيانات البطاقة البنكية لا تمر بخوادمنا أبدًا.', fr: 'Paiement : historique des transactions (montant, prestataire, statut, référence). Vos données de carte ne transitent jamais par nos serveurs.' },
          { ar: 'إحصاءات استعمال داخلية (مثل زيارة صفحة أو إتمام اختبار) لتحسين المنصة، دون أي أداة إشهارية أو تتبع من طرف ثالث.', fr: 'Statistiques d’usage internes (ex. visite d’une page, fin d’un test) pour améliorer la plateforme, sans outil publicitaire ni traceur tiers.' },
          { ar: 'قائمة الانتظار: البريد أو الهاتف، المناظرة المختارة، وإجابتك الاختيارية عن السعر.', fr: 'Liste d’attente : e-mail ou téléphone, concours choisi et votre réponse facultative sur le prix.' },
        ],
      },
    ],
  },
  {
    id: 'purposes',
    title: { ar: 'لماذا نستعملها', fr: 'Finalités' },
    body: [
      {
        list: [
          { ar: 'تقديم الخدمة: الاختبارات، الخطة اليومية، الإحصاءات ومؤشر الجاهزية.', fr: 'Fournir le service : tests, plan quotidien, statistiques et indicateur de préparation.' },
          { ar: 'مقارنة ملفك بشروط المناظرات وإرسال التنبيهات التي طلبتها.', fr: 'Comparer votre profil aux conditions des concours et envoyer les alertes demandées.' },
          { ar: 'الفوترة وتفعيل الاشتراكات.', fr: 'Facturation et activation des abonnements.' },
          { ar: 'تحسين المحتوى (مثل اكتشاف الأسئلة الغامضة) عبر إحصاءات مجمعة لا تكشف هوية أحد.', fr: 'Améliorer le contenu (ex. détecter les questions ambiguës) via des statistiques agrégées non identifiantes.' },
        ],
      },
      { ar: 'لا نبيع معطياتك، ولا نستعملها للإشهار، ولا نتخذ أي قرار آلي يمس حقوقك: نتيجة الأهلية مجرد مقارنة إرشادية مع الشروط المعلنة.', fr: 'Nous ne vendons pas vos données, ne les utilisons pas pour de la publicité et ne prenons aucune décision automatisée affectant vos droits : le résultat d’éligibilité est une comparaison indicative avec les conditions annoncées.' },
    ],
  },
  {
    id: 'sensitive',
    title: { ar: 'المعطيات الحساسة', fr: 'Données sensibles' },
    body: [
      { ar: 'الطول والحالة المدنية ونتائج التمارين الرياضية اختيارية تمامًا، وتُستعمل فقط لمقارنتها بشروط المناظرات أو لمتابعة تقدمك. لا نطلب أي ملف أو شهادة طبية.', fr: 'Taille, situation familiale et résultats sportifs sont entièrement facultatifs et servent uniquement à la comparaison avec les conditions ou au suivi de vos progrès. Nous ne demandons aucun dossier ni certificat médical.' },
    ],
  },
  {
    id: 'sharing',
    title: { ar: 'مع من نشاركها', fr: 'Destinataires' },
    body: [
      { ar: 'فقط مع مزودين تقنيين ضروريين للخدمة وفي حدود ما يحتاجونه: الاستضافة، إرسال البريد الإلكتروني، مزودو الدفع (Konnect، Flouci)، وخدمات إشعارات المتصفح. لا يحق لهم استعمال معطياتك لأغراضهم الخاصة.', fr: 'Uniquement avec les prestataires techniques nécessaires, dans la limite de leur besoin : hébergement, envoi d’e-mails, prestataires de paiement (Konnect, Flouci) et services de notification du navigateur. Ils ne peuvent pas utiliser vos données pour leurs propres fins.' },
      { ar: 'مكان الاستضافة وما قد يتطلبه من ترخيص لنقل المعطيات إلى الخارج قيد الدراسة القانونية، وسنحدّث هذه الفقرة قبل الإطلاق التجاري.', fr: 'Le lieu d’hébergement et l’éventuelle autorisation de transfert à l’étranger sont en cours d’examen juridique ; ce paragraphe sera mis à jour avant le lancement commercial.' },
    ],
  },
  {
    id: 'retention',
    title: { ar: 'مدة الحفظ', fr: 'Durée de conservation' },
    body: [
      { ar: 'نحفظ معطيات حسابك طيلة استعمالك للخدمة. عند حذف الحساب تُمحى معطياتك الشخصية أو يُخفى ما يربطها بك، باستثناء سجلات الدفع التي نحفظها المدة التي يفرضها القانون المحاسبي.', fr: 'Vos données sont conservées tant que vous utilisez le service. À la suppression du compte, vos données personnelles sont effacées ou anonymisées, sauf les justificatifs de paiement conservés pendant la durée légale comptable.' },
    ],
  },
  {
    id: 'rights',
    title: { ar: 'حقوقك', fr: 'Vos droits' },
    body: [
      {
        list: [
          { ar: 'النفاذ: تنزيل نسخة كاملة من معطياتك (ملف JSON) من إعدادات حسابك.', fr: 'Accès : téléchargez une copie complète de vos données (fichier JSON) depuis les réglages du compte.' },
          { ar: 'التصحيح: تعديل ملفك في أي وقت.', fr: 'Rectification : modifiez votre profil à tout moment.' },
          { ar: 'الاعتراض: إيقاف التنبيهات أو الإشعارات أو رسائل البريد بنقرة (رابط إلغاء الاشتراك في كل رسالة).', fr: 'Opposition : désactivez alertes, notifications ou e-mails en un clic (lien de désinscription dans chaque e-mail).' },
          { ar: 'الحذف: حذف حسابك نهائيًا من الإعدادات.', fr: 'Suppression : supprimez définitivement votre compte depuis les réglages.' },
        ],
      },
      { ar: 'يمكنك أيضًا تقديم شكوى لدى الهيئة الوطنية لحماية المعطيات الشخصية (INPDP).', fr: 'Vous pouvez également saisir l’Instance nationale de protection des données personnelles (INPDP).' },
    ],
  },
  {
    id: 'cookies',
    title: { ar: 'ملفات تعريف الارتباط', fr: 'Cookies' },
    body: [
      {
        list: [
          { ar: 'ctn_session: يحفظ جلستك (ضروري، غير قابل للقراءة من الصفحة).', fr: 'ctn_session : conserve votre session (indispensable, inaccessible aux scripts de la page).' },
          { ar: 'ctn_lang: يحفظ اللغة التي اخترتها.', fr: 'ctn_lang : mémorise la langue choisie.' },
        ],
      },
      { ar: 'لا نستعمل أي ملفات تعريف ارتباط إشهارية أو تحليلية من أطراف ثالثة.', fr: 'Aucun cookie publicitaire ou analytique tiers n’est utilisé.' },
    ],
  },
  {
    id: 'security',
    title: { ar: 'الأمن', fr: 'Sécurité' },
    body: [
      { ar: 'اتصال مشفر، كلمات سر مشفرة، جلسات محمية، سجل لكل تعديل يقوم به فريقنا على المحتوى، وصلاحيات محدودة لكل عضو. لا يوجد نظام آمن مئة بالمئة، وسنعلمك في حال وقوع أي خرق يمس معطياتك.', fr: 'Connexion chiffrée, mots de passe chiffrés, sessions protégées, journal de chaque modification de contenu par l’équipe et droits limités. Aucun système n’est sûr à 100 % : nous vous informerons de toute violation affectant vos données.' },
    ],
  },
];

export default async function PrivacyPage() {
  const locale = await getLocale();
  return (
    <>
      <PageHeader title={t(locale, { ar: 'سياسة الخصوصية', fr: 'Politique de confidentialité' })} lead={t(locale, { ar: 'نجمع أقل ما يمكن، ولا نبيع شيئًا، وتبقى معطياتك ملكك.', fr: 'Nous collectons le minimum, ne vendons rien, et vos données restent les vôtres.' })} />
      <Container className="flex flex-col gap-6 py-6">
        <DraftNotice locale={locale} updated={formatDate(locale, UPDATED)} />
        <LegalDoc locale={locale} sections={SECTIONS} />
        <Prose><ContactLine locale={locale} /></Prose>
      </Container>
    </>
  );
}

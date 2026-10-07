import type { Metadata } from 'next';
import { REFERRAL_REWARD_DAYS } from '@ctn/shared';
import { LegalDoc, type DocSection } from '@/components/public/legal-doc';
import { ContactLine, Container, DraftNotice, PageHeader, Prose } from '@/components/public/sections';
import { countLabel } from '@/components/public/labels';
import { pageMetadata } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { formatDate, t } from '@/lib/i18n';

const UPDATED = '2026-10-07';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata(locale, {
    title: { ar: 'شروط الاستعمال', fr: 'Conditions générales d’utilisation' },
    description: { ar: 'شروط استعمال منصة Concours TN: طبيعة الخدمة، المعلومات ومصادرها، الاشتراكات، حق التراجع والمسؤولية.', fr: 'Conditions d’utilisation de Concours TN : nature du service, informations et sources, abonnements, rétractation et responsabilité.' },
    path: '/legal/terms',
  });
}

const SECTIONS: DocSection[] = [
  {
    id: 'object',
    title: { ar: 'موضوع الخدمة', fr: 'Objet du service' },
    body: [
      { ar: 'Concours TN خدمة رقمية للتحضير للمناظرات العمومية في تونس: معلومات عن المناظرات مرفقة بمصادرها، اختبارات تشخيصية، أسئلة تدريبية، دروس، امتحانات تجريبية، تنبيهات وخطة دراسة.', fr: 'Concours TN est un service numérique de préparation aux concours publics en Tunisie : informations sourcées, tests diagnostiques, QCM, leçons, examens blancs, alertes et plan de révision.' },
      { ar: 'باستعمالك للمنصة فإنك تقبل هذه الشروط.', fr: 'L’utilisation de la plateforme vaut acceptation des présentes conditions.' },
    ],
  },
  {
    id: 'independence',
    title: { ar: 'منصة مستقلة', fr: 'Plateforme indépendante' },
    body: [
      { ar: 'Concours TN ليست الموقع الرسمي للمناظرات ولا تتبع أي وزارة أو هيكل عمومي. لا نتلقى الترشحات ولا نتدخل في سير المناظرات أو نتائجها. الترشح يتم حصريًا عبر concours.gov.tn أو المواقع الرسمية للهياكل المعنية.', fr: 'Concours TN n’est pas le site officiel des concours et ne dépend d’aucun ministère ni organisme public. Nous ne recevons pas de candidatures et n’intervenons ni dans le déroulement ni dans les résultats. Les candidatures se font exclusivement sur concours.gov.tn ou les sites officiels des organismes.' },
    ],
  },
  {
    id: 'information',
    title: { ar: 'المعلومات عن المناظرات', fr: 'Informations sur les concours' },
    body: [
      { ar: 'نبذل عناية جدية في جمع المعلومات من مصادرها والتحقق منها، وكل معلومة تحمل شارة توضح مصدرها ودرجة التحقق منها («رسمي»، «مصدر ثانوي»، «تجارب مترشحين»، «للتحقق»).', fr: 'Nous recueillons et vérifions les informations avec soin ; chacune porte un badge indiquant sa source et son niveau de vérification (« Officiel », « Source secondaire », « Communauté », « À vérifier »).' },
      { ar: 'البلاغ الرسمي هو المرجع الوحيد. لا نتحمل مسؤولية قرار مبني على معلومة تحمل شارة «للتحقق» أو على معلومة تغيرت بعد تاريخ آخر تحقق المذكور.', fr: 'Seul l’avis officiel fait foi. Nous ne sommes pas responsables d’une décision fondée sur une information marquée « À vérifier » ou modifiée après la date de dernière vérification indiquée.' },
      { ar: 'نتيجة «التحقق من الأهلية» مقارنة إرشادية بالشروط المعلنة وليست قرارًا بقبول ترشحك.', fr: 'Le résultat de la « vérification d’éligibilité » est une comparaison indicative avec les conditions annoncées, pas une décision d’admissibilité.' },
    ],
  },
  {
    id: 'content',
    title: { ar: 'المحتوى التعليمي', fr: 'Contenu pédagogique' },
    body: [
      { ar: 'الأسئلة والدروس أصلية أو معاد صياغتها «على نمط» الامتحانات السابقة، ويحمل كل سؤال أصله. لا ننشر «أسئلة مسربة». كل محتوى مولّد آليًا يراجعه إنسان قبل نشره.', fr: 'Questions et leçons sont originales ou reformulées « dans le style » des annales ; chaque question affiche son origine. Aucune « fuite ». Tout contenu généré automatiquement est relu par un humain avant publication.' },
      { ar: 'المحتوى محمي بحقوق الملكية الفكرية. يُمنع نسخه أو إعادة نشره أو استخراجه آليًا أو مشاركة الحسابات المدفوعة.', fr: 'Le contenu est protégé par le droit d’auteur. Copie, republication, extraction automatisée et partage de comptes payants sont interdits.' },
      { ar: 'إن وجدت خطأ في سؤال أو معلومة، استعمل زر «أبلغ عن خطأ»: نراجع كل بلاغ.', fr: 'Si vous trouvez une erreur, utilisez le bouton « Signaler une erreur » : chaque signalement est examiné.' },
    ],
  },
  {
    id: 'account',
    title: { ar: 'الحساب', fr: 'Compte' },
    body: [
      { ar: 'يمكنك البدء بحساب ضيف ثم التسجيل للاحتفاظ بتقدمك. أنت مسؤول عن سرية كلمة السر وعن صحة المعطيات التي تدخلها. يمكنك حذف حسابك في أي وقت.', fr: 'Vous pouvez commencer en invité puis vous inscrire pour conserver votre progression. Vous êtes responsable de la confidentialité de votre mot de passe et de l’exactitude de vos informations. Vous pouvez supprimer votre compte à tout moment.' },
      { ar: 'يمكننا تعليق حساب في حالة استعمال تعسفي (استخراج آلي للمحتوى، احتيال في الدفع أو في نظام الإحالة).', fr: 'Nous pouvons suspendre un compte en cas d’usage abusif (extraction automatisée, fraude au paiement ou au parrainage).' },
    ],
  },
  {
    id: 'payments',
    title: { ar: 'الاشتراكات والدفع', fr: 'Abonnements et paiement' },
    body: [
      {
        list: [
          { ar: 'الأسعار معروضة بالدينار التونسي في صفحة الأسعار وعند الدفع، مع مدة كل اشتراك.', fr: 'Les prix sont affichés en dinars tunisiens sur la page Tarifs et au paiement, avec la durée de chaque abonnement.' },
          { ar: 'كل اشتراك دفعة واحدة لمدة محددة، دون تجديد تلقائي.', fr: 'Chaque abonnement est un paiement unique pour une durée fixe, sans renouvellement automatique.' },
          { ar: 'الدفع بالبطاقة أو e-Dinar يُفعّل الاشتراك فور تأكيده من مزود الدفع؛ الدفع عبر D17 أو التحويل يُفعّل بعد التثبت منه.', fr: 'Le paiement par carte ou e-Dinar active l’abonnement dès confirmation du prestataire ; D17 ou virement l’active après vérification.' },
          { ar: 'حق التراجع: طبقًا للقانون عدد 83 لسنة 2000 المتعلق بالمبادلات والتجارة الإلكترونية، يمكنك التراجع في أجل 10 أيام عمل من تاريخ الاشتراك. يُرجع المبلغ بنفس وسيلة الدفع قدر الإمكان.', fr: 'Rétractation : conformément à la loi n° 2000-83 relative aux échanges et au commerce électroniques, vous pouvez vous rétracter dans les 10 jours ouvrables suivant l’abonnement. Le remboursement se fait si possible par le même moyen de paiement.' },
          { ar: 'يمكنك طلب وثيقة تثبت المعاملة، وتجد سجل مدفوعاتك في صفحة الاشتراك بحسابك.', fr: 'Vous pouvez demander un justificatif de transaction ; l’historique des paiements figure sur la page Abonnement de votre compte.' },
        ],
      },
    ],
  },
  {
    id: 'referral',
    title: { ar: 'الإحالة', fr: 'Parrainage' },
    body: [
      { ar: `عندما يتم شخص دعوته الاختبار التشخيصي، يحصل كلاكما على ${countLabel('ar', REFERRAL_REWARD_DAYS, 'day')} بريميوم. المكافأة شخصية وغير قابلة للتحويل إلى مال.`, fr: `Quand une personne invitée termine le diagnostic, vous recevez tous les deux ${countLabel('fr', REFERRAL_REWARD_DAYS, 'day')} de Premium. La récompense est personnelle et non convertible en argent.` },
    ],
  },
  {
    id: 'no-guarantee',
    title: { ar: 'لا ضمان للنجاح', fr: 'Absence de garantie de réussite' },
    body: [
      { ar: 'مؤشر الجاهزية يقيس تحضيرك داخل المنصة فقط. النجاح في المناظرة يعتمد أيضًا على عدد المترشحين والخطط المفتوحة والمراحل الأخرى (رياضية، شفاهية، طبية) وعلى قرارات اللجان. لا نعد بأي نتيجة.', fr: 'L’indicateur de préparation mesure votre préparation sur la plateforme uniquement. La réussite dépend aussi du nombre de candidats et de postes, des autres épreuves (sport, oral, médical) et des jurys. Nous ne promettons aucun résultat.' },
    ],
  },
  {
    id: 'liability',
    title: { ar: 'المسؤولية والتوفر', fr: 'Responsabilité et disponibilité' },
    body: [
      { ar: 'نعمل على أن تكون الخدمة متاحة باستمرار، لكن قد تنقطع للصيانة أو لأسباب خارجة عن إرادتنا. التنبيهات وسيلة مساعدة ولا تغني عن متابعتك للبلاغات الرسمية.', fr: 'Nous visons une disponibilité continue, mais le service peut être interrompu (maintenance, causes externes). Les alertes sont une aide et ne remplacent pas votre suivi des avis officiels.' },
    ],
  },
  {
    id: 'changes',
    title: { ar: 'تعديل الشروط والقانون المنطبق', fr: 'Modification et droit applicable' },
    body: [
      { ar: 'قد نعدّل هذه الشروط، وسنعلم المستعملين المسجلين بأي تغيير جوهري قبل دخوله حيز التنفيذ. تخضع هذه الشروط للقانون التونسي، والمحاكم التونسية مختصة بالنظر في أي نزاع.', fr: 'Ces conditions peuvent évoluer ; les inscrits seront informés de tout changement important avant son entrée en vigueur. Elles sont régies par le droit tunisien, les tribunaux tunisiens étant compétents.' },
    ],
  },
];

export default async function TermsPage() {
  const locale = await getLocale();
  return (
    <>
      <PageHeader title={t(locale, { ar: 'شروط الاستعمال', fr: 'Conditions générales d’utilisation' })} />
      <Container className="flex flex-col gap-6 py-6">
        <DraftNotice locale={locale} updated={formatDate(locale, UPDATED)} />
        <LegalDoc locale={locale} sections={SECTIONS} />
        <Prose><ContactLine locale={locale} /></Prose>
      </Container>
    </>
  );
}

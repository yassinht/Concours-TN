import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowLeft, ArrowRight, BadgeCheck, Bell, BellRing, CalendarClock, CheckCircle2, ClipboardCheck, Gauge, Mail, Smartphone, Sparkles, Target, UserCheck,
} from 'lucide-react';
import { FIELDS, FIELD_LABELS, PLANS, formatTnd, type EditionDTO, type FamilySummaryDTO, type Locale } from '@ctn/shared';
import { Badge, ButtonLink, Card, Stat } from '@/components/ui';
import { EditionStatusBadge, KeyDateLine } from '@/components/public/edition-status';
import { FieldIcon } from '@/components/public/icons';
import { countLabel, editionTitle, keyDateOf, loc, sessionLabelFor, tunisToday } from '@/components/public/labels';
import { PrepPath } from '@/components/public/prep-path';
import { Container, Disclosure, JsonLd, ProvenanceLegend, Section } from '@/components/public/sections';
import { load, pageMetadata } from '@/components/public/server-data';
import { TrackEvent } from '@/components/public/track';
import { WaitlistForm } from '@/components/public/waitlist-form';
import { getLocale } from '@/lib/i18n-server';
import { t, type Bi } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    ...pageMetadata(locale, {
      title: { ar: 'استعد لمناظرتك خطوة بخطوة', fr: 'Préparez votre concours étape par étape' },
      description: {
        ar: 'منصة تونسية مستقلة للتحضير للمناظرات العمومية: الشروط والمراحل والبرنامج بمصادرها، اختبار تشخيصي مجاني، بنك أسئلة، امتحانات تجريبية وتنبيهات عند فتح المناظرات المناسبة لك.',
        fr: 'Plateforme tunisienne indépendante pour préparer les concours publics : conditions, épreuves et programme sourcés, test diagnostique gratuit, QCM, examens blancs et alertes quand un concours vous correspond.',
      },
      path: '/',
    }),
    title: { absolute: t(locale, { ar: 'Concours TN — استعد لمناظرتك خطوة بخطوة', fr: 'Concours TN — Préparez votre concours étape par étape' }) },
  };
}

type Stats = { families: number; questions: number; sources: number; officialFacts: number };

const FAQ: { q: Bi; a: Bi }[] = [
  {
    q: { ar: 'هل هذا موقع رسمي؟', fr: 'Est-ce un site officiel ?' },
    a: {
      ar: 'لا. Concours TN منصة مستقلة للتحضير وليست تابعة لأي وزارة. الترشح يتم فقط عبر concours.gov.tn أو مواقع الهياكل المعنية. كل معلومة عندنا مرفقة برابط مصدرها حتى تتحقق منها بنفسك.',
      fr: 'Non. Concours TN est une plateforme de préparation indépendante, sans lien avec un ministère. Les candidatures se font uniquement sur concours.gov.tn ou les sites des organismes. Chaque information est liée à sa source pour que vous puissiez la vérifier.',
    },
  },
  {
    q: { ar: 'هل الأسئلة حقيقية من امتحانات سابقة؟', fr: 'Les questions viennent-elles de vrais examens ?' },
    a: {
      ar: 'كل سؤال يحمل أصله بوضوح: «على نمط امتحان سابق» (أعيدت صياغته)، «من إعداد فريقنا»، أو «مولّد آليًا وراجعه إنسان». لا ننشر «أسئلة مسربة»، ولا يُنشر أي سؤال قبل مراجعة بشرية.',
      fr: 'Chaque question affiche son origine : « dans le style d’un ancien examen » (reformulée), « rédigée par notre équipe » ou « générée puis relue par un humain ». Pas de « fuites », et rien n’est publié sans relecture humaine.',
    },
  },
  {
    q: { ar: 'هل يعمل التطبيق دون إنترنت؟', fr: 'L’application fonctionne-t-elle hors ligne ?' },
    a: {
      ar: 'نعم. Concours TN تطبيق ويب (PWA) يمكن تثبيته على هاتفك من المتصفح دون متجر تطبيقات. الصفحات التي زرتها تبقى متاحة، ويمكن للمشتركين تحميل حزم أسئلة ودروس للمراجعة دون اتصال.',
      fr: 'Oui. Concours TN est une application web (PWA) installable depuis le navigateur, sans store. Les pages consultées restent disponibles et les abonnés peuvent télécharger des packs de questions et de leçons hors ligne.',
    },
  },
  {
    q: { ar: 'كيف تصلني التنبيهات بالمناظرات المناسبة لي؟', fr: 'Comment recevoir les alertes des concours qui me correspondent ?' },
    a: {
      ar: 'أدخل سنك ومستواك الدراسي واختصاصك مرة واحدة. عند نشر مناظرة تستوفي شروطها المعلنة، يصلك تنبيه داخل التطبيق وعلى هاتفك (إن فعّلت الإشعارات) وبالبريد إن كان لديك حساب، ثم تذكير قبل آخر أجل.',
      fr: 'Indiquez une fois votre âge, votre diplôme et votre spécialité. Quand un concours dont vous remplissez les conditions est publié, vous êtes alerté(e) dans l’app, sur votre téléphone (si activé) et par e-mail si vous avez un compte, puis avant la clôture.',
    },
  },
  {
    q: { ar: 'هل الخدمة مجانية؟', fr: 'Est-ce gratuit ?' },
    a: {
      ar: 'نعم للبدء: الاختبار التشخيصي، التنبيهات، 20 سؤالًا يوميًا وامتحان تجريبي واحد مجانًا. الاشتراك بريميوم يفتح التدريب غير المحدود والامتحانات التجريبية والتحليل الكامل.',
      fr: 'Oui pour commencer : test diagnostique, alertes, 20 questions par jour et un examen blanc gratuits. Premium débloque l’entraînement illimité, les examens blancs et l’analyse complète.',
    },
  },
  {
    q: { ar: 'هل تضمنون النجاح؟', fr: 'Garantissez-vous la réussite ?' },
    a: {
      ar: 'لا. مؤشر الجاهزية يقيس مستوى تحضيرك داخل المنصة فقط، والنجاح يعتمد أيضًا على عدد المترشحين والمراحل الأخرى (رياضية، شفاهية، طبية). نعدك فقط بتحضير منظم ومعلومات صادقة.',
      fr: 'Non. L’indicateur de préparation mesure votre niveau sur la plateforme ; la réussite dépend aussi du nombre de candidats et des autres épreuves (sport, oral, médical). Nous promettons une préparation structurée et des informations honnêtes.',
    },
  },
];

const HOW: { icon: typeof Target; title: Bi; body: Bi }[] = [
  { icon: Target, title: { ar: 'اختر مناظرتك', fr: 'Choisissez votre concours' }, body: { ar: 'اطّلع على الشروط والمراحل والبرنامج، وتحقق من أهليتك في دقيقة.', fr: 'Consultez conditions, épreuves et programme, et vérifiez votre éligibilité en une minute.' } },
  { icon: ClipboardCheck, title: { ar: 'اختبار تشخيصي', fr: 'Test diagnostique' }, body: { ar: '24 سؤالًا موزعة على مواد الامتحان تكشف نقاط قوتك وضعفك.', fr: '24 questions réparties sur les matières de l’examen révèlent vos points forts et faibles.' } },
  { icon: CalendarClock, title: { ar: 'خطة يومية', fr: 'Plan quotidien' }, body: { ar: 'دروس قصيرة، أسئلة مصححة ومراجعة أخطائك حسب الوقت المتبقي للامتحان.', fr: 'Leçons courtes, QCM corrigés et révision de vos erreurs selon le temps restant.' } },
  { icon: Gauge, title: { ar: 'امتحانات تجريبية', fr: 'Examens blancs' }, body: { ar: 'بنفس الوقت وعدد الأسئلة، مع مؤشر جاهزية يشرح أين وصلت وماذا تراجع.', fr: 'Même durée et format, avec un indicateur qui explique où vous en êtes et quoi réviser.' } },
];

const PROBLEMS: Bi[] = [
  { ar: 'ماذا سيُسأل في الامتحان؟', fr: 'Que va-t-on me demander ?' },
  { ar: 'ما هي المراحل وأيها إقصائي؟', fr: 'Quelles épreuves, lesquelles sont éliminatoires ?' },
  { ar: 'ما هو البرنامج بالضبط؟', fr: 'Quel est le programme exact ?' },
  { ar: 'من أين أبدأ وكيف أستعد؟', fr: 'Par où commencer, comment se préparer ?' },
];

/** Open editions first (closest deadline), then anything with an upcoming date (opening, deadline or exam). */
function pickStrip(editions: EditionDTO[]): EditionDTO[] {
  const today = tunisToday();
  return editions
    .map((e) => ({ e, key: keyDateOf(e, today) }))
    .filter(({ e, key }) => e.status === 'OPEN' || (key.kind !== null && key.date !== null && key.date >= today))
    .sort((a, b) => (a.e.status === 'OPEN' ? 0 : 1) - (b.e.status === 'OPEN' ? 0 : 1) || (a.key.date ?? '9999').localeCompare(b.key.date ?? '9999'))
    .slice(0, 8)
    .map(({ e }) => e);
}

export default async function LandingPage() {
  const locale = await getLocale();
  const [stats, editions, families] = await Promise.all([
    load<Stats>('/catalog/stats', 300),
    load<EditionDTO[]>('/catalog/editions'),
    load<FamilySummaryDTO[]>('/catalog/families'),
  ]);
  const strip = pickStrip(editions.data ?? []);
  const openCount = strip.filter((e) => e.status === 'OPEN').length;
  const familyList = families.data ?? [];
  const Arrow = locale === 'ar' ? ArrowLeft : ArrowRight;

  return (
    <>
      <TrackEvent name="landing_view" props={{ locale }} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: t(locale, f.q), acceptedAnswer: { '@type': 'Answer', text: t(locale, f.a) } })),
        }}
      />

      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-b from-primary-soft to-bg">
        <Container className="grid grid-cols-1 gap-8 py-10 sm:py-14 md:grid-cols-[1.25fr_1fr] md:items-center">
          <div className="flex flex-col gap-4">
            <Badge tone="primary" className="self-start">
              <BadgeCheck className="size-3.5" aria-hidden />
              {t(locale, { ar: 'منصة مستقلة · معلومات بمصادرها', fr: 'Plateforme indépendante · informations sourcées' })}
            </Badge>
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">
              {t(locale, { ar: 'استعد لمناظرتك خطوة بخطوة', fr: 'Préparez votre concours étape par étape' })}
            </h1>
            <p className="max-w-xl text-base text-muted sm:text-lg">
              {t(locale, {
                ar: 'ترى إعلانًا عن مناظرة لكنك لا تعرف ماذا سيُسأل، ما هي المراحل، ما البرنامج ولا من أين تبدأ؟ نجمع لك المعلومات من مصادرها، نقيس مستواك باختبار تشخيصي، ثم نرافقك بخطة يومية حتى يوم الامتحان.',
                fr: 'Vous voyez un concours mais ne savez pas ce qui sera demandé, quelles sont les épreuves, le programme ni par où commencer ? Nous réunissons les informations sourcées, mesurons votre niveau par un test diagnostique, puis vous accompagnons avec un plan quotidien jusqu’à l’examen.',
              })}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <ButtonLink href="#diagnostic" size="lg" variant="accent">
                <Sparkles className="size-5" aria-hidden />
                {t(locale, { ar: 'اختبار تشخيصي مجاني', fr: 'Test diagnostique gratuit' })}
              </ButtonLink>
              <ButtonLink href="/concours" size="lg" variant="secondary">
                {t(locale, { ar: 'اكتشف المناظرات', fr: 'Découvrir les concours' })}
                <Arrow className="size-5" aria-hidden />
              </ButtonLink>
            </div>
            <p className="text-sm text-muted">
              {t(locale, { ar: 'بدون تسجيل · حوالي 15 دقيقة · 24 سؤالًا', fr: 'Sans inscription · environ 15 minutes · 24 questions' })}
            </p>
          </div>

          <Card className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-muted">{t(locale, { ar: 'أسئلة يطرحها كل مترشح', fr: 'Les questions de tout candidat' })}</p>
            <ul className="flex flex-col gap-2">
              {PROBLEMS.map((p, i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                  <span className="font-semibold">{t(locale, p)}</span>
                </li>
              ))}
            </ul>
            <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
              {t(locale, {
                ar: 'لكل مناظرة صفحة واحدة تجيب عن هذه الأسئلة، وكل معلومة عليها شارة توضح مصدرها ومدى التحقق منها.',
                fr: 'Chaque concours a une page qui y répond, et chaque information porte un badge indiquant sa source et son niveau de vérification.',
              })}
            </p>
          </Card>
        </Container>
      </section>

      <Container className="flex flex-col gap-14 py-10">
        {/* Counters (a zero is not shown: it would say nothing useful) */}
        {stats.data && (() => {
          const counters = ([
            [stats.data.families, { ar: 'مناظرة مغطاة', fr: 'concours couverts' }],
            [stats.data.questions, { ar: 'سؤال تدريبي', fr: 'questions d’entraînement' }],
            [stats.data.sources, { ar: 'مصدر موثّق', fr: 'sources référencées' }],
            [stats.data.officialFacts, { ar: 'معلومة رسمية مُتحقق منها', fr: 'faits officiels vérifiés' }],
          ] as [number, Bi][]).filter(([n]) => n > 0);
          if (!counters.length) return null;
          const cols = counters.length >= 4 ? 'sm:grid-cols-4' : counters.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
          return (
            <section aria-label={t(locale, { ar: 'أرقام المنصة', fr: 'Chiffres de la plateforme' })} className={`grid grid-cols-2 gap-3 ${cols}`}>
              {counters.map(([n, label], i) => <Stat key={i} label={t(locale, label)} value={n.toLocaleString('fr-FR')} />)}
            </section>
          );
        })()}

        {/* Currently open */}
        <Section
          id="open"
          title={openCount > 0 ? t(locale, { ar: 'مناظرات مفتوحة الآن', fr: 'Concours ouverts maintenant' }) : t(locale, { ar: 'المواعيد القادمة', fr: 'Prochaines échéances' })}
          lead={t(locale, { ar: 'التواريخ غير المؤكدة تحمل شارة «للتحقق».', fr: 'Les dates non confirmées portent le badge « À vérifier ».' })}
          action={<Link href="/calendar" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">{t(locale, { ar: 'الرزنامة الكاملة', fr: 'Calendrier complet' })}<Arrow className="size-4" aria-hidden /></Link>}
        >
          {editions.error ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">{t(locale, { ar: 'تعذّر تحميل المواعيد حاليًا.', fr: 'Impossible de charger les dates pour le moment.' })}</p>
          ) : strip.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-4">
              <p className="text-sm text-muted">{t(locale, { ar: 'لا توجد مواعيد قادمة معلنة حاليًا.', fr: 'Aucune échéance annoncée pour le moment.' })}</p>
              <Link href="/alerts" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"><Bell className="size-4" aria-hidden />{t(locale, { ar: 'نبّهني عند فتح مناظرة تناسبني', fr: 'M’alerter quand un concours me correspond' })}</Link>
            </div>
          ) : (
            <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
              {strip.map((e) => (
                <li key={e.id} className="w-72 shrink-0 snap-start">
                  <Link href={`/concours/${e.familySlug}`} className="card flex h-full flex-col gap-2 p-4 hover:border-primary">
                    <span className="flex items-center gap-2 text-xs text-muted"><FieldIcon field={e.field} className="size-4" />{t(locale, FIELD_LABELS[e.field])}</span>
                    <span className="line-clamp-2 font-bold">{editionTitle(locale, e)}</span>
                    {e.sessionLabel && <span className="line-clamp-2 text-xs text-muted" dir="auto">{sessionLabelFor(locale, e.sessionLabel)}</span>}
                    <EditionStatusBadge locale={locale} edition={e} />
                    <KeyDateLine locale={locale} edition={e} />
                    {e.positionsCount != null && <span className="text-xs text-muted">{t(locale, { ar: 'عدد الخطط', fr: 'Postes' })}: <span className="font-semibold tabular-nums text-text">{e.positionsCount}</span></span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Alerts */}
        <section aria-labelledby="alerts-title" className="overflow-hidden rounded-3xl bg-primary text-primary-contrast">
          <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 md:grid-cols-[1.3fr_1fr] md:items-center">
            <div className="flex flex-col gap-3">
              <h2 id="alerts-title" className="text-2xl font-extrabold">{t(locale, { ar: 'لا تفوّت أي مناظرة تناسبك', fr: 'Ne ratez plus un concours fait pour vous' })}</h2>
              <p className="opacity-90">
                {t(locale, {
                  ar: 'أدخل سنك وشهادتك واختصاصك مرة واحدة. عند نشر مناظرة تستوفي شروطها، نُعلمك فورًا ثم نذكّرك قبل آخر أجل للترشح.',
                  fr: 'Indiquez une fois votre âge, diplôme et spécialité. Dès qu’un concours dont vous remplissez les conditions est publié, on vous prévient, puis on vous rappelle la clôture.',
                })}
              </p>
              <ul className="flex flex-wrap gap-2 text-sm">
                <li className="inline-flex items-center gap-1.5 rounded-full bg-primary-contrast/15 px-3 py-1"><BellRing className="size-4" aria-hidden />{t(locale, { ar: 'داخل التطبيق', fr: 'Dans l’app' })}</li>
                <li className="inline-flex items-center gap-1.5 rounded-full bg-primary-contrast/15 px-3 py-1"><Smartphone className="size-4" aria-hidden />{t(locale, { ar: 'إشعار على الهاتف', fr: 'Notification mobile' })}</li>
                <li className="inline-flex items-center gap-1.5 rounded-full bg-primary-contrast/15 px-3 py-1"><Mail className="size-4" aria-hidden />{t(locale, { ar: 'البريد الإلكتروني', fr: 'E-mail' })}</li>
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <Link href="/alerts" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface px-5 font-bold text-primary hover:opacity-90">
                <UserCheck className="size-5" aria-hidden />
                {t(locale, { ar: 'اكتشف المناظرات المناسبة لي', fr: 'Voir les concours qui me correspondent' })}
              </Link>
              <p className="text-center text-xs opacity-80">{t(locale, { ar: 'مجاني · دون حساب · يمكن الإيقاف في أي وقت', fr: 'Gratuit · sans compte · désactivable à tout moment' })}</p>
            </div>
          </div>
        </section>

        {/* Fields */}
        <Section id="fields" title={t(locale, { ar: 'المناظرات حسب المجال', fr: 'Concours par domaine' })}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {FIELDS.map((f) => (
              <li key={f}>
                <Link href={`/concours?field=${f}`} className="card flex min-h-16 items-center gap-3 p-3 hover:border-primary">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><FieldIcon field={f} /></span>
                  <span className="text-sm font-semibold">{t(locale, FIELD_LABELS[f])}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        {/* Preparation path */}
        <Section id="path" title={t(locale, { ar: 'مسار التحضير', fr: 'Le parcours de préparation' })} lead={t(locale, { ar: 'من «ما هي هذه المناظرة؟» إلى «هل أنا جاهز؟».', fr: 'De « c’est quoi ce concours ? » à « suis-je prêt(e) ? ».' })}>
          <PrepPath locale={locale} />
        </Section>

        {/* Diagnostic chooser */}
        <Section
          id="diagnostic"
          title={t(locale, { ar: 'اختر مناظرتك وابدأ الاختبار التشخيصي', fr: 'Choisissez votre concours et lancez le diagnostic' })}
          lead={t(locale, { ar: 'مجاني ودون تسجيل. ستعرف مستواك في كل مادة وما يجب أن تراجعه أولًا.', fr: 'Gratuit et sans inscription. Vous saurez votre niveau par matière et quoi réviser en premier.' })}
        >
          {familyList.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
              {families.error
                ? t(locale, { ar: 'تعذّر تحميل قائمة المناظرات حاليًا.', fr: 'Impossible de charger la liste des concours pour le moment.' })
                : t(locale, { ar: 'لا توجد مناظرات منشورة بعد.', fr: 'Aucun concours publié pour le moment.' })}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {familyList.slice(0, 9).map((f) => (
                <li key={f.slug}>
                  <Link href={`/diagnostic/${f.slug}`} className="card flex min-h-16 items-center gap-3 p-3 hover:border-primary">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><FieldIcon field={f.field} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-semibold">{loc(locale, f, 'name')}</span>
                      {f.questionCount > 0 && <span className="text-xs text-muted">{countLabel(locale, f.questionCount, 'question')}</span>}
                    </span>
                    <Arrow className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-muted">
            {t(locale, { ar: 'مناظرتك غير موجودة؟', fr: 'Votre concours n’y est pas ?' })}{' '}
            <Link href="/concours" className="font-semibold text-primary hover:underline">{t(locale, { ar: 'كل المناظرات', fr: 'Tous les concours' })}</Link>
            {' · '}
            <Link href="#waitlist" className="font-semibold text-primary hover:underline">{t(locale, { ar: 'أعلمنا بها', fr: 'Signalez-le-nous' })}</Link>
          </p>
        </Section>

        {/* How it works */}
        <Section id="how" title={t(locale, { ar: 'كيف تعمل المنصة', fr: 'Comment ça marche' })}>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HOW.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={i} className="card flex flex-col gap-2 p-4">
                  <span className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-contrast tabular-nums">{i + 1}</span>
                    <Icon className="size-5 text-primary" aria-hidden />
                  </span>
                  <h3 className="font-bold">{t(locale, s.title)}</h3>
                  <p className="text-sm text-muted">{t(locale, s.body)}</p>
                </li>
              );
            })}
          </ol>
        </Section>

        {/* Verification */}
        <Section
          id="verification"
          title={t(locale, { ar: 'كيف نتحقق من المعلومات', fr: 'Comment nous vérifions les informations' })}
          lead={t(locale, {
            ar: 'المعلومات الخاطئة عن مناظرة قد تكلفك سنة. لذلك تحمل كل معلومة (شرط، تاريخ، مرحلة، مادة) شارة تبيّن مصدرها، ولا ننشر شيئًا مولّدًا آليًا دون مراجعة بشرية.',
            fr: 'Une erreur sur un concours peut coûter une année. Chaque information (condition, date, épreuve, matière) porte donc un badge de source, et rien de généré automatiquement n’est publié sans relecture humaine.',
          })}
          action={<Link href="/methodology" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">{t(locale, { ar: 'منهجيتنا بالتفصيل', fr: 'Notre méthodologie' })}<Arrow className="size-4" aria-hidden /></Link>}
        >
          <ProvenanceLegend locale={locale} />
        </Section>

        {/* Pricing teaser */}
        <Section
          id="pricing"
          title={t(locale, { ar: 'ابدأ مجانًا، واشترك عند الحاجة', fr: 'Commencez gratuitement, abonnez-vous si besoin' })}
          action={<Link href="/pricing" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">{t(locale, { ar: 'كل الأسعار', fr: 'Tous les tarifs' })}<Arrow className="size-4" aria-hidden /></Link>}
        >
          <PricingTeaser locale={locale} />
        </Section>

        {/* Waitlist instead of fake testimonials */}
        <Section
          id="waitlist"
          title={t(locale, { ar: 'كن من أوائل المستعملين', fr: 'Soyez parmi les premiers' })}
          lead={t(locale, {
            ar: 'المنصة جديدة ولن نعرض شهادات مختلقة. ساعدنا في بنائها: أخبرنا بمناظرتك وسنعلمك بكل جديد يخصها.',
            fr: 'La plateforme est nouvelle et nous n’afficherons pas de faux témoignages. Aidez-nous à la construire : dites-nous quel concours vous préparez.',
          })}
        >
          <Card className="max-w-3xl">
            <WaitlistForm families={familyList.map((f) => ({ slug: f.slug, name_ar: f.name_ar, name_fr: f.name_fr }))} />
          </Card>
        </Section>

        {/* FAQ */}
        <Section id="faq" title={t(locale, { ar: 'أسئلة متكررة', fr: 'Questions fréquentes' })}>
          <div className="flex max-w-3xl flex-col gap-2">
            {FAQ.map((f, i) => (
              <Disclosure key={i} name="faq" summary={t(locale, f.q)} open={i === 0}>
                <p>{t(locale, f.a)}</p>
              </Disclosure>
            ))}
          </div>
        </Section>

        {/* Final CTA */}
        <section className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-surface p-8 text-center">
          <h2 className="text-2xl font-extrabold">{t(locale, { ar: 'جاهز لتعرف مستواك؟', fr: 'Prêt(e) à connaître votre niveau ?' })}</h2>
          <p className="max-w-lg text-muted">{t(locale, { ar: 'اختبار تشخيصي مجاني ودون تسجيل، ونتيجة واضحة بنقاط قوتك وضعفك.', fr: 'Un test diagnostique gratuit, sans inscription, avec vos points forts et faibles.' })}</p>
          <ButtonLink href="#diagnostic" size="lg" variant="accent">{t(locale, { ar: 'ابدأ الآن', fr: 'Commencer maintenant' })}</ButtonLink>
        </section>
      </Container>
    </>
  );
}

function PricingTeaser({ locale }: { locale: Locale }) {
  const free = PLANS.find((p) => p.code === 'FREE');
  const month = PLANS.find((p) => p.code === 'PREMIUM_MONTH');
  const pass = PLANS.find((p) => p.code === 'EXAM_PASS');
  const items = [free, month, pass].filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((p) => (
        <li key={p.code} className={`card flex flex-col gap-1 p-4 ${p.code === 'EXAM_PASS' ? 'border-primary' : ''}`}>
          <span className="text-sm font-semibold text-muted">{loc(locale, p, 'name')}</span>
          <span className="text-2xl font-extrabold tabular-nums">{p.price_millimes === 0 ? t(locale, { ar: 'مجاني', fr: 'Gratuit' }) : formatTnd(p.price_millimes, locale)}</span>
          <span className="text-xs text-muted">
            {p.code === 'FREE'
              ? t(locale, { ar: 'تشخيص، تنبيهات، 20 سؤالًا يوميًا', fr: 'Diagnostic, alertes, 20 questions/jour' })
              : p.code === 'EXAM_PASS'
                ? t(locale, { ar: 'كل شيء حتى يوم الامتحان', fr: 'Tout, jusqu’au jour de l’examen' })
                : t(locale, { ar: 'تدريب وامتحانات تجريبية دون حد', fr: 'Entraînement et examens blancs illimités' })}
          </span>
        </li>
      ))}
    </ul>
  );
}

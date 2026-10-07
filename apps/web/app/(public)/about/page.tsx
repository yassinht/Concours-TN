import Link from 'next/link';
import type { Metadata } from 'next';
import { BadgeCheck, HeartHandshake, Scale, Target, Wifi } from 'lucide-react';
import { ButtonLink } from '@/components/ui';
import { ContactLine, Container, IndependenceNotice, PageHeader, Prose, Section } from '@/components/public/sections';
import { pageMetadata } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { t, type Bi } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata(locale, {
    title: { ar: 'من نحن', fr: 'À propos' },
    description: {
      ar: 'Concours TN منصة تونسية مستقلة تساعد المترشحين على فهم المناظرات العمومية والتحضير لها بمعلومات موثقة وتدريب منظم.',
      fr: 'Concours TN est une plateforme tunisienne indépendante qui aide les candidats à comprendre et préparer les concours publics avec des informations sourcées et un entraînement structuré.',
    },
    path: '/about',
  });
}

const PRINCIPLES: { icon: typeof Target; title: Bi; body: Bi }[] = [
  { icon: BadgeCheck, title: { ar: 'الدقة قبل كل شيء', fr: 'L’exactitude d’abord' }, body: { ar: 'معلومة موثقة بمصدرها أهم من أي ميزة. ما لم نتحقق منه نقول إنه «للتحقق».', fr: 'Une information sourcée vaut plus que toute fonctionnalité. Ce qui n’est pas vérifié est marqué « À vérifier ».' } },
  { icon: Target, title: { ar: 'نتائج المترشحين', fr: 'Les résultats des candidats' }, body: { ar: 'نقيس نجاحنا بتقدّم المترشحين، لا بعدد النقرات أو الدقائق التي يقضونها في التطبيق.', fr: 'Notre succès se mesure aux progrès des candidats, pas aux clics ni au temps passé dans l’app.' } },
  { icon: Wifi, title: { ar: 'في متناول الجميع', fr: 'Accessible à tous' }, body: { ar: 'يعمل على الهواتف البسيطة ومع اتصال ضعيف، بالعربية والفرنسية، والأساسيات مجانية.', fr: 'Fonctionne sur des téléphones modestes et avec une connexion faible, en arabe et en français ; l’essentiel est gratuit.' } },
  { icon: Scale, title: { ar: 'الصدق في البيع', fr: 'Une vente honnête' }, body: { ar: 'لا وعود بالنجاح، لا «أسئلة مسربة»، لا تجديد تلقائي خفي، ولا شهادات مختلقة.', fr: 'Pas de promesse de réussite, pas de « fuites », pas de renouvellement caché, pas de faux témoignages.' } },
];

export default async function AboutPage() {
  const locale = await getLocale();
  return (
    <>
      <PageHeader
        title={t(locale, { ar: 'من نحن', fr: 'À propos' })}
        lead={t(locale, {
          ar: 'كل سنة يترشح آلاف التونسيين للمناظرات العمومية دون أن يعرفوا بدقة ماذا سيُسألون أو كيف يستعدون. Concours TN وُلدت لسد هذه الفجوة.',
          fr: 'Chaque année, des milliers de Tunisiens passent des concours publics sans savoir précisément ce qui sera demandé ni comment se préparer. Concours TN est né pour combler ce manque.',
        })}
      />
      <Container className="flex flex-col gap-12 py-8">
        <Prose>
          <h2>{t(locale, { ar: 'المشكلة', fr: 'Le problème' })}</h2>
          <p>{t(locale, {
            ar: 'المعلومات عن المناظرات مشتتة: بلاغات PDF، منشورات على مواقع التواصل، مواقع إعلانات، وتجارب متناقضة. البرامج نادرًا ما تُنشر بالتفصيل، والكتب والدروس الخصوصية مكلفة. النتيجة: مترشحون يضيعون الوقت في مراجعة ما لا يُسأل، أو يفوّتون آخر أجل.',
            fr: 'Les informations sur les concours sont éparpillées : avis en PDF, publications sur les réseaux sociaux, sites d’annonces, témoignages contradictoires. Les programmes détaillés sont rarement publiés, livres et cours particuliers coûtent cher. Résultat : des candidats révisent ce qui ne tombe pas, ou ratent la date limite.',
          })}</p>
          <h2>{t(locale, { ar: 'ما نقوم به', fr: 'Ce que nous faisons' })}</h2>
          <ul>
            <li>{t(locale, { ar: 'صفحة واضحة لكل مناظرة: الشروط، المراحل، المواد، الوثائق والمواعيد، مع مصدر كل معلومة.', fr: 'Une page claire par concours : conditions, épreuves, matières, pièces et dates, avec la source de chaque information.' })}</li>
            <li>{t(locale, { ar: 'تنبيهات عند فتح مناظرة تستوفي شروطها، وتذكير قبل آخر أجل.', fr: 'Des alertes quand un concours vous correspond, et un rappel avant la clôture.' })}</li>
            <li>{t(locale, { ar: 'اختبار تشخيصي، تدريب يتكيف مع مستواك، امتحانات تجريبية ومؤشر جاهزية صريح بحدوده.', fr: 'Un diagnostic, un entraînement adapté à votre niveau, des examens blancs et un indicateur de préparation honnête sur ses limites.' })}</li>
          </ul>
        </Prose>

        <Section id="principles" title={t(locale, { ar: 'مبادئنا', fr: 'Nos principes' })}>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PRINCIPLES.map((p, i) => {
              const Icon = p.icon;
              return (
                <li key={i} className="card flex gap-3 p-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="size-5" aria-hidden /></span>
                  <span>
                    <span className="block font-bold">{t(locale, p.title)}</span>
                    <span className="text-sm text-muted">{t(locale, p.body)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>

        <IndependenceNotice locale={locale} />

        <section className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold"><HeartHandshake className="size-5 text-accent" aria-hidden />{t(locale, { ar: 'ساعدنا على التحسن', fr: 'Aidez-nous à progresser' })}</h2>
          <p className="text-sm text-muted">{t(locale, {
            ar: 'المنصة في بدايتها. أخبرنا بمناظرتك، أبلغ عن أي خطأ، وشارك البلاغات الرسمية التي تجدها: كل مساهمة تفيد آلاف المترشحين.',
            fr: 'La plateforme débute. Dites-nous quel concours vous préparez, signalez les erreurs et partagez les avis officiels trouvés : chaque contribution aide des milliers de candidats.',
          })}</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/#waitlist">{t(locale, { ar: 'كن من الأوائل', fr: 'Rejoindre les premiers' })}</ButtonLink>
            <ButtonLink href="/methodology#corrections" variant="secondary">{t(locale, { ar: 'أبلغ عن خطأ', fr: 'Signaler une erreur' })}</ButtonLink>
          </div>
          <Prose><ContactLine locale={locale} /></Prose>
          <p className="text-xs text-muted"><Link href="/legal/terms" className="underline">{t(locale, { ar: 'شروط الاستعمال', fr: 'Conditions d’utilisation' })}</Link> · <Link href="/legal/privacy" className="underline">{t(locale, { ar: 'سياسة الخصوصية', fr: 'Confidentialité' })}</Link></p>
        </section>
      </Container>
    </>
  );
}

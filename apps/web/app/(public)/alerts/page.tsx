import Link from 'next/link';
import type { Metadata } from 'next';
import { BellRing, CalendarClock, ShieldCheck, UserCheck } from 'lucide-react';
import { AlertsSetup } from '@/components/public/alerts-setup';
import { Container, PageHeader, Section } from '@/components/public/sections';
import { pageMetadata } from '@/components/public/server-data';
import { TrackEvent } from '@/components/public/track';
import { getLocale } from '@/lib/i18n-server';
import { t, type Bi } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata(locale, {
    title: { ar: 'تنبيهات المناظرات المناسبة لملفك', fr: 'Alertes des concours qui vous correspondent' },
    description: {
      ar: 'أدخل سنك وشهادتك واختصاصك مرة واحدة: نعلمك عند نشر مناظرة عمومية تستوفي شروطها، ونذكّرك قبل آخر أجل للترشح. مجاني.',
      fr: 'Indiquez une fois votre âge, diplôme et spécialité : nous vous alertons dès qu’un concours public vous correspond, et vous rappelons la date limite. Gratuit.',
    },
    path: '/alerts',
  });
}

const STEPS: { icon: typeof UserCheck; title: Bi; body: Bi }[] = [
  { icon: UserCheck, title: { ar: 'ملفك مرة واحدة', fr: 'Votre profil, une fois' }, body: { ar: 'السن، الشهادة، الاختصاص، وعند الحاجة الطول والحالة المدنية.', fr: 'Âge, diplôme, spécialité et, si besoin, taille et situation familiale.' } },
  { icon: BellRing, title: { ar: 'تنبيه عند المطابقة', fr: 'Alerte en cas de correspondance' }, body: { ar: 'عند نشر دورة جديدة نقارن شروطها بملفك ونعلمك إن كنت تستوفيها.', fr: 'À chaque nouvelle session, nous comparons ses conditions à votre profil et vous prévenons si vous êtes éligible.' } },
  { icon: CalendarClock, title: { ar: 'تذكير قبل آخر أجل', fr: 'Rappel avant la clôture' }, body: { ar: 'قبل 7 أيام، ثم قبل يومين، ثم يوم آخر أجل، للمناظرات التي تتابعها.', fr: '7 jours, 2 jours puis le jour de la clôture, pour les concours suivis.' } },
];

export default async function AlertsPage() {
  const locale = await getLocale();
  return (
    <>
      <TrackEvent name="alerts_view" />
      <PageHeader
        title={t(locale, { ar: 'نبّهني بالمناظرات المناسبة لي', fr: 'Alertez-moi des concours qui me correspondent' })}
        lead={t(locale, {
          ar: 'لا تفوّت مناظرة لأنك لم ترَ البلاغ في الوقت المناسب. أدخل معطياتك، اطّلع على المناظرات التي تستوفي شروطها، وفعّل التنبيهات مجانًا.',
          fr: 'Ne ratez plus un concours faute d’avoir vu l’avis à temps. Renseignez votre profil, voyez les concours auxquels vous êtes éligible et activez les alertes gratuitement.',
        })}
      />
      <Container className="flex flex-col gap-10 py-6">
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={i} className="card flex gap-3 p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="size-5" aria-hidden /></span>
                <span>
                  <span className="block font-bold">{t(locale, s.title)}</span>
                  <span className="text-sm text-muted">{t(locale, s.body)}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <AlertsSetup />

        <Section id="trust" title={t(locale, { ar: 'تنبيهات موثوقة، دون إزعاج', fr: 'Des alertes fiables, sans spam' })}>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <li className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              {t(locale, {
                ar: 'لا نرسل تنبيهًا عن دورة قبل أن يراجعها إنسان في فريقنا. التواريخ غير المؤكدة تُرسل مع عبارة «للتحقق».',
                fr: 'Aucune alerte n’est envoyée avant qu’un membre de l’équipe ait relu la session. Les dates non confirmées portent la mention « À vérifier ».',
              })}
            </li>
            <li className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
              <BellRing className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              {t(locale, {
                ar: 'تنبيه واحد لكل دورة مطابقة، وتذكيرات آخر أجل فقط للمناظرات التي تتابعها. يمكنك الإيقاف بنقرة.',
                fr: 'Une seule alerte par session correspondante, et des rappels de clôture uniquement pour les concours suivis. Désactivation en un clic.',
              })}
            </li>
            <li className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-sm sm:col-span-2">
              <UserCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span>
                {t(locale, {
                  ar: 'معطياتك تُستعمل فقط لمطابقة الشروط ولا تُشارك مع أي طرف. يمكنك تصديرها أو حذفها في أي وقت.',
                  fr: 'Vos données servent uniquement à vérifier les conditions et ne sont partagées avec personne. Vous pouvez les exporter ou les supprimer à tout moment.',
                })}{' '}
                <Link href="/legal/privacy" className="font-semibold underline">{t(locale, { ar: 'سياسة الخصوصية', fr: 'Confidentialité' })}</Link>
              </span>
            </li>
          </ul>
        </Section>
      </Container>
    </>
  );
}

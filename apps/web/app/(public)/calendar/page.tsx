import type { Metadata } from 'next';
import type { EditionDTO } from '@ctn/shared';
import { Alert } from '@/components/ui';
import { CalendarView } from '@/components/public/calendar-view';
import { asField } from '@/components/public/labels';
import { Container, IndependenceNotice, PageHeader } from '@/components/public/sections';
import { load, pageMetadata } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type SearchParams = Promise<{ field?: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata(locale, {
    title: { ar: 'رزنامة المناظرات العمومية', fr: 'Calendrier des concours publics' },
    description: {
      ar: 'مواعيد فتح باب الترشح وآخر أجل والاختبارات للمناظرات العمومية في تونس، شهرًا بشهر، مع عدّ تنازلي وتنبيهات.',
      fr: 'Ouvertures, dates limites et épreuves des concours publics en Tunisie, mois par mois, avec compte à rebours et alertes.',
    },
    path: '/calendar',
  });
}

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const locale = await getLocale();
  const field = asField((await searchParams).field);
  const editions = await load<EditionDTO[]>('/catalog/editions');
  const list = editions.data ?? [];

  return (
    <>
      <PageHeader
        title={t(locale, { ar: 'رزنامة المناظرات', fr: 'Calendrier des concours' })}
        lead={t(locale, {
          ar: 'المناظرات المفتوحة والقادمة خلال الأشهر المقبلة، مرتبة حسب أقرب موعد: فتح الترشح، آخر أجل أو الاختبارات.',
          fr: 'Concours ouverts et à venir dans les prochains mois, classés par date la plus proche : ouverture, clôture ou épreuves.',
        })}
      />
      <Container className="flex flex-col gap-6 py-6">
        {editions.error ? (
          <Alert tone="danger" title={t(locale, { ar: 'تعذّر تحميل الرزنامة', fr: 'Impossible de charger le calendrier' })}>
            {t(locale, { ar: 'أعد تحميل الصفحة بعد لحظات.', fr: 'Rechargez la page dans un instant.' })}
          </Alert>
        ) : (
          <CalendarView editions={list} initialField={field} />
        )}
        <IndependenceNotice locale={locale} />
      </Container>
    </>
  );
}

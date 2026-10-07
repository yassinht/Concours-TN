import Link from 'next/link';
import type { Metadata } from 'next';
import { Bell } from 'lucide-react';
import type { FamilySummaryDTO } from '@ctn/shared';
import { FamilyCatalog } from '@/components/public/family-catalog';
import { FIELD_LABELS, asField } from '@/components/public/labels';
import { Container, IndependenceNotice, JsonLd, PageHeader } from '@/components/public/sections';
import { absoluteUrl, load, pageMetadata } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type SearchParams = Promise<{ field?: string; q?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const locale = await getLocale();
  const field = asField((await searchParams).field);
  const fieldLabel = field ? FIELD_LABELS[field] : null;
  return pageMetadata(locale, {
    title: fieldLabel
      ? { ar: `مناظرات ${fieldLabel.ar}`, fr: `Concours ${fieldLabel.fr}` }
      : { ar: 'المناظرات العمومية في تونس', fr: 'Concours publics en Tunisie' },
    description: {
      ar: 'كل المناظرات العمومية في تونس: الأمن، الديوانة، التعليم، الصحة، البنوك والمؤسسات العمومية. الحالة، آخر أجل للترشح، الشروط والمراحل مع مصادرها.',
      fr: 'Tous les concours publics en Tunisie : sécurité, douane, éducation, santé, banques et entreprises publiques. Statut, date limite, conditions et épreuves avec leurs sources.',
    },
    path: field ? `/concours?field=${field}` : '/concours',
  });
}

export default async function ConcoursPage({ searchParams }: { searchParams: SearchParams }) {
  const locale = await getLocale();
  const sp = await searchParams;
  const field = asField(sp.field);
  const q = (sp.q ?? '').slice(0, 100);
  const query = new URLSearchParams();
  if (field) query.set('field', field);
  if (q.trim()) query.set('q', q.trim());
  const qs = query.toString();
  const families = await load<FamilySummaryDTO[]>(`/catalog/families${qs ? `?${qs}` : ''}`);

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: (families.data ?? []).slice(0, 30).map((f, i) => ({ '@type': 'ListItem', position: i + 1, url: absoluteUrl(`/concours/${f.slug}`), name: locale === 'fr' ? f.name_fr : f.name_ar })),
        }}
      />
      <PageHeader
        title={t(locale, { ar: 'المناظرات', fr: 'Les concours' })}
        lead={t(locale, {
          ar: 'ابحث عن مناظرتك واطّلع على حالتها وشروطها ومراحلها وبرنامجها. المناظرات المفتوحة تظهر أولًا.',
          fr: 'Trouvez votre concours : statut, conditions, épreuves et programme. Les concours ouverts apparaissent en premier.',
        })}
      >
        <Link href="/alerts" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <Bell className="size-4" aria-hidden />
          {t(locale, { ar: 'لا تعرف أي مناظرة تناسبك؟ اكتشف المناظرات المطابقة لملفك', fr: 'Vous hésitez ? Découvrez les concours qui correspondent à votre profil' })}
        </Link>
      </PageHeader>
      <Container className="flex flex-col gap-6 py-6">
        <FamilyCatalog initial={families.data ?? []} initialField={field} initialQ={q} initialError={families.error} />
        <IndependenceNotice locale={locale} />
      </Container>
    </>
  );
}

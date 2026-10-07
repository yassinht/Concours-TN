import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { FamilyDetailDTO } from '@ctn/shared';
import { EligibilityChecker } from '@/components/public/eligibility-checker';
import { loc } from '@/components/public/labels';
import { Breadcrumbs, Container, IndependenceNotice, PageHeader } from '@/components/public/sections';
import { load, pageMetadata } from '@/components/public/server-data';
import { TrackEvent } from '@/components/public/track';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Params = Promise<{ slug: string }>;
const familyPath = (slug: string) => `/catalog/families/${encodeURIComponent(slug)}`;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const fam = await load<FamilyDetailDTO>(familyPath(slug));
  const f = fam.data;
  return pageMetadata(locale, {
    title: f
      ? { ar: `هل تستوفي شروط ${f.name_ar}؟`, fr: `Êtes-vous éligible : ${f.name_fr} ?` }
      : { ar: 'التحقق من الأهلية', fr: 'Vérifier son éligibilité' },
    description: {
      ar: 'تحقق في أقل من دقيقة من شروط السن والشهادة والطول والحالة المدنية لكل رتبة، مع مصدر كل شرط.',
      fr: 'Vérifiez en moins d’une minute les conditions d’âge, de diplôme, de taille et de situation familiale de chaque grade, avec la source de chaque condition.',
    },
    path: `/concours/${slug}/eligibility`,
    noIndex: !f,
  });
}

export default async function EligibilityPage({ params }: { params: Params }) {
  const { slug } = await params;
  const locale = await getLocale();
  const fam = await load<FamilyDetailDTO>(familyPath(slug));
  if (fam.error) throw new Error('CATALOG_UNAVAILABLE');
  if (!fam.data) notFound();
  const f = fam.data;
  const name = loc(locale, f, 'name');
  const specialties = [...new Set(f.positions.flatMap((p) => p.eligibility.specialties ?? []))].slice(0, 40);

  return (
    <>
      <TrackEvent name="eligibility_view" props={{ familySlug: f.slug }} />
      <PageHeader
        eyebrow={
          <Breadcrumbs
            locale={locale}
            items={[
              { href: '/concours', label: t(locale, { ar: 'المناظرات', fr: 'Concours' }) },
              { href: `/concours/${f.slug}`, label: name },
              { label: t(locale, { ar: 'الأهلية', fr: 'Éligibilité' }) },
            ]}
          />
        }
        title={t(locale, { ar: 'هل تستوفي الشروط؟', fr: 'Remplissez-vous les conditions ?' })}
        lead={t(locale, {
          ar: `أجب عن بضعة أسئلة لنقارن ملفك بشروط ${f.name_ar} المعلنة، رتبةً برتبة.`,
          fr: `Répondez à quelques questions pour comparer votre profil aux conditions annoncées de « ${f.name_fr} », grade par grade.`,
        })}
      />
      <Container className="flex flex-col gap-6 py-6">
        <EligibilityChecker
          familySlug={f.slug}
          positions={f.positions.map((p) => ({ slug: p.slug, title_ar: p.title_ar, title_fr: p.title_fr }))}
          specialtySuggestions={specialties}
        />
        <IndependenceNotice locale={locale} orgWebsite={f.organization.website} />
      </Container>
    </>
  );
}

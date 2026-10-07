import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { Domain, FamilyDetailDTO } from '@ctn/shared';
import { DiagnosticStart, type DiagnosticFamily } from '@/components/learn/views/diagnostic-start';
import { load, pageMetadata } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Params = Promise<{ slug: string }>;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/i;

async function family(slug: string) {
  if (!SLUG.test(slug)) return { data: null, error: false };
  return load<FamilyDetailDTO>(`/catalog/families/${encodeURIComponent(slug)}`, 300);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const f = (await family(slug)).data;
  const name = f ? { ar: f.name_ar, fr: f.name_fr } : { ar: 'مناظرة', fr: 'concours' };
  return pageMetadata(locale, {
    title: { ar: `اختبار تشخيصي مجاني — ${name.ar}`, fr: `Test diagnostique gratuit — ${name.fr}` },
    description: {
      ar: `24 سؤالًا في 15 إلى 20 دقيقة لتعرف مستواك في كل مادة من مواد ${name.ar}، دون تسجيل.`,
      fr: `24 questions en 15 à 20 minutes pour connaître votre niveau dans chaque matière du concours ${name.fr}, sans inscription.`,
    },
    path: `/diagnostic/${slug}`,
  });
}

export default async function DiagnosticPage({ params }: { params: Params }) {
  const { slug } = await params;
  const locale = await getLocale();
  const res = await family(slug);
  if (!res.data && !res.error) notFound();
  if (!res.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold">{t(locale, { ar: 'تعذّر تحميل المناظرة', fr: 'Impossible de charger le concours' })}</h1>
        <p className="mt-2 text-muted">{t(locale, { ar: 'حاول مجددًا بعد قليل.', fr: 'Réessayez dans un instant.' })}</p>
      </div>
    );
  }
  const f = res.data;
  const domains = new Set<Domain>();
  for (const p of f.positions) for (const s of p.blueprint?.sections ?? []) domains.add(s.domain);
  if (!domains.size) for (const n of f.syllabus) domains.add(n.domain);
  const data: DiagnosticFamily = {
    slug: f.slug,
    name_ar: f.name_ar,
    name_fr: f.name_fr,
    organization_ar: f.organization.name_ar,
    organization_fr: f.organization.name_fr,
    questionCount: f.questionCount,
    domains: [...domains],
    positions: f.positions.map((p) => ({ slug: p.slug, title_ar: p.title_ar, title_fr: p.title_fr, fidelity: p.blueprint?.fidelity ?? null })),
  };
  return <DiagnosticStart family={data} />;
}

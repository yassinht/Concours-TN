import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { FamilyDetailDTO } from '@ctn/shared';
import { SyllabusScreen } from '@/components/learn/views/syllabus-screen';
import { load } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Params = Promise<{ slug: string }>;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const f = SLUG.test(slug) ? (await load<FamilyDetailDTO>(`/catalog/families/${encodeURIComponent(slug)}`, 300)).data : null;
  const base = t(locale, { ar: 'البرنامج', fr: 'Programme' });
  return { title: f ? `${base} — ${t(locale, { ar: f.name_ar, fr: f.name_fr })}` : base };
}

export default async function SyllabusPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const f = await load<FamilyDetailDTO>(`/catalog/families/${encodeURIComponent(slug)}`, 300);
  return <SyllabusScreen slug={slug} familyName={f.data ? { ar: f.data.name_ar, fr: f.data.name_fr } : null} />;
}

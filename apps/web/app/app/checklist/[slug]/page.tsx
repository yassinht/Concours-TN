import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { FamilyDetailDTO } from '@ctn/shared';
import { ChecklistScreen } from '@/components/learn/views/checklist-screen';
import { load } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Params = Promise<{ slug: string }>;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'ملف الترشح', fr: 'Mon dossier' }) };
}

export default async function ChecklistPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const f = await load<FamilyDetailDTO>(`/catalog/families/${encodeURIComponent(slug)}`, 300);
  return <ChecklistScreen slug={slug} familyName={f.data ? { ar: f.data.name_ar, fr: f.data.name_fr } : null} />;
}

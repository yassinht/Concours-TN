import type { Metadata } from 'next';
import { ResultsScreen } from '@/components/learn/views/results-screen';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'النتيجة', fr: 'Résultat' }) };
}

export default async function ResultsPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const family = Array.isArray(sp.family) ? sp.family[0] : sp.family;
  return <ResultsScreen id={id} familyHint={family && SLUG.test(family) ? family : undefined} />;
}

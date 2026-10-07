import type { Metadata } from 'next';
import { MistakesScreen } from '@/components/learn/views/mistakes-screen';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'دفتر الأخطاء', fr: 'Carnet d’erreurs' }) };
}

export default async function MistakesPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  return <MistakesScreen initialTab={tab === 'bookmarks' ? 'bookmarks' : 'mistakes'} />;
}

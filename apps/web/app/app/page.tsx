import type { Metadata } from 'next';
import { HomeView } from '@/components/app/views/home-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'فضائي', fr: 'Mon espace' }) };
}

export default async function AppHome({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const v = Array.isArray(sp.emailVerified) ? sp.emailVerified[0] : sp.emailVerified;
  return <HomeView emailVerified={v === '1' || v === '0' ? v : undefined} />;
}

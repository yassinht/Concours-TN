import type { Metadata } from 'next';
import { OnboardingView } from '@/components/app/views/onboarding-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'ابدأ تحضيرك', fr: 'Commencer ma préparation' }) };
}

export default async function OnboardingPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const family = one(sp.family);
  const position = one(sp.position);
  return (
    <OnboardingView
      initialFamily={family && SLUG.test(family) ? family : undefined}
      initialPosition={family && position && SLUG.test(position) ? position : undefined}
    />
  );
}

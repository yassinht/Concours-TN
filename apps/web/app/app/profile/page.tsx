import type { Metadata } from 'next';
import { ProfileView } from '@/components/app/views/profile-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'حسابي', fr: 'Mon compte' }) };
}

export default async function ProfilePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const v = Array.isArray(sp.emailUnsubscribed) ? sp.emailUnsubscribed[0] : sp.emailUnsubscribed;
  return <ProfileView emailUnsubscribed={v === '1' || v === '0' ? v : undefined} />;
}

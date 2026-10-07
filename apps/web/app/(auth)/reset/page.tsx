import type { Metadata } from 'next';
import { ResetForm } from '@/components/app/auth/password-forms';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: t(locale, { ar: 'كلمة مرور جديدة', fr: 'Nouveau mot de passe' }), referrer: 'no-referrer' };
}

export default async function ResetPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return <ResetForm token={one(sp.token)?.slice(0, 500)} />;
}

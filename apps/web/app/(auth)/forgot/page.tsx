import type { Metadata } from 'next';
import { ForgotForm } from '@/components/app/auth/password-forms';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: t(locale, { ar: 'نسيت كلمة المرور', fr: 'Mot de passe oublié' }) };
}

export default async function ForgotPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return <ForgotForm initialEmail={one(sp.email)?.slice(0, 200)} />;
}

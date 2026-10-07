import type { Metadata } from 'next';
import { RegisterForm } from '@/components/app/auth/register-form';
import { safeNext } from '@/components/app/format';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: t(locale, { ar: 'إنشاء حساب', fr: 'Créer un compte' }) };
}

export default async function RegisterPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return <RegisterForm next={safeNext(one(sp.next))} refCode={one(sp.ref)?.slice(0, 40)} />;
}

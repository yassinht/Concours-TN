import type { Metadata } from 'next';
import { LoginForm } from '@/components/app/auth/login-form';
import { safeNext } from '@/components/app/format';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: t(locale, { ar: 'تسجيل الدخول', fr: 'Connexion' }) };
}

export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return <LoginForm next={safeNext(one(sp.next))} queryError={one(sp.error)} />;
}

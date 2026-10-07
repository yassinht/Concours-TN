import type { Metadata } from 'next';
import { SessionScreen } from '@/components/learn/views/session-screen';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Params = Promise<{ id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'جلسة تدريب', fr: 'Session d’entraînement' }) };
}

export default async function SessionPage({ params }: { params: Params }) {
  const { id } = await params;
  return <SessionScreen id={id} />;
}

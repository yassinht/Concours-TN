import type { Metadata } from 'next';
import { PracticeScreen } from '@/components/learn/views/practice-screen';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'تدرّب', fr: 'S’entraîner' }) };
}

export default function PracticePage() {
  return <PracticeScreen />;
}

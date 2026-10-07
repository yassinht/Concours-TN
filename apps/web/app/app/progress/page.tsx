import type { Metadata } from 'next';
import { ProgressScreen } from '@/components/learn/views/progress-screen';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'تقدمي', fr: 'Ma progression' }) };
}

export default function ProgressPage() {
  return <ProgressScreen />;
}

import type { Metadata } from 'next';
import { MockScreen } from '@/components/learn/views/mock-screen';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'الامتحانات التجريبية', fr: 'Examens blancs' }) };
}

export default function MockPage() {
  return <MockScreen />;
}

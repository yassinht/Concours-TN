import type { Metadata } from 'next';
import { AlertsView } from '@/components/app/views/alerts-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'مناظرات تناسبني', fr: 'Concours pour moi' }) };
}

export default function AlertsPage() {
  return <AlertsView />;
}

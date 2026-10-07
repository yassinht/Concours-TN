import type { Metadata } from 'next';
import { OfflineView } from '@/components/app/views/offline-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'التحضير دون اتصال', fr: 'Révision hors ligne' }) };
}

export default function OfflinePage() {
  return <OfflineView />;
}

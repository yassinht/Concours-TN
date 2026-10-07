import type { Metadata } from 'next';
import { NotificationsView } from '@/components/app/views/notifications-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'الإشعارات', fr: 'Notifications' }) };
}

export default function NotificationsPage() {
  return <NotificationsView />;
}

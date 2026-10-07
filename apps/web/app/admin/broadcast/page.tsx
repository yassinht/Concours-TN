import type { Metadata } from 'next';
import { BroadcastView } from '@/components/admin/broadcast';

export const metadata: Metadata = { title: 'Notifications' };

export default function AdminBroadcastPage() {
  return <BroadcastView />;
}

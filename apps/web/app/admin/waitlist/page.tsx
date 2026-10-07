import type { Metadata } from 'next';
import { WaitlistView } from '@/components/admin/waitlist';

export const metadata: Metadata = { title: 'Waitlist' };

export default function AdminWaitlistPage() {
  return <WaitlistView />;
}

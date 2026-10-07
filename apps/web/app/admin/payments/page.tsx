import type { Metadata } from 'next';
import { PaymentsView } from '@/components/admin/payments';

export const metadata: Metadata = { title: 'Paiements' };

export default function AdminPaymentsPage() {
  return <PaymentsView />;
}

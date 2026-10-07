import type { Metadata } from 'next';
import { ConcoursListView } from '@/components/admin/concours';

export const metadata: Metadata = { title: 'Concours' };

export default function AdminConcoursPage() {
  return <ConcoursListView />;
}

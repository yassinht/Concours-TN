import type { Metadata } from 'next';
import { SourcesView } from '@/components/admin/sources';

export const metadata: Metadata = { title: 'Sources & documents' };

export default function AdminSourcesPage() {
  return <SourcesView />;
}

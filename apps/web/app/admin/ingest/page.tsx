import type { Metadata } from 'next';
import { IngestView } from '@/components/admin/ingest';

export const metadata: Metadata = { title: 'Veille' };

export default function AdminIngestPage() {
  return <IngestView />;
}

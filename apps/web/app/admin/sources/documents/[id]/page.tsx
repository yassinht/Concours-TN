import type { Metadata } from 'next';
import { DocumentViewerView } from '@/components/admin/document-viewer';

export const metadata: Metadata = { title: 'Document' };

export default async function AdminDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentViewerView id={id} />;
}

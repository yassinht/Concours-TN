import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConcoursDetailView } from '@/components/admin/concours';

export const metadata: Metadata = { title: 'Concours' };

export default async function AdminConcoursDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <ConcoursDetailView slug={slug} />
    </Suspense>
  );
}

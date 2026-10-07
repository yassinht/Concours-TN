import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FactsView } from '@/components/admin/facts';

export const metadata: Metadata = { title: 'Faits à vérifier' };

export default function AdminFactsPage() {
  return (
    <Suspense>
      <FactsView />
    </Suspense>
  );
}

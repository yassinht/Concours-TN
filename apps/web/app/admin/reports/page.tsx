import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsView } from '@/components/admin/reports';

export const metadata: Metadata = { title: 'Signalements' };

export default function AdminReportsPage() {
  return (
    <Suspense>
      <ReportsView />
    </Suspense>
  );
}

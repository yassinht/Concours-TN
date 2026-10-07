import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReviewView } from '@/components/admin/review';

export const metadata: Metadata = { title: 'Revue' };

export default function AdminReviewPage() {
  return (
    <Suspense>
      <ReviewView />
    </Suspense>
  );
}

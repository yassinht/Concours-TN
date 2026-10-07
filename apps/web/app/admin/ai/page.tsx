import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AiView } from '@/components/admin/ai';

export const metadata: Metadata = { title: 'IA' };

export default function AdminAiPage() {
  return (
    <Suspense>
      <AiView />
    </Suspense>
  );
}

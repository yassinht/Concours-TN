import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QuestionsListView } from '@/components/admin/questions-list';

export const metadata: Metadata = { title: 'Questions' };

export default function AdminQuestionsPage() {
  return (
    <Suspense>
      <QuestionsListView />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QuestionEditorView } from '@/components/admin/question-editor';

export const metadata: Metadata = { title: 'Modifier la question' };

export default async function AdminQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <QuestionEditorView id={id} />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QuestionEditorView } from '@/components/admin/question-editor';

export const metadata: Metadata = { title: 'Nouvelle question' };

export default function AdminNewQuestionPage() {
  return (
    <Suspense>
      <QuestionEditorView id={null} />
    </Suspense>
  );
}

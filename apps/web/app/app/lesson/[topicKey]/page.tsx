import type { Metadata } from 'next';
import { LessonScreen } from '@/components/learn/views/lesson-screen';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Params = Promise<{ topicKey: string }>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'درس', fr: 'Leçon' }) };
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export default async function LessonPage({ params }: { params: Params }) {
  const { topicKey } = await params;
  return <LessonScreen topicKey={safeDecode(topicKey).slice(0, 200)} />;
}

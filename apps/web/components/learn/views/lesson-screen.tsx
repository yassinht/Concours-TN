'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Clock, Dumbbell, Pause, Target, TriangleAlert, Volume2 } from 'lucide-react';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, Card, EmptyState, Tabs } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { ErrorState, PageHeader, SectionTitle, Skeleton } from '@/components/app/bits';
import { bi } from '@/components/app/format';
import { errorCode } from '@/components/app/use-api';
import { MasteryMeter } from '../charts';
import { useEnrollments, useSessionApi, useStartAttempt } from '../hooks';
import { biCount, SCOPE_TEXT } from '../labels';
import { Markdown } from '../markdown';
import { PaywallModal } from '../paywall';
import type { LessonsResponse } from '../types';

/** Plain text of a Markdown lesson for speech (symbols would be read aloud otherwise). */
function speakable(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`|]/g, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/-{3,}/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Read the lesson aloud with the browser's speech synthesis (useful on the bus, for tired eyes, for low literacy in French). */
function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);
  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);
  const speak = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const arabic = (text.match(/[؀-ۿ]/g)?.length ?? 0) > text.length * 0.3;
    const lang = arabic ? 'ar' : 'fr-FR';
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(arabic ? 'ar' : 'fr'));
    // Short chunks: some engines stop reading long utterances after ~15 s.
    const chunks = text.split(/(?<=[.!؟?،:\n])\s+/).reduce<string[]>((acc, s) => {
      const last = acc[acc.length - 1];
      if (last && last.length + s.length < 220) acc[acc.length - 1] = `${last} ${s}`;
      else acc.push(s);
      return acc;
    }, []);
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice;
      u.rate = 0.95;
      if (i === chunks.length - 1) u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      synth.speak(u);
    });
    setSpeaking(true);
  }, []);
  return { supported, speaking, speak, stop };
}

export function LessonScreen({ topicKey }: { topicKey: string }) {
  const tr = useT();
  const { locale } = useLocale();
  const data = useSessionApi<LessonsResponse>(`/catalog/lessons/${encodeURIComponent(topicKey)}?lang=${locale}`);
  const enr = useEnrollments();
  const start = useStartAttempt('lesson');
  const speech = useSpeech();
  const [tab, setTab] = useState<string | null>(null);
  const familySlug = enr.primary?.familySlug;

  if (data.error) {
    return errorCode(data.error) === 'NOT_FOUND' ? (
      <EmptyState icon={<BookOpen className="size-8" aria-hidden />} title={tr({ ar: 'هذا المحور غير موجود', fr: 'Thème introuvable' })} action={<Link href="/app/practice" className="font-semibold text-primary underline">{tr({ ar: 'العودة إلى التدرب', fr: 'Retour à l’entraînement' })}</Link>} />
    ) : <ErrorState error={data.error} onRetry={() => void data.reload()} />;
  }
  if (!data.data) {
    return <div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-80" /></div>;
  }

  const { topic, lessons } = data.data;
  const lesson = lessons.find((l) => l.id === tab) ?? lessons[0] ?? null;
  const practise = () => void start.start({ kind: 'PRACTICE', topicKey: topic.key, count: 5, ...(familySlug ? { familySlug } : {}) }, 'consolidate');
  const canPractise = topic.questionCount > 0 || (topic.children ?? []).some((c) => c.questionCount > 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={familySlug ? `/app/syllabus/${encodeURIComponent(familySlug)}` : '/app/practice'}
        title={bi(locale, topic.title_ar, topic.title_fr)}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Badge tone="primary">{tr(DOMAIN_LABELS[topic.domain])}</Badge>
            <Badge tone={SCOPE_TEXT[topic.scope].tone}>{tr(SCOPE_TEXT[topic.scope])}</Badge>
          </span>
        }
      />

      {topic.mastery !== undefined && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{tr({ ar: 'تمكّنك من هذا المحور', fr: 'Votre maîtrise de ce thème' })}</span>
          <MasteryMeter mastery={topic.mastery} />
        </div>
      )}

      {topic.objectives.length > 0 && (
        <Card as="section" className="flex flex-col gap-2">
          <SectionTitle><span className="inline-flex items-center gap-2"><Target className="size-5 text-primary" aria-hidden />{tr({ ar: 'أهداف المحور', fr: 'Objectifs' })}</span></SectionTitle>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
            {topic.objectives.map((o) => <li key={o.key}>{bi(locale, o.text_ar, o.text_fr)}</li>)}
          </ul>
        </Card>
      )}

      {lesson ? (
        <article className="card flex flex-col gap-4 p-4 sm:p-6" aria-labelledby="lesson-title">
          {lessons.length > 1 && (
            <Tabs value={lesson.id} onChange={setTab} tabs={lessons.map((l) => ({ value: l.id, label: <span dir="auto">{l.title}</span> }))} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="lesson-title" className="me-auto text-xl font-extrabold" dir="auto">{lesson.title}</h2>
            <span className="inline-flex items-center gap-1 text-sm text-muted"><Clock className="size-4" aria-hidden />{tr(biCount(lesson.estMinutes, 'minute'))}</span>
            {speech.supported && (
              <Button variant="secondary" size="sm" className="min-h-11" onClick={() => (speech.speaking ? speech.stop() : speech.speak(speakable(`${lesson.title}.\n${lesson.bodyMd}`)))} aria-pressed={speech.speaking}>
                {speech.speaking ? <Pause className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
                {speech.speaking ? tr({ ar: 'إيقاف', fr: 'Arrêter' }) : tr({ ar: 'استمع', fr: 'Écouter' })}
              </Button>
            )}
          </div>
          {lesson.unreviewed && (
            <Alert tone="warning">
              <span className="inline-flex items-center gap-1.5"><TriangleAlert className="size-4 shrink-0" aria-hidden />{tr({ ar: 'محتوى قيد المراجعة: لم يراجعه محرر بشري بعد. تحقق من المعلومات المهمة في المصادر الرسمية.', fr: 'Contenu en cours de relecture : pas encore validé par un éditeur. Vérifiez les points importants dans les sources officielles.' })}</span>
            </Alert>
          )}
          <Markdown source={lesson.bodyMd} />
        </article>
      ) : (
        <EmptyState
          icon={<BookOpen className="size-8" aria-hidden />}
          title={tr({ ar: 'الدرس قيد الإعداد', fr: 'Leçon en préparation' })}
          body={tr({ ar: 'يراجع فريقنا كل درس قبل نشره. في الأثناء، راجع الأهداف أعلاه وتدرّب على الأسئلة.', fr: 'Chaque leçon est relue avant publication. En attendant, revoyez les objectifs et entraînez-vous.' })}
        />
      )}

      {(topic.children ?? []).length > 0 && (
        <section aria-labelledby="subtopics" className="flex flex-col gap-2">
          <SectionTitle id="subtopics">{tr({ ar: 'محاور فرعية', fr: 'Sous-thèmes' })}</SectionTitle>
          <ul className="flex flex-col gap-2">
            {topic.children!.map((c) => (
              <li key={c.key} className="card flex flex-col gap-1 p-3">
                <Link href={`/app/lesson/${encodeURIComponent(c.key)}`} className="font-semibold text-primary hover:underline">{bi(locale, c.title_ar, c.title_fr)}</Link>
                <MasteryMeter mastery={c.mastery} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-10 md:bottom-4">
        <Button size="lg" block onClick={practise} disabled={!canPractise} loading={start.busy === 'consolidate'} className="shadow-lg">
          <Dumbbell className="size-5" aria-hidden />
          {canPractise ? tr({ ar: '5 أسئلة للتثبيت', fr: '5 questions pour consolider' }) : tr({ ar: 'الأسئلة قيد الإعداد', fr: 'Questions en préparation' })}
        </Button>
      </div>
      {start.error && <Alert tone="warning">{tr(start.error)}</Alert>}
      <PaywallModal reason={start.paywall} onClose={start.closePaywall} from="lesson" />
    </div>
  );
}

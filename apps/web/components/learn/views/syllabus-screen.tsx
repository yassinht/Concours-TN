'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Dumbbell, ExternalLink, ListTree, Search, Target } from 'lucide-react';
import type { SyllabusNodeDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Badge, Button, Card, EmptyState, Input, Stat } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { ErrorState, PageHeader, Skeleton } from '@/components/app/bits';
import { bi } from '@/components/app/format';
import type { Bi } from '@/lib/i18n';
import { MasteryMeter } from '../charts';
import { useSessionApi, useStartAttempt } from '../hooks';
import { biCount, SCOPE_TEXT } from '../labels';
import { PaywallModal } from '../paywall';
import { averageMastery, filterTree, leaves } from '../syllabus';

/** /app/syllabus/[slug]: the concours programme as a tree, with where each topic comes from and the learner's mastery. */
export function SyllabusScreen({ slug, familyName }: { slug: string; familyName: Bi | null }) {
  const tr = useT();
  const data = useSessionApi<SyllabusNodeDTO[]>(`/catalog/syllabus/${encodeURIComponent(slug)}`);
  const [q, setQ] = useState('');
  const start = useStartAttempt('syllabus');
  const tree = useMemo(() => filterTree(data.data ?? [], q), [data.data, q]);
  const topics = useMemo(() => leaves(data.data ?? []), [data.data]);
  const practised = topics.filter((t) => typeof t.mastery === 'number').length;
  const avg = averageMastery(topics);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/app/practice"
        title={tr({ ar: 'برنامج المناظرة', fr: 'Programme du concours' })}
        subtitle={familyName ? tr(familyName) : undefined}
      />

      <details className="rounded-2xl border border-border bg-surface p-3 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
          <ListTree className="size-4 text-primary" aria-hidden />{tr({ ar: 'من أين يأتي هذا البرنامج؟', fr: 'D’où vient ce programme ?' })}
        </summary>
        <ul className="mt-2 flex flex-col gap-2">
          {(Object.keys(SCOPE_TEXT) as (keyof typeof SCOPE_TEXT)[]).map((k) => (
            <li key={k} className="flex flex-wrap items-center gap-2">
              <Badge tone={SCOPE_TEXT[k].tone}>{tr(SCOPE_TEXT[k])}</Badge>
              <span className="text-muted">{tr(SCOPE_HINT[k])}</span>
            </li>
          ))}
        </ul>
      </details>

      {data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.reload()} />
      ) : !data.data ? (
        <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-20" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      ) : data.data.length === 0 ? (
        <EmptyState icon={<ListTree className="size-8" aria-hidden />} title={tr({ ar: 'البرنامج قيد الإعداد', fr: 'Programme en préparation' })} body={tr({ ar: 'نعمل على جمع البرنامج من المصادر الرسمية والامتحانات السابقة.', fr: 'Nous rassemblons le programme à partir des sources officielles et des anciens sujets.' })} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={tr({ ar: 'المحاور', fr: 'Thèmes' })} value={topics.length} />
            <Stat label={tr({ ar: 'تدرّبت عليها', fr: 'Travaillés' })} value={practised} />
            <Stat label={tr({ ar: 'متوسط التمكن', fr: 'Maîtrise moy.' })} value={avg == null ? '—' : <span dir="ltr">{Math.round(avg * 100)}%</span>} />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr({ ar: 'ابحث عن محور…', fr: 'Rechercher un thème…' })}
              aria-label={tr({ ar: 'ابحث في البرنامج', fr: 'Rechercher dans le programme' })}
              className="ps-9"
            />
          </div>
          {tree.length === 0 ? (
            <EmptyState title={tr({ ar: 'لا نتائج', fr: 'Aucun résultat' })} />
          ) : (
            <ul className="flex flex-col gap-3">
              {tree.map((n, i) => (
                <SubjectCard key={n.key} n={n} defaultOpen={i === 0 || !!q} onPractice={(topicKey) => void start.start({ kind: 'PRACTICE', topicKey, count: 10, familySlug: slug }, topicKey)} busy={start.busy} />
              ))}
            </ul>
          )}
          {start.error && <p className="text-sm text-danger" role="alert">{tr(start.error)}</p>}
        </>
      )}
      <PaywallModal reason={start.paywall} onClose={start.closePaywall} from="syllabus" />
    </div>
  );
}

const SCOPE_HINT: Record<keyof typeof SCOPE_TEXT, Bi> = {
  OFFICIAL_PROGRAM: { ar: 'منصوص عليه في بلاغ أو قرار رسمي.', fr: 'Prévu par un avis ou un arrêté officiel.' },
  INFERRED_FROM_PAST_EXAMS: { ar: 'استنتجناه من مواضيع الدورات السابقة.', fr: 'Déduit des sujets des sessions précédentes.' },
  GENERAL_SKILL: { ar: 'مهارة عامة تُقاس في أغلب المناظرات.', fr: 'Compétence générale évaluée dans la plupart des concours.' },
  SUGGESTED: { ar: 'اقتراح من فريقنا للتحضير — غير مؤكد رسميًا.', fr: 'Suggestion de notre équipe — non confirmé officiellement.' },
};

type Practise = (topicKey: string) => void;

function SubjectCard({ n, defaultOpen, onPractice, busy }: { n: SyllabusNodeDTO; defaultOpen: boolean; onPractice: Practise; busy: string | null }) {
  const tr = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(defaultOpen);
  const ls = leaves([n]);
  return (
    <li>
      <Card className="p-0 sm:p-0">
        <div className="flex flex-col gap-1.5 p-4">
          <h2 className="text-lg font-bold">
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 text-start">
              <ChevronDown className={clsx('size-5 shrink-0 text-muted transition', open && 'rotate-180')} aria-hidden />
              <span>{bi(locale, n.title_ar, n.title_fr)}</span>
            </button>
          </h2>
          <div className="flex flex-wrap items-center gap-2 ps-7 text-xs text-muted">
            <Badge tone={SCOPE_TEXT[n.scope].tone}>{tr(SCOPE_TEXT[n.scope])}</Badge>
            <span>{tr(DOMAIN_LABELS[n.domain])} · {tr(biCount(ls.length, 'topic'))}</span>
          </div>
          <div className="ps-7"><MasteryMeter mastery={averageMastery(ls)} /></div>
        </div>
        {open && (
          <div className="flex flex-col gap-3 border-t border-border p-3 sm:p-4">
            <SourceLine n={n} />
            {n.children?.length ? (
              <ul className="flex flex-col gap-3">
                {n.children.map((c) => (c.children?.length
                  ? <UnitBlock key={c.key} n={c} parentScope={n.scope} onPractice={onPractice} busy={busy} />
                  : <TopicRow key={c.key} n={c} parentScope={n.scope} onPractice={onPractice} busy={busy} />))}
              </ul>
            ) : (
              <ul><TopicRow n={n} parentScope={null} onPractice={onPractice} busy={busy} /></ul>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

function UnitBlock({ n, parentScope, onPractice, busy }: { n: SyllabusNodeDTO; parentScope: SyllabusNodeDTO['scope']; onPractice: Practise; busy: string | null }) {
  const tr = useT();
  const { locale } = useLocale();
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 border-s-4 border-primary/40 ps-2">
        <h3 className="font-bold">{bi(locale, n.title_ar, n.title_fr)}</h3>
        {n.scope !== parentScope && <Badge tone={SCOPE_TEXT[n.scope].tone}>{tr(SCOPE_TEXT[n.scope])}</Badge>}
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {n.children!.map((c) => (c.children?.length
          ? <UnitBlock key={c.key} n={c} parentScope={n.scope} onPractice={onPractice} busy={busy} />
          : <TopicRow key={c.key} n={c} parentScope={n.scope} onPractice={onPractice} busy={busy} />))}
      </ul>
    </li>
  );
}

function TopicRow({ n, parentScope, onPractice, busy }: { n: SyllabusNodeDTO; parentScope: SyllabusNodeDTO['scope'] | null; onPractice: Practise; busy: string | null }) {
  const tr = useT();
  const { locale } = useLocale();
  const [showObj, setShowObj] = useState(false);
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{bi(locale, n.title_ar, n.title_fr)}</span>
            {parentScope !== null && n.scope !== parentScope && <Badge tone={SCOPE_TEXT[n.scope].tone}>{tr(SCOPE_TEXT[n.scope])}</Badge>}
          </span>
          <MasteryMeter mastery={n.mastery} />
          <span className="text-xs text-muted">{n.questionCount > 0 ? tr(biCount(n.questionCount, 'question')) : tr({ ar: 'أسئلة قيد الإعداد', fr: 'Questions en préparation' })}</span>
        </div>
        <div className="flex items-center gap-1">
          {n.hasLesson && (
            <Link href={`/app/lesson/${encodeURIComponent(n.key)}`} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-primary hover:bg-primary-soft">
              <BookOpen className="size-4" aria-hidden />{tr({ ar: 'الدرس', fr: 'Leçon' })}
            </Link>
          )}
          <Button size="sm" variant="secondary" className="min-h-11" disabled={n.questionCount === 0} loading={busy === n.key} onClick={() => onPractice(n.key)}>
            <Dumbbell className="size-4" aria-hidden />{tr({ ar: 'تدرّب', fr: 'S’entraîner' })}
          </Button>
        </div>
      </div>
      {n.objectives.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowObj(!showObj)} aria-expanded={showObj} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-muted hover:text-text">
            <Target className="size-3.5" aria-hidden />{tr({ ar: `الأهداف (${n.objectives.length})`, fr: `Objectifs (${n.objectives.length})` })}
            <ChevronDown className={clsx('size-3.5 transition', showObj && 'rotate-180')} aria-hidden />
          </button>
          {showObj && (
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-sm text-muted">
              {n.objectives.map((o) => <li key={o.key}>{bi(locale, o.text_ar, o.text_fr)}</li>)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function SourceLine({ n }: { n: SyllabusNodeDTO }) {
  const tr = useT();
  if (!n.source) return null;
  let href: string | null = null;
  try {
    const u = n.source.url ? new URL(n.source.url) : null;
    href = u && (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : null;
  } catch {
    href = null;
  }
  return (
    <p className="text-xs text-muted">
      {tr({ ar: 'المصدر:', fr: 'Source :' })}{' '}
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-text">{n.source.title}<ExternalLink className="size-3" aria-hidden /></a> : n.source.title}
    </p>
  );
}

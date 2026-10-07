'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bookmark, BookOpen, CircleCheck, Dumbbell, NotebookPen, RotateCcw } from 'lucide-react';
import type { Domain, QuestionDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, EmptyState, Select, Tabs } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { ErrorState, PageHeader, Skeleton } from '@/components/app/bits';
import { relativeTime } from '@/components/app/format';
import { useEnrollments, useSessionApi, useStartAttempt } from '../hooks';
import { PaywallModal } from '../paywall';
import { AnswerReview } from '../question-inputs';
import { BookmarkButton, ReportButton } from '../question-tools';
import type { MistakeItem } from '../types';
import { nOf } from '../labels';

type Tab = 'mistakes' | 'bookmarks';

/** /app/mistakes: the learner's notebook — past mistakes (with spaced review) and bookmarked questions. */
export function MistakesScreen({ initialTab = 'mistakes' }: { initialTab?: Tab }) {
  const tr = useT();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [domain, setDomain] = useState<Domain | 'ALL'>('ALL');
  const [hideFixed, setHideFixed] = useState(true);
  const enr = useEnrollments();
  const mistakes = useSessionApi<MistakeItem[]>('/me/mistakes?limit=200');
  const bookmarks = useSessionApi<QuestionDTO[]>(tab === 'bookmarks' ? '/me/bookmarks' : null);
  const start = useStartAttempt('mistakes');
  const familySlug = enr.primary?.familySlug;

  const all = mistakes.data ?? [];
  const open = all.filter((m) => !m.fixed);
  const due = open.filter((m) => !m.nextReviewAt || Date.parse(m.nextReviewAt) <= Date.now());
  const domains = useMemo(() => {
    const src = tab === 'mistakes' ? all.map((m) => m.question.domain) : (bookmarks.data ?? []).map((q) => q.domain);
    return [...new Set(src)];
  }, [tab, all, bookmarks.data]);

  const visibleMistakes = all.filter((m) => (domain === 'ALL' || m.question.domain === domain) && (!hideFixed || !m.fixed));
  const visibleBookmarks = (bookmarks.data ?? []).filter((q) => domain === 'ALL' || q.domain === domain);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/app/practice"
        title={tr({ ar: 'دفتر الأخطاء', fr: 'Carnet d’erreurs' })}
        subtitle={tr({ ar: 'كل خطأ تصححه اليوم نقطة تكسبها يوم المناظرة.', fr: 'Chaque erreur corrigée aujourd’hui est un point gagné le jour J.' })}
      />

      <Tabs<Tab>
        value={tab}
        onChange={(v) => { setTab(v); setDomain('ALL'); }}
        tabs={[
          { value: 'mistakes', label: `${tr({ ar: 'أخطائي', fr: 'Mes erreurs' })}${mistakes.data ? ` (${open.length})` : ''}` },
          { value: 'bookmarks', label: tr({ ar: 'المفضلة', fr: 'Favoris' }) },
        ]}
      />

      {tab === 'mistakes' && (
        <div className="flex flex-col gap-3 rounded-2xl bg-warning-soft p-4">
          <p className="text-sm">
            {due.length > 0
              ? tr({ ar: `للمراجعة الآن: ${nOf('ar', due.length, 'question')}.`, fr: `À revoir maintenant : ${nOf('fr', due.length, 'question')}.` })
              : tr({ ar: 'لا شيء مستحق للمراجعة الآن. تعود الأسئلة تلقائيًا في الوقت المناسب (تكرار متباعد).', fr: 'Rien à revoir pour l’instant. Les questions reviennent au bon moment (répétition espacée).' })}
          </p>
          <Button
            variant="primary"
            className="self-start"
            disabled={open.length === 0}
            loading={start.busy === 'review'}
            onClick={() => void start.start({ kind: 'REVIEW', count: Math.min(30, Math.max(5, due.length || open.length)), ...(familySlug ? { familySlug } : {}) }, 'review')}
          >
            <RotateCcw className="size-4" aria-hidden />{tr({ ar: 'أعد محاولة أخطائي', fr: 'Retenter mes erreurs' })}
          </Button>
          {start.error && <Alert tone="info">{tr(start.error)}</Alert>}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="nb-domain" className="text-sm font-semibold">{tr({ ar: 'المادة', fr: 'Matière' })}</label>
          <Select id="nb-domain" value={domain} onChange={(e) => setDomain(e.target.value as Domain | 'ALL')}>
            <option value="ALL">{tr({ ar: 'كل المواد', fr: 'Toutes les matières' })}</option>
            {domains.map((d) => <option key={d} value={d}>{tr(DOMAIN_LABELS[d])}</option>)}
          </Select>
        </div>
        {tab === 'mistakes' && (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={hideFixed} onChange={(e) => setHideFixed(e.target.checked)} className="size-5 accent-primary" />
            {tr({ ar: 'إخفاء الأخطاء المصحَّحة', fr: 'Masquer les erreurs corrigées' })}
          </label>
        )}
      </div>

      {tab === 'mistakes' ? (
        mistakes.error ? <ErrorState error={mistakes.error} onRetry={() => void mistakes.reload()} />
          : !mistakes.data ? <List loading />
            : visibleMistakes.length === 0 ? (
              <EmptyState
                icon={<NotebookPen className="size-8" aria-hidden />}
                title={all.length === 0 ? tr({ ar: 'دفترك فارغ', fr: 'Votre carnet est vide' }) : tr({ ar: 'لا أخطاء مطابقة', fr: 'Aucune erreur correspondante' })}
                body={all.length === 0 ? tr({ ar: 'الأسئلة التي تخطئ فيها تُحفظ هنا تلقائيًا لتراجعها.', fr: 'Les questions ratées sont enregistrées ici automatiquement.' }) : undefined}
                action={all.length === 0 ? <Link href="/app/practice" className="font-semibold text-primary underline">{tr({ ar: 'ابدأ التدرب', fr: 'Commencer à s’entraîner' })}</Link> : undefined}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleMistakes.map((m) => <NotebookItem key={m.question.id} q={m.question} mistake={m} />)}
              </ul>
            )
      ) : (
        bookmarks.error ? <ErrorState error={bookmarks.error} onRetry={() => void bookmarks.reload()} />
          : !bookmarks.data ? <List loading />
            : visibleBookmarks.length === 0 ? (
              <EmptyState
                icon={<Bookmark className="size-8" aria-hidden />}
                title={tr({ ar: 'لا أسئلة محفوظة', fr: 'Aucune question en favori' })}
                body={tr({ ar: 'اضغط على رمز الحفظ في أي سؤال لتجده هنا.', fr: 'Touchez l’icône favori d’une question pour la retrouver ici.' })}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleBookmarks.map((q) => <NotebookItem key={q.id} q={q} onUnbookmark={() => bookmarks.setData((l) => l?.filter((x) => x.id !== q.id))} />)}
              </ul>
            )
      )}

      <PaywallModal reason={start.paywall} onClose={start.closePaywall} from="mistakes" />
    </div>
  );
}

function List({ loading }: { loading: true }) {
  return <div className="flex flex-col gap-2" aria-busy={loading}><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>;
}

function NotebookItem({ q, mistake, onUnbookmark }: { q: QuestionDTO; mistake?: MistakeItem; onUnbookmark?: () => void }) {
  const tr = useT();
  const { locale } = useLocale();
  const start = useStartAttempt('notebook');
  return (
    <li className="card overflow-hidden">
      <details className="group">
        <summary className="flex min-h-14 cursor-pointer list-none flex-col gap-1.5 p-3 [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tone="primary">{tr(DOMAIN_LABELS[q.domain])}</Badge>
            {mistake && mistake.timesWrong > 1 && <Badge tone="danger">{tr({ ar: `أخطأت ${nOf('ar', mistake.timesWrong, 'time')}`, fr: `${mistake.timesWrong} erreurs` })}</Badge>}
            {mistake?.fixed && <Badge tone="success"><CircleCheck className="size-3.5" aria-hidden />{tr({ ar: 'صحّحته', fr: 'Corrigée' })}</Badge>}
            {mistake?.lastAnsweredAt && <span className="text-muted">{relativeTime(locale, mistake.lastAnsweredAt)}</span>}
          </span>
          <span className="line-clamp-2 font-semibold group-open:line-clamp-none" lang={q.language} dir="auto">{q.stem}</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {q.correct !== undefined ? (
            <NotebookAnswer q={q} />
          ) : (
            <p className="text-sm text-muted">{tr({ ar: 'تظهر الإجابة بعد أن تجيب عن هذا السؤال أو بعد تسليم الامتحان الذي يتضمنه.', fr: 'La réponse s’affichera après avoir répondu à cette question ou rendu l’examen qui la contient.' })}</p>
          )}
          {q.explanation && (
            <div className="rounded-xl bg-surface-2 p-3">
              <h3 className="mb-1 text-sm font-bold">{tr({ ar: 'الشرح', fr: 'Explication' })}</h3>
              <p className="whitespace-pre-line text-sm leading-relaxed" lang={q.language} dir="auto">{q.explanation}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="secondary" className="min-h-11" loading={!!start.busy} onClick={() => void start.start({ kind: 'PRACTICE', topicKey: q.topicKey, count: 5 }, 'topic')}>
              <Dumbbell className="size-4" aria-hidden />{tr({ ar: 'تدرّب على المحور', fr: 'S’entraîner sur le thème' })}
            </Button>
            <Link href={`/app/lesson/${encodeURIComponent(q.topicKey)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary hover:bg-primary-soft">
              <BookOpen className="size-4" aria-hidden />{tr({ ar: 'الدرس', fr: 'Leçon' })}
            </Link>
            <span className="ms-auto flex items-center">
              <BookmarkButton questionId={q.id} initial={onUnbookmark ? true : !!q.bookmarked} compact onChange={(v) => { if (!v) onUnbookmark?.(); }} />
              <ReportButton questionId={q.id} />
            </span>
          </div>
          {start.error && <p className="text-sm text-danger" role="alert">{tr(start.error)}</p>}
          <PaywallModal reason={start.paywall} onClose={start.closePaywall} from="notebook" />
        </div>
      </details>
    </li>
  );
}

/** Correct answer only (the notebook does not keep the learner's wrong answer). */
function NotebookAnswer({ q }: { q: QuestionDTO }) {
  const tr = useT();
  return (
    <div className={clsx('flex flex-col gap-1')}>
      <p className="text-xs font-bold text-success">{tr({ ar: 'الإجابة الصحيحة', fr: 'Bonne réponse' })}</p>
      <AnswerReview q={q} answer={null} hideUnanswered />
    </div>
  );
}

'use client';

import clsx from 'clsx';
import { ArrowRight, CircleCheck, Lightbulb } from 'lucide-react';
import type { Difficulty, Domain, QuestionType } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Badge } from '@/components/ui';
import { DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from './labels';
import type { QuestionOption } from './types';

export interface PreviewQuestion {
  type: QuestionType;
  domain: Domain;
  language: string;
  stem: string;
  options: QuestionOption[];
  correct: unknown;
  explanation?: string | null;
  difficulty?: Difficulty;
  topicLabel?: string | null;
  sourceLabel?: string | null;
}

const LANG_ATTR: Record<string, string> = { ar: 'ar', fr: 'fr', en: 'en' };

/** Correct option ids for choice questions (MCQ / TRUE_FALSE). */
export function correctIds(correct: unknown): string[] {
  return Array.isArray(correct) ? correct.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * The question as the learner sees it (same card, badges and option styling as the practice screens), with the answer
 * key highlighted for the reviewer: icon + "Bonne réponse" text, never color alone.
 */
export function QuestionPreview({ q, showKey = true, className }: { q: PreviewQuestion; showKey?: boolean; className?: string }) {
  const lang = LANG_ATTR[q.language];
  const choice = q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI' || q.type === 'TRUE_FALSE';
  const keys = correctIds(q.correct);
  const lefts = q.options.filter((o) => o.side === 'left');
  const rights = q.options.filter((o) => o.side === 'right');
  const pairs = ((q.correct as { pairs?: [string, string][] } | null)?.pairs ?? []).filter((p) => Array.isArray(p));
  const order = (q.correct as { order?: string[] } | null)?.order ?? [];
  const numeric = q.correct as { value?: number; tolerance?: number } | null;
  const text = (id: string) => q.options.find((o) => o.id === id)?.text ?? `« ${id} » (option inconnue)`;

  return (
    <article className={clsx('card flex flex-col gap-4 p-4', className)} lang={lang}>
      <div className="flex flex-wrap items-center gap-1.5" lang="fr">
        <Badge tone="neutral">{DOMAIN_LABELS[q.domain]?.fr ?? q.domain}</Badge>
        <Badge tone="neutral">{QUESTION_TYPE_LABEL[q.type]}</Badge>
        {q.difficulty && <Badge tone="neutral">{DIFFICULTY_LABEL[q.difficulty]}</Badge>}
        {q.topicLabel && <Badge tone="primary"><span dir="auto">{q.topicLabel}</span></Badge>}
        {q.sourceLabel && <Badge tone="info"><span dir="auto">{q.sourceLabel}</span></Badge>}
      </div>
      <h3 className="whitespace-pre-line text-lg font-semibold leading-relaxed" dir="auto">{q.stem || <span className="text-muted">(énoncé vide)</span>}</h3>

      {choice && (
        <ul className="flex flex-col gap-2">
          {q.type === 'MCQ_MULTI' && <li className="text-xs text-muted" lang="fr">Plusieurs réponses possibles.</li>}
          {q.options.map((o) => {
            const ok = showKey && keys.includes(o.id);
            return (
              <li key={o.id} className={clsx('flex min-h-12 items-center gap-3 rounded-xl border-2 p-3', ok ? 'border-success bg-success-soft' : 'border-border')}>
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold" dir="ltr">{o.id}</span>
                <span className="flex-1" dir="auto">{o.text || <span className="text-muted">(vide)</span>}</span>
                {ok && <span className="inline-flex items-center gap-1 text-xs font-semibold text-success" lang="fr"><CircleCheck className="size-5" aria-hidden />Bonne réponse</span>}
              </li>
            );
          })}
        </ul>
      )}

      {q.type === 'NUMERIC' && showKey && (
        <p className="rounded-xl border-2 border-success bg-success-soft p-3 text-sm" lang="fr">
          <CircleCheck className="me-1 inline size-4 text-success" aria-hidden />
          Réponse attendue : <strong dir="ltr">{numeric?.value ?? '—'}</strong>
          {numeric?.tolerance ? <> (± <span dir="ltr">{numeric.tolerance}</span>)</> : null}
        </p>
      )}

      {q.type === 'MATCHING' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ul className="flex flex-col gap-2">{lefts.map((o) => <li key={o.id} className="rounded-xl border border-border p-2" dir="auto"><b dir="ltr">{o.id}</b> · {o.text}</li>)}</ul>
          <ul className="flex flex-col gap-2">{rights.map((o) => <li key={o.id} className="rounded-xl border border-border p-2" dir="auto"><b dir="ltr">{o.id}</b> · {o.text}</li>)}</ul>
          {showKey && (
            <div className="rounded-xl border-2 border-success bg-success-soft p-3 text-sm sm:col-span-2">
              <p className="mb-1 font-semibold text-success" lang="fr"><CircleCheck className="me-1 inline size-4" aria-hidden />Associations correctes</p>
              <ul className="flex flex-col gap-1">
                {pairs.map(([l, r]) => <li key={`${l}-${r}`} className="flex items-center gap-2" dir="auto"><span>{text(l)}</span><ArrowRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden /><span>{text(r)}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {q.type === 'ORDERING' && (
        <ol className="flex flex-col gap-2">
          {(showKey && order.length ? order : q.options.map((o) => o.id)).map((id, i) => (
            <li key={id} className={clsx('flex items-center gap-2 rounded-xl border p-2', showKey ? 'border-success bg-success-soft' : 'border-border')}>
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-bold">{i + 1}</span>
              <span className="flex-1" dir="auto">{text(id)}</span>
            </li>
          ))}
          {showKey && <li className="text-xs text-muted" lang="fr">Ordre correct affiché (les candidats voient les éléments mélangés).</li>}
        </ol>
      )}

      {q.explanation && (
        <div className="rounded-xl bg-info-soft p-3 text-sm">
          <p className="mb-1 flex items-center gap-1 font-semibold text-info" lang="fr"><Lightbulb className="size-4" aria-hidden />Explication</p>
          <p className="whitespace-pre-line" dir="auto">{q.explanation}</p>
        </div>
      )}
    </article>
  );
}

'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CircleCheck, CircleX, RotateCcw, Trophy } from 'lucide-react';
import type { Domain, QuestionDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { gradeAnswer, type CorrectAnswer, type UserAnswer } from '@ctn/shared/dist/learning';
import { Badge, Button, Input, ProgressBar, Select, scoreTone } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { readStats, recordAnswer } from './store';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Draft = { kind: 'ids'; ids: string[] } | { kind: 'value'; value: string } | { kind: 'order'; order: string[] } | { kind: 'pairs'; pairs: Record<string, string> };

function initialDraft(q: QuestionDTO): Draft {
  switch (q.type) {
    case 'NUMERIC': return { kind: 'value', value: '' };
    case 'ORDERING': return { kind: 'order', order: shuffle(q.options.map((o) => o.id)) };
    case 'MATCHING': return { kind: 'pairs', pairs: {} };
    default: return { kind: 'ids', ids: [] };
  }
}

function toAnswer(q: QuestionDTO, d: Draft): UserAnswer {
  if (d.kind === 'ids') return d.ids;
  if (d.kind === 'value') {
    const v = Number(d.value.replace(',', '.'));
    return Number.isFinite(v) && d.value.trim() !== '' ? { value: v } : null;
  }
  if (d.kind === 'order') return { order: d.order };
  const lefts = q.options.filter((o) => o.side === 'left');
  return { pairs: lefts.filter((l) => d.pairs[l.id]).map((l) => [l.id, d.pairs[l.id]] as [string, string]) };
}

function isComplete(q: QuestionDTO, d: Draft): boolean {
  if (d.kind === 'ids') return d.ids.length > 0;
  if (d.kind === 'value') return toAnswer(q, d) != null;
  if (d.kind === 'pairs') return q.options.filter((o) => o.side === 'left').every((l) => !!d.pairs[l.id]);
  return true;
}

export interface QuizConfig { domain: Domain | 'ALL'; count: number; mistakesFirst: boolean }

/** Pick the session's questions: optional domain filter, previous local mistakes first, then shuffled. */
export function pickQuestions(all: QuestionDTO[], cfg: QuizConfig, wrongIds: string[]): QuestionDTO[] {
  const pool = all.filter((q) => q.correct !== undefined && (cfg.domain === 'ALL' || q.domain === cfg.domain));
  const wrong = new Set(wrongIds);
  const first = cfg.mistakesFirst ? shuffle(pool.filter((q) => wrong.has(q.id))) : [];
  const rest = shuffle(pool.filter((q) => !first.includes(q)));
  return [...first, ...rest].slice(0, cfg.count);
}

/** Fully offline quiz: grading with the same pure function as the API (gradeAnswer from @ctn/shared). */
export function OfflineQuiz({ slug, questions, onExit }: { slug: string; questions: QuestionDTO[]; onExit: () => void }) {
  const tr = useT();
  const { locale } = useLocale();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(questions[0]));
  const [result, setResult] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [missed, setMissed] = useState<QuestionDTO[]>([]);
  const done = index >= questions.length;
  const q = questions[Math.min(index, questions.length - 1)];

  function check() {
    const ok = gradeAnswer(q.type, q.correct as CorrectAnswer, toAnswer(q, draft));
    setResult(ok);
    recordAnswer(slug, q.id, ok);
    if (ok) setScore((s) => s + 1);
    else setMissed((m) => [...m, q]);
  }

  function next() {
    const n = index + 1;
    setIndex(n);
    setResult(null);
    if (n < questions.length) setDraft(initialDraft(questions[n]));
  }

  if (done) {
    const pct = Math.round((score / Math.max(1, questions.length)) * 100);
    const stats = readStats(slug);
    return (
      <div className="flex flex-col gap-4">
        <div className="card flex flex-col items-center gap-2 p-5 text-center">
          <Trophy className="size-10 text-warning" aria-hidden />
          <h2 className="text-2xl font-extrabold tabular-nums">{score}/{questions.length}</h2>
          <ProgressBar value={pct} tone={scoreTone(pct)} label={tr({ ar: 'النتيجة', fr: 'Score' })} className="max-w-xs" />
          <p className="text-sm text-muted">
            {tr({ ar: `مجموع ما أجبت عنه دون اتصال: ${stats.answered} — الدقة ${stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0}%`, fr: `Total hors ligne : ${stats.answered} réponses — ${stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0} % de réussite` })}
          </p>
          <p className="text-xs text-muted">{tr({ ar: 'نتائج التدرب دون اتصال تبقى على هذا الجهاز ولا تُحتسب في مستوى تحضيرك.', fr: 'Les résultats hors ligne restent sur cet appareil et ne comptent pas dans votre indicateur de préparation.' })}</p>
        </div>
        {missed.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="font-bold">{tr({ ar: 'أسئلة للمراجعة', fr: 'Questions à revoir' })}</h3>
            <ul className="flex flex-col gap-2">
              {missed.map((m) => (
                <li key={m.id} className="card flex flex-col gap-2 p-3 text-sm">
                  <p className="font-semibold" dir="auto">{m.stem}</p>
                  <CorrectAnswerView q={m} />
                  {m.explanation && <p className="text-muted" dir="auto">{m.explanation}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onExit}><RotateCcw className="size-4" aria-hidden />{tr({ ar: 'جلسة جديدة', fr: 'Nouvelle série' })}</Button>
        </div>
      </div>
    );
  }

  const lefts = q.options.filter((o) => o.side === 'left');
  const rights = q.options.filter((o) => o.side === 'right');
  const locked = result !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold tabular-nums">{index + 1}/{questions.length}</span>
        <Button size="sm" variant="ghost" onClick={onExit}>{tr({ ar: 'إنهاء', fr: 'Terminer' })}</Button>
      </div>
      <ProgressBar value={(index / questions.length) * 100} label={tr({ ar: 'التقدم', fr: 'Progression' })} />
      <article className="card flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{tr(DOMAIN_LABELS[q.domain])}</Badge>
          {q.unreviewed && <Badge tone="warning">{tr({ ar: 'محتوى تجريبي — لم يُراجع بعد', fr: 'Contenu bêta — non relu' })}</Badge>}
          {q.sourceLabel && <Badge tone="info">{q.sourceLabel}</Badge>}
        </div>
        <h2 className="text-lg font-semibold leading-relaxed" dir="auto">{q.stem}</h2>

        {(q.type === 'MCQ_SINGLE' || q.type === 'TRUE_FALSE' || q.type === 'MCQ_MULTI') && draft.kind === 'ids' && (
          <fieldset className="flex flex-col gap-2" disabled={locked}>
            <legend className="sr-only">{q.type === 'MCQ_MULTI' ? tr({ ar: 'اختر إجابة أو أكثر', fr: 'Une ou plusieurs réponses' }) : tr({ ar: 'اختر إجابة واحدة', fr: 'Une seule réponse' })}</legend>
            {q.type === 'MCQ_MULTI' && <p className="text-xs text-muted">{tr({ ar: 'يمكن أن تكون هناك أكثر من إجابة صحيحة.', fr: 'Plusieurs réponses possibles.' })}</p>}
            {q.options.map((o) => {
              const selected = draft.ids.includes(o.id);
              const isCorrect = locked && Array.isArray(q.correct) && (q.correct as string[]).includes(o.id);
              return (
                <label key={o.id} className={clsx(
                  'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition',
                  isCorrect ? 'border-success bg-success-soft' : locked && selected ? 'border-danger bg-danger-soft' : selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-primary/50',
                )}>
                  <input
                    type={q.type === 'MCQ_MULTI' ? 'checkbox' : 'radio'}
                    name={`q-${q.id}`}
                    checked={selected}
                    onChange={() => setDraft({ kind: 'ids', ids: q.type === 'MCQ_MULTI' ? (selected ? draft.ids.filter((x) => x !== o.id) : [...draft.ids, o.id]) : [o.id] })}
                    className="size-5 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="flex-1" dir="auto">{o.text}</span>
                  {isCorrect && <CircleCheck className="size-5 text-success" aria-label={tr({ ar: 'الإجابة الصحيحة', fr: 'Bonne réponse' })} />}
                  {locked && selected && !isCorrect && <CircleX className="size-5 text-danger" aria-label={tr({ ar: 'إجابتك', fr: 'Votre réponse' })} />}
                </label>
              );
            })}
          </fieldset>
        )}

        {q.type === 'NUMERIC' && draft.kind === 'value' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`num-${q.id}`} className="text-sm font-semibold">{tr({ ar: 'إجابتك (عدد)', fr: 'Votre réponse (nombre)' })}</label>
            <Input id={`num-${q.id}`} inputMode="decimal" dir="ltr" value={draft.value} disabled={locked} onChange={(e) => setDraft({ kind: 'value', value: e.target.value })} className="max-w-48" />
          </div>
        )}

        {q.type === 'ORDERING' && draft.kind === 'order' && (
          <ol className="flex flex-col gap-2" aria-label={tr({ ar: 'رتّب العناصر', fr: 'Remettez dans l’ordre' })}>
            {draft.order.map((id, i) => {
              const o = q.options.find((x) => x.id === id);
              const move = (dir: -1 | 1) => {
                const j = i + dir;
                if (j < 0 || j >= draft.order.length) return;
                const order = [...draft.order];
                [order[i], order[j]] = [order[j], order[i]];
                setDraft({ kind: 'order', order });
              };
              return (
                <li key={id} className="flex items-center gap-2 rounded-xl border border-border p-2">
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-bold">{i + 1}</span>
                  <span className="flex-1" dir="auto">{o?.text}</span>
                  <button type="button" disabled={locked || i === 0} onClick={() => move(-1)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-2 disabled:opacity-30" aria-label={tr({ ar: 'إلى الأعلى', fr: 'Monter' })}><ArrowUp className="size-4" aria-hidden /></button>
                  <button type="button" disabled={locked || i === draft.order.length - 1} onClick={() => move(1)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-2 disabled:opacity-30" aria-label={tr({ ar: 'إلى الأسفل', fr: 'Descendre' })}><ArrowDown className="size-4" aria-hidden /></button>
                </li>
              );
            })}
          </ol>
        )}

        {q.type === 'MATCHING' && draft.kind === 'pairs' && (
          <div className="flex flex-col gap-2">
            {lefts.map((l) => (
              <div key={l.id} className="grid gap-1.5 rounded-xl border border-border p-2 sm:grid-cols-2 sm:items-center">
                <label htmlFor={`m-${q.id}-${l.id}`} className="font-semibold" dir="auto">{l.text}</label>
                <Select id={`m-${q.id}-${l.id}`} value={draft.pairs[l.id] ?? ''} disabled={locked} onChange={(e) => setDraft({ kind: 'pairs', pairs: { ...draft.pairs, [l.id]: e.target.value } })}>
                  <option value="">{tr({ ar: '— اختر —', fr: '— Choisir —' })}</option>
                  {rights.map((r) => <option key={r.id} value={r.id}>{r.text}</option>)}
                </Select>
              </div>
            ))}
          </div>
        )}

        <div aria-live="polite">
          {result !== null && (
            <div className={clsx('flex flex-col gap-2 rounded-xl p-3 text-sm', result ? 'bg-success-soft' : 'bg-danger-soft')}>
              <p className={clsx('flex items-center gap-2 font-bold', result ? 'text-success' : 'text-danger')}>
                {result ? <CircleCheck className="size-5" aria-hidden /> : <CircleX className="size-5" aria-hidden />}
                {result ? tr({ ar: 'إجابة صحيحة', fr: 'Bonne réponse' }) : tr({ ar: 'إجابة خاطئة', fr: 'Mauvaise réponse' })}
              </p>
              {!result && <CorrectAnswerView q={q} />}
              {q.explanation && <p dir="auto">{q.explanation}</p>}
            </div>
          )}
        </div>

        {result === null ? (
          <Button size="lg" onClick={check} disabled={!isComplete(q, draft)}>{tr({ ar: 'تحقق', fr: 'Valider' })}</Button>
        ) : (
          <Button size="lg" onClick={next}>{index + 1 < questions.length ? tr({ ar: 'السؤال التالي', fr: 'Question suivante' }) : tr({ ar: 'النتيجة', fr: 'Voir le score' })}</Button>
        )}
      </article>
      <p className="text-center text-xs text-muted">{locale === 'ar' ? `الإجابات الصحيحة حتى الآن: ${score}` : `Bonnes réponses jusqu’ici : ${score}`}</p>
    </div>
  );
}

function CorrectAnswerView({ q }: { q: QuestionDTO }) {
  const tr = useT();
  const text = (id: string) => q.options.find((o) => o.id === id)?.text ?? id;
  const c = q.correct as CorrectAnswer | undefined;
  if (c == null) return null;
  let body: string;
  if (Array.isArray(c)) body = c.map(text).join(' · ');
  else if ('value' in c) body = String(c.value) + (c.tolerance ? ` (± ${c.tolerance})` : '');
  else if ('order' in c) body = c.order.map((id, i) => `${i + 1}. ${text(id)}`).join('  ');
  else body = c.pairs.map(([a, b]) => `${text(a)} → ${text(b)}`).join(' · ');
  return <p><span className="font-semibold">{tr({ ar: 'الإجابة الصحيحة:', fr: 'Bonne réponse :' })}</span> <span dir="auto">{body}</span></p>;
}

/** Settings screen before an offline series. */
export function QuizSetup({ questions, wrongCount, onStart }: { questions: QuestionDTO[]; wrongCount: number; onStart: (cfg: QuizConfig) => void }) {
  const tr = useT();
  const domains = useMemo(() => [...new Set(questions.map((q) => q.domain))], [questions]);
  const [domain, setDomain] = useState<Domain | 'ALL'>('ALL');
  const [count, setCount] = useState(10);
  const [mistakesFirst, setMistakesFirst] = useState(wrongCount > 0);
  const available = questions.filter((q) => domain === 'ALL' || q.domain === domain).length;
  return (
    <div className="card flex flex-col gap-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="oq-domain" className="text-sm font-semibold">{tr({ ar: 'المادة', fr: 'Matière' })}</label>
          <Select id="oq-domain" value={domain} onChange={(e) => setDomain(e.target.value as Domain | 'ALL')}>
            <option value="ALL">{tr({ ar: 'كل المواد', fr: 'Toutes les matières' })}</option>
            {domains.map((d) => <option key={d} value={d}>{tr(DOMAIN_LABELS[d])}</option>)}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="oq-count" className="text-sm font-semibold">{tr({ ar: 'عدد الأسئلة', fr: 'Nombre de questions' })}</label>
          <Select id="oq-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
            {[5, 10, 20, 40].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
      </div>
      {wrongCount > 0 && (
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={mistakesFirst} onChange={(e) => setMistakesFirst(e.target.checked)} />
          {tr({ ar: `ابدأ بأخطائي السابقة (${wrongCount})`, fr: `Commencer par mes erreurs (${wrongCount})` })}
        </label>
      )}
      <Button size="lg" onClick={() => onStart({ domain, count, mistakesFirst })} disabled={available === 0}>
        {tr({ ar: 'ابدأ التدرب', fr: 'Commencer' })}
      </Button>
    </div>
  );
}

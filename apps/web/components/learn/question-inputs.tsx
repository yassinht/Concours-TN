'use client';

import clsx from 'clsx';
import { useId } from 'react';
import { ArrowDown, ArrowUp, Check, CircleCheck, CircleX, Square, SquareCheck } from 'lucide-react';
import type { QuestionDTO } from '@ctn/shared';
import { Input, Select } from '@/components/ui';
import { useT } from '@/components/providers';
import { optionLetter } from './labels';

/** What the learner is composing for a question, before it becomes an API answer. */
export type Draft =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'value'; value: string }
  | { kind: 'order'; order: string[]; touched: boolean }
  | { kind: 'pairs'; pairs: Record<string, string> };

export type Answer = string[] | { value: number } | { pairs: [string, string][] } | { order: string[] } | null;

export const lefts = (q: QuestionDTO) => q.options.filter((o) => o.side === 'left');
export const rights = (q: QuestionDTO) => q.options.filter((o) => o.side === 'right');

/** Draft for a question, restored from a saved answer when there is one. */
export function draftFrom(q: QuestionDTO, answer: unknown): Draft {
  switch (q.type) {
    case 'NUMERIC': {
      const v = (answer as { value?: unknown } | null)?.value;
      return { kind: 'value', value: typeof v === 'number' ? String(v) : '' };
    }
    case 'ORDERING': {
      const saved = (answer as { order?: unknown } | null)?.order;
      const ids = q.options.map((o) => o.id);
      const ok = Array.isArray(saved) && saved.length === ids.length && saved.every((x) => ids.includes(String(x)));
      return { kind: 'order', order: ok ? (saved as string[]).map(String) : ids, touched: ok };
    }
    case 'MATCHING': {
      const pairs: Record<string, string> = {};
      const saved = (answer as { pairs?: unknown } | null)?.pairs;
      if (Array.isArray(saved)) for (const p of saved) if (Array.isArray(p) && p.length === 2) pairs[String(p[0])] = String(p[1]);
      return { kind: 'pairs', pairs };
    }
    default:
      return { kind: 'ids', ids: Array.isArray(answer) ? answer.map(String) : [] };
  }
}

/** "3,5", "٣٫٥", "۳.۵" → 3.5 (Tunisian keyboards mix decimal commas and Arabic-Indic digits). */
export function parseNumber(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
    .replace(/[\s٬ ]/g, '')
    .replace(/^−/, '-');
  if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function toAnswer(q: QuestionDTO, d: Draft): Answer {
  switch (d.kind) {
    case 'ids': return d.ids.length ? d.ids : null;
    case 'value': {
      const v = parseNumber(d.value);
      return v == null ? null : { value: v };
    }
    case 'order': return { order: d.order };
    case 'pairs': {
      const ps = lefts(q).filter((l) => d.pairs[l.id]).map((l) => [l.id, d.pairs[l.id]] as [string, string]);
      return ps.length ? { pairs: ps } : null;
    }
  }
}

/** Complete enough to be graded (a partial matching or an untouched ordering is not an answer yet). */
export function isComplete(q: QuestionDTO, d: Draft): boolean {
  switch (d.kind) {
    case 'ids': return d.ids.length > 0;
    case 'value': return parseNumber(d.value) != null;
    case 'order': return d.touched;
    case 'pairs': return lefts(q).every((l) => !!d.pairs[l.id]);
  }
}

// ───────── Correct-answer helpers (reveal / review) ─────────

function correctIds(correct: unknown): string[] {
  return Array.isArray(correct) ? correct.map(String) : [];
}
function correctOrder(correct: unknown): string[] {
  const o = (correct as { order?: unknown } | null)?.order;
  return Array.isArray(o) ? o.map(String) : [];
}
function correctPairs(correct: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const ps = (correct as { pairs?: unknown } | null)?.pairs;
  if (Array.isArray(ps)) for (const p of ps) if (Array.isArray(p) && p.length === 2) out[String(p[0])] = String(p[1]);
  return out;
}
function correctValue(correct: unknown): { value: number; tolerance: number } | null {
  const c = correct as { value?: unknown; tolerance?: unknown } | null;
  return typeof c?.value === 'number' ? { value: c.value, tolerance: typeof c.tolerance === 'number' ? c.tolerance : 0 } : null;
}

// ───────── Stem ─────────

const STEM_SIZES = {
  ar: ['text-lg leading-loose', 'text-xl leading-loose', 'text-2xl leading-loose'],
  latin: ['text-base leading-relaxed', 'text-lg leading-relaxed', 'text-xl leading-relaxed'],
};

/** Question text: language-aware size, dir="auto" so French/English stems read left-to-right inside the Arabic UI. */
export function QuestionStem({ q, id, scale = 1, as: As = 'p' }: { q: QuestionDTO; id?: string; scale?: 0 | 1 | 2; as?: 'p' | 'h2' }) {
  const sizes = q.language === 'ar' ? STEM_SIZES.ar : STEM_SIZES.latin;
  return (
    <As id={id} lang={q.language} dir="auto" className={clsx('whitespace-pre-line font-semibold', sizes[scale])}>
      {q.stem}
    </As>
  );
}

// ───────── Inputs ─────────

export interface InputProps {
  q: QuestionDTO;
  draft: Draft;
  onChange: (d: Draft) => void;
  /** Feedback shown: inputs are locked and marked against `correct`. */
  reveal?: { correct: unknown } | null;
  disabled?: boolean;
  labelledBy?: string;
  scale?: 0 | 1 | 2;
}

const OPTION_TEXT = ['text-[15px]', 'text-base', 'text-lg'];

export function QuestionInput(props: InputProps) {
  switch (props.q.type) {
    case 'MCQ_SINGLE':
    case 'TRUE_FALSE':
    case 'MCQ_MULTI':
      return <ChoiceInput {...props} />;
    case 'NUMERIC':
      return <NumericInput {...props} />;
    case 'ORDERING':
      return <OrderingInput {...props} />;
    case 'MATCHING':
      return <MatchingInput {...props} />;
    default:
      return null;
  }
}

function ChoiceInput({ q, draft, onChange, reveal, disabled, labelledBy, scale = 1 }: InputProps) {
  const tr = useT();
  const multi = q.type === 'MCQ_MULTI';
  const ids = draft.kind === 'ids' ? draft.ids : [];
  const good = reveal ? correctIds(reveal.correct) : [];
  const locked = !!reveal || disabled;
  const tf = q.type === 'TRUE_FALSE';

  const toggle = (id: string) => {
    if (locked) return;
    if (multi) onChange({ kind: 'ids', ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
    else onChange({ kind: 'ids', ids: [id] });
  };

  return (
    <div className="flex flex-col gap-2">
      {multi && !reveal && <p className="text-sm text-muted">{tr({ ar: 'اختر كل الإجابات الصحيحة ثم أكّد.', fr: 'Cochez toutes les bonnes réponses puis validez.' })}</p>}
      <div role={multi ? 'group' : 'radiogroup'} aria-labelledby={labelledBy} className={clsx('grid gap-2', tf && 'sm:grid-cols-2')}>
        {q.options.map((o, i) => {
          const selected = ids.includes(o.id);
          const isGood = reveal ? good.includes(o.id) : false;
          const isBad = reveal ? selected && !isGood : false;
          const missed = reveal ? isGood && !selected : false;
          return (
            <button
              key={o.id}
              type="button"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={selected}
              aria-disabled={locked || undefined}
              onClick={() => toggle(o.id)}
              className={clsx(
                'flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-start transition',
                !reveal && (selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-primary/50'),
                isGood && 'border-success bg-success-soft',
                isBad && 'border-danger bg-danger-soft',
                reveal && !isGood && !isBad && 'border-border bg-surface opacity-75',
                locked ? 'cursor-default' : 'cursor-pointer active:scale-[0.99]',
              )}
            >
              <span
                className={clsx(
                  'inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold',
                  selected && !reveal ? 'bg-primary text-primary-contrast' : 'bg-surface-2 text-muted',
                  isGood && 'bg-success text-white',
                  isBad && 'bg-danger text-white',
                )}
                aria-hidden
              >
                {multi && !reveal ? (selected ? <SquareCheck className="size-5" /> : <Square className="size-5" />) : optionLetter(q.language, i)}
              </span>
              <span lang={q.language} dir="auto" className={clsx('flex-1 font-medium', OPTION_TEXT[scale])}>{o.text}</span>
              {isGood && (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-success">
                  <CircleCheck className="size-5" aria-hidden />
                  <span className={missed ? '' : 'sr-only sm:not-sr-only'}>{missed ? tr({ ar: 'الإجابة الصحيحة', fr: 'Bonne réponse' }) : tr({ ar: 'صحيح', fr: 'Correct' })}</span>
                </span>
              )}
              {isBad && (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-danger">
                  <CircleX className="size-5" aria-hidden />
                  <span className="sr-only sm:not-sr-only">{tr({ ar: 'اختيارك', fr: 'Votre choix' })}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumericInput({ q, draft, onChange, reveal, disabled, scale = 1 }: InputProps) {
  const tr = useT();
  const id = useId();
  const value = draft.kind === 'value' ? draft.value : '';
  const c = reveal ? correctValue(reveal.correct) : null;
  const parsed = parseNumber(value);
  const invalid = value.trim() !== '' && parsed == null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">{tr({ ar: 'إجابتك (عدد)', fr: 'Votre réponse (nombre)' })}</label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        dir="ltr"
        value={value}
        disabled={!!reveal || disabled}
        onChange={(e) => onChange({ kind: 'value', value: e.target.value.slice(0, 32) })}
        aria-invalid={invalid || undefined}
        className={clsx('h-14 max-w-xs text-center font-bold tabular-nums', scale === 2 ? 'text-2xl' : 'text-xl', reveal && (parsed != null && c && Math.abs(parsed - c.value) <= c.tolerance + 1e-9 ? 'border-success' : 'border-danger'))}
        placeholder="0"
      />
      {invalid && <p className="text-xs text-danger" role="alert">{tr({ ar: 'أدخل عددًا صالحًا (مثال: 12 أو 3,5).', fr: 'Entrez un nombre valide (ex. : 12 ou 3,5).' })}</p>}
      {c && (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
          <CircleCheck className="size-4" aria-hidden />
          {tr({ ar: 'الإجابة الصحيحة:', fr: 'Bonne réponse :' })} <span dir="ltr" className="tabular-nums">{c.value}{c.tolerance ? ` ± ${c.tolerance}` : ''}</span>
        </p>
      )}
    </div>
  );
}

function OrderingInput({ q, draft, onChange, reveal, disabled, scale = 1 }: InputProps) {
  const tr = useT();
  const order = draft.kind === 'order' ? draft.order : q.options.map((o) => o.id);
  const byId = new Map(q.options.map((o) => [o.id, o]));
  const good = reveal ? correctOrder(reveal.correct) : [];
  const locked = !!reveal || disabled;
  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (locked || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ kind: 'order', order: next, touched: true });
  };
  return (
    <div className="flex flex-col gap-2">
      {!reveal && <p className="text-sm text-muted">{tr({ ar: 'رتّب العناصر باستعمال الأسهم (الأول في الأعلى).', fr: 'Ordonnez les éléments avec les flèches (le premier en haut).' })}</p>}
      <ol className="flex flex-col gap-2">
        {order.map((id, i) => {
          const o = byId.get(id);
          if (!o) return null;
          const ok = reveal ? good[i] === id : null;
          return (
            <li
              key={id}
              className={clsx(
                'flex min-h-14 items-center gap-2 rounded-2xl border-2 bg-surface px-2 py-1.5',
                ok === true && 'border-success bg-success-soft',
                ok === false && 'border-danger bg-danger-soft',
                ok === null && 'border-border',
              )}
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold tabular-nums" aria-hidden>{i + 1}</span>
              <span lang={q.language} dir="auto" className={clsx('flex-1 font-medium', OPTION_TEXT[scale])}>{o.text}</span>
              {ok === true && <CircleCheck className="size-5 shrink-0 text-success" aria-label={tr({ ar: 'في مكانه الصحيح', fr: 'Bien placé' })} />}
              {ok === false && <CircleX className="size-5 shrink-0 text-danger" aria-label={tr({ ar: 'ليس في مكانه', fr: 'Mal placé' })} />}
              {!reveal && (
                <span className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={locked || i === 0} className="inline-flex size-11 items-center justify-center rounded-xl border border-border hover:bg-surface-2 disabled:opacity-30" aria-label={tr({ ar: `حرّك «${o.text}» إلى الأعلى`, fr: `Monter « ${o.text} »` })}>
                    <ArrowUp className="size-5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={locked || i === order.length - 1} className="inline-flex size-11 items-center justify-center rounded-xl border border-border hover:bg-surface-2 disabled:opacity-30" aria-label={tr({ ar: `حرّك «${o.text}» إلى الأسفل`, fr: `Descendre « ${o.text} »` })}>
                    <ArrowDown className="size-5" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {!reveal && draft.kind === 'order' && !draft.touched && (
        <button
          type="button"
          disabled={locked}
          onClick={() => onChange({ kind: 'order', order, touched: true })}
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-xl px-2 text-sm font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
        >
          <Check className="size-4" aria-hidden />
          {tr({ ar: 'هذا الترتيب صحيح في رأيي', fr: 'Je garde cet ordre' })}
        </button>
      )}
      {reveal && good.length > 0 && good.join() !== order.join() && (
        <div className="rounded-xl bg-success-soft p-3 text-sm">
          <p className="mb-1 font-semibold text-success">{tr({ ar: 'الترتيب الصحيح:', fr: 'Ordre correct :' })}</p>
          <ol className="list-decimal ps-5" lang={q.language} dir="auto">{good.map((id) => <li key={id}>{byId.get(id)?.text ?? id}</li>)}</ol>
        </div>
      )}
    </div>
  );
}

function MatchingInput({ q, draft, onChange, reveal, disabled, scale = 1 }: InputProps) {
  const tr = useT();
  const pairs = draft.kind === 'pairs' ? draft.pairs : {};
  const rs = rights(q);
  const good = reveal ? correctPairs(reveal.correct) : {};
  const locked = !!reveal || disabled;
  const rText = (id: string | undefined) => rs.find((r) => r.id === id)?.text ?? '';
  const used = new Set(Object.values(pairs));
  return (
    <div className="flex flex-col gap-2">
      {!reveal && <p className="text-sm text-muted">{tr({ ar: 'اختر لكل عنصر ما يناسبه من القائمة.', fr: 'Associez chaque élément à sa correspondance.' })}</p>}
      <ul className="flex flex-col gap-2">
        {lefts(q).map((l) => {
          const chosen = pairs[l.id];
          const ok = reveal ? good[l.id] === chosen : null;
          const selectId = `m-${q.id}-${l.id}`;
          return (
            <li
              key={l.id}
              className={clsx(
                'flex flex-col gap-2 rounded-2xl border-2 bg-surface p-3 sm:flex-row sm:items-center',
                ok === true && 'border-success bg-success-soft',
                ok === false && 'border-danger bg-danger-soft',
                ok === null && 'border-border',
              )}
            >
              <label htmlFor={selectId} lang={q.language} dir="auto" className={clsx('flex-1 font-semibold', OPTION_TEXT[scale])}>{l.text}</label>
              <div className="flex items-center gap-2 sm:w-1/2">
                <Select
                  id={selectId}
                  value={chosen ?? ''}
                  disabled={locked}
                  onChange={(e) => {
                    const next = { ...pairs };
                    if (e.target.value) next[l.id] = e.target.value;
                    else delete next[l.id];
                    onChange({ kind: 'pairs', pairs: next });
                  }}
                  lang={q.language}
                  dir="auto"
                  className="min-h-11 flex-1"
                >
                  <option value="">{tr({ ar: '— اختر —', fr: '— Choisir —' })}</option>
                  {rs.map((r) => (
                    <option key={r.id} value={r.id}>{r.text}{used.has(r.id) && r.id !== chosen ? ' ✓' : ''}</option>
                  ))}
                </Select>
                {ok === true && <CircleCheck className="size-5 shrink-0 text-success" aria-label={tr({ ar: 'صحيح', fr: 'Correct' })} />}
                {ok === false && <CircleX className="size-5 shrink-0 text-danger" aria-label={tr({ ar: 'خطأ', fr: 'Faux' })} />}
              </div>
              {ok === false && good[l.id] && (
                <p className="text-sm font-semibold text-success sm:basis-full" lang={q.language} dir="auto">
                  {tr({ ar: 'الصحيح:', fr: 'Correct :' })} {rText(good[l.id])}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Read-only review of an answered question (results, mistakes, bookmarks). */
export function AnswerReview({ q, answer, scale = 0, hideUnanswered }: { q: QuestionDTO; answer: unknown; scale?: 0 | 1 | 2; hideUnanswered?: boolean }) {
  const tr = useT();
  if (q.correct === undefined) return null;
  const draft = draftFrom(q, answer);
  const unanswered = answer == null;
  const order = q.type === 'ORDERING' ? correctOrder(q.correct) : [];
  return (
    <div className="flex flex-col gap-2">
      {unanswered && !hideUnanswered && <p className="text-sm font-semibold text-warning">{tr({ ar: 'لم تُجب عن هذا السؤال.', fr: 'Question sans réponse.' })}</p>}
      {unanswered && q.type === 'ORDERING' ? (
        <div className="rounded-xl bg-success-soft p-3 text-sm">
          <p className="mb-1 font-semibold text-success">{tr({ ar: 'الترتيب الصحيح:', fr: 'Ordre correct :' })}</p>
          <ol className="list-decimal ps-5" lang={q.language} dir="auto">{order.map((id) => <li key={id}>{q.options.find((o) => o.id === id)?.text ?? id}</li>)}</ol>
        </div>
      ) : (
        <QuestionInput q={q} draft={draft} onChange={() => {}} reveal={{ correct: q.correct }} scale={scale} />
      )}
    </div>
  );
}

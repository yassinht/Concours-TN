'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useId, useState, type HTMLAttributes, type ReactNode, type SyntheticEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, CircleHelp, ExternalLink, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Confidence, ContentStatus, EditionStatus, SourceType } from '@ctn/shared';
import { Badge, Button, Field, Modal, Spinner, Textarea } from '@/components/ui';
import {
  CONFIDENCE_LABEL, CONFIDENCE_TONE, CONTENT_STATUS_LABEL, CONTENT_STATUS_TONE, describeError, EDITION_STATUS_LABEL, EDITION_STATUS_TONE, safeHref,
  SOURCE_TYPE_LABEL, SOURCE_TYPE_TONE,
} from './labels';
import type { SourceRef } from './types';

// ───────── Page scaffolding ─────────

export function AdminPage({ title, subtitle, actions, back, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        {back && (
          <Link href={back.href} className="-ms-1 inline-flex min-h-9 items-center gap-1 self-start rounded-lg px-1 text-sm font-semibold text-muted hover:text-text">
            <ArrowLeft className="size-4" aria-hidden />{back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-extrabold leading-tight">{title}</h1>
            {subtitle && <div className="text-sm text-muted">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  );
}

export function Section({ title, description, actions, children, className, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={clsx('card flex flex-col gap-3 p-4', className)} aria-labelledby={id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="text-lg font-bold">{title}</h2>
          {description && <div className="text-sm text-muted">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

// ───────── States ─────────

export function Loading({ label = 'Chargement…', className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex min-h-32 items-center justify-center gap-2 text-sm text-muted', className)} role="status">
      <Spinner className="size-5" /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const d = describeError(error);
  return (
    <div className={clsx('flex flex-col items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm', className)} role="alert">
      <p className="flex items-center gap-2 font-semibold text-danger"><TriangleAlert className="size-4" aria-hidden />{d.message}</p>
      {!!d.details.length && <ul className="list-disc ps-5 text-muted">{d.details.map((x, i) => <li key={i} dir="auto">{x}</li>)}</ul>}
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}><RotateCcw className="size-4" aria-hidden />Réessayer</Button>}
    </div>
  );
}

export function Empty({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

// ───────── Tables (always horizontally scrollable on small screens) ─────────

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}>{children}</div>;
}
export const tableCls = 'w-full min-w-[720px] border-collapse text-sm';
export const thCls = 'whitespace-nowrap border-b border-border px-2 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted';
export const tdCls = 'border-b border-border px-2 py-2 align-top';

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (total <= pageSize) return <p className="text-xs text-muted">{total.toLocaleString('fr-FR')} élément(s)</p>;
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pagination">
      <span className="text-muted">
        {((page - 1) * pageSize + 1).toLocaleString('fr-FR')}–{Math.min(total, page * pageSize).toLocaleString('fr-FR')} sur {total.toLocaleString('fr-FR')}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente"><ChevronLeft className="size-4" aria-hidden /></Button>
        <span className="px-2 tabular-nums">{page} / {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Page suivante"><ChevronRight className="size-4" aria-hidden /></Button>
      </div>
    </nav>
  );
}

// ───────── Badges ─────────

export function StatusBadge({ status }: { status: ContentStatus }) {
  return <Badge tone={CONTENT_STATUS_TONE[status] ?? 'neutral'}>{CONTENT_STATUS_LABEL[status] ?? status}</Badge>;
}

export function EditionStatusBadge({ status }: { status: EditionStatus }) {
  return <Badge tone={EDITION_STATUS_TONE[status] ?? 'neutral'}>{EDITION_STATUS_LABEL[status] ?? status}</Badge>;
}

export function ConfidenceBadge({ c }: { c: Confidence | string }) {
  const k = c as Confidence;
  return <Badge tone={CONFIDENCE_TONE[k] ?? 'neutral'} title="Confiance">Conf. {CONFIDENCE_LABEL[k] ?? c}</Badge>;
}

/** "À vérifier / للتحقق" — an unverified fact is a suggestion, never official. */
export function VerifyBadge({ needsVerification }: { needsVerification: boolean }) {
  return needsVerification
    ? <Badge tone="warning" title="Suggestion non vérifiée"><CircleHelp className="size-3.5" aria-hidden />À vérifier · <span lang="ar">للتحقق</span></Badge>
    : <Badge tone="success"><ShieldCheck className="size-3.5" aria-hidden />Vérifié</Badge>;
}

export function SourceLink({ source, compact }: { source: SourceRef | null; compact?: boolean }) {
  if (!source) return <span className="text-xs text-warning">Aucune source</span>;
  const href = safeHref(source.url);
  const type = source.sourceType as SourceType;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <Badge tone={SOURCE_TYPE_TONE[type] ?? 'neutral'}>{SOURCE_TYPE_LABEL[type] ?? source.sourceType}</Badge>
      {href
        ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-primary" dir="auto">{compact ? truncateTitle(source.title) : source.title}<ExternalLink className="size-3" aria-hidden /></a>
        : <span dir="auto">{compact ? truncateTitle(source.title) : source.title}</span>}
    </span>
  );
}
const truncateTitle = (t: string) => (t.length > 48 ? `${t.slice(0, 47)}…` : t);

// ───────── Inputs ─────────

export function Checkbox({ checked, onChange, label, id, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id?: string; disabled?: boolean; className?: string }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label htmlFor={cid} className={clsx('inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input id={cid} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-[var(--primary)]" />
      <span>{label}</span>
    </label>
  );
}

/** Toggle switch with a visible label (role="switch"). */
export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-semibold">{label}</label>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex min-h-9 shrink-0 items-center disabled:opacity-50">
        <span className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition', checked ? 'bg-primary' : 'bg-border')}>
          <span className={clsx('absolute size-5 rounded-full bg-white shadow transition-[inset-inline-start]', checked ? 'start-5' : 'start-0.5')} />
        </span>
      </button>
    </div>
  );
}

/** Comma/newline separated list editor (keywords, tags, specialties). */
export function ListInput({ value, onChange, id, placeholder, rows = 2, dir }: { value: string[]; onChange: (v: string[]) => void; id?: string; placeholder?: string; rows?: number; dir?: 'auto' | 'ltr' | 'rtl' }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    // Re-sync when the parent replaces the list (prefill), not on every keystroke.
    const parsed = splitList(text);
    if (parsed.join('\n') !== value.join('\n')) setText(value.join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Textarea
      id={id}
      rows={rows}
      dir={dir ?? 'auto'}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitList(e.target.value));
      }}
      className="min-h-16"
    />
  );
}
export const splitList = (s: string): string[] => s.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={clsx('max-h-80 overflow-auto rounded-lg bg-surface-2 p-2 text-xs leading-relaxed', className)} dir="ltr">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Key/value grid for detail panels. */
export function KV({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={clsx('grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ───────── Nested dialogs ─────────

/**
 * React re-dispatches a dialog's native "close" event to every ancestor's onClose (its synthetic bubbling), so closing a
 * dialog rendered inside another one would close both. Wrap nested dialogs in <IsolateDialog> to stop it there.
 */
const stopDialogEvents = {
  onClose: (e: SyntheticEvent) => e.stopPropagation(),
  onCancel: (e: SyntheticEvent) => e.stopPropagation(),
} as unknown as HTMLAttributes<HTMLDivElement>;
export function IsolateDialog({ children }: { children: ReactNode }) {
  return <div {...stopDialogEvents} className="contents">{children}</div>;
}

// ───────── Confirmation (destructive / irreversible actions) ─────────

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary' | 'accent';
  /** Ask for a comment (required when `commentRequired`). */
  comment?: { label: string; required?: boolean; placeholder?: string };
}

/**
 * Declarative confirm dialog: `const confirm = useConfirm(); … const r = await confirm.ask({...}); if (r) …` and render
 * `{confirm.element}` once. Resolves with `{ comment }` or null when cancelled.
 */
export function useConfirm() {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: { comment: string } | null) => void } | null>(null);
  const [comment, setComment] = useState('');
  const ask = (opts: ConfirmOptions) => new Promise<{ comment: string } | null>((resolve) => {
    setComment('');
    setState({ opts, resolve });
  });
  const close = (v: { comment: string } | null) => {
    state?.resolve(v);
    setState(null);
  };
  const o = state?.opts;
  const missing = !!o?.comment?.required && !comment.trim();
  const element = (
    <IsolateDialog>
    <Modal open={!!state} onClose={() => close(null)} title={o?.title ?? ''}>
      {o && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing) close({ comment: comment.trim() });
          }}
        >
          {o.body && <div className="text-sm">{o.body}</div>}
          {o.comment && (
            <Field label={o.comment.label} htmlFor="confirm-comment" hint={o.comment.required ? 'Obligatoire' : 'Optionnel'}>
              <Textarea id="confirm-comment" autoFocus value={comment} placeholder={o.comment.placeholder} onChange={(e) => setComment(e.target.value)} dir="auto" />
            </Field>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => close(null)}>Annuler</Button>
            <Button type="submit" variant={o.tone ?? 'danger'} disabled={missing} autoFocus={!o.comment}>{o.confirmLabel ?? 'Confirmer'}</Button>
          </div>
        </form>
      )}
    </Modal>
    </IsolateDialog>
  );
  return { ask, element };
}

/** Small stat tile with optional link and tone (dashboard). */
export function StatCard({ label, value, sub, href, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; href?: string; tone?: 'warning' | 'danger' | 'success' | 'primary' }) {
  const toneCls = tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : tone === 'primary' ? 'text-primary' : '';
  const inner = (
    <>
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className={clsx('text-2xl font-extrabold tabular-nums', toneCls)}>{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </>
  );
  return href
    ? <Link href={href} className="card flex flex-col gap-1 p-4 transition hover:border-primary/50">{inner}</Link>
    : <div className="card flex flex-col gap-1 p-4">{inner}</div>;
}

/** Horizontal bar with label + value (funnels, distributions). Width is relative to `max`. */
export function BarRow({ label, value, max, sub, tone = 'primary' }: { label: ReactNode; value: number; max: number; sub?: ReactNode; tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent' }) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  const bar = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info', accent: 'bg-accent' }[tone];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{value.toLocaleString('fr-FR')}{sub && <span className="ms-1 text-xs font-normal text-muted">{sub}</span>}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className={clsx('h-full rounded-full', bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Filters row: wraps on small screens. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2 [&>*]:min-w-36">{children}</div>;
}

/** Compact label + control used inside filter bars. */
export function FilterField({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-muted">{label}</label>
      {children}
    </div>
  );
}

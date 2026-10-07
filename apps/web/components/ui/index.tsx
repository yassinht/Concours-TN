'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';

// ───────── Button ─────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type Size = 'sm' | 'md' | 'lg';
const variantCls: Record<Variant, string> = {
  primary: 'bg-primary text-primary-contrast hover:opacity-90',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-2',
  ghost: 'bg-transparent text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
  accent: 'bg-accent text-white hover:opacity-90',
};
const sizeCls: Record<Size, string> = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-4 text-[15px]', lg: 'h-13 px-6 text-base min-h-12' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean; block?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, block, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={clsx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed', variantCls[variant], sizeCls[size], block && 'w-full', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = 'primary', size = 'md', block, className, children }: { href: string; variant?: Variant; size?: Size; block?: boolean; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={clsx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition', variantCls[variant], sizeCls[size], block && 'w-full', className)}>
      {children}
    </Link>
  );
}

// ───────── Card ─────────
export function Card({ className, children, as: As = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <As className={clsx('card p-4 sm:p-5', className)}>{children}</As>;
}

// ───────── Badge ─────────
type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
};
export function Badge({ tone = 'neutral', className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return <span title={title} className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', toneCls[tone], className)}>{children}</span>;
}

// ───────── Progress ─────────
export function ProgressBar({ value, tone = 'primary', className, label }: { value: number; tone?: 'primary' | 'success' | 'warning' | 'danger' | 'accent'; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const bar = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', accent: 'bg-accent' }[tone];
  return (
    <div className={clsx('h-2.5 w-full overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={clsx('h-full rounded-full transition-[width]', bar)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Color by score: <45 danger, <65 warning, else success */
export function scoreTone(score: number): 'danger' | 'warning' | 'success' {
  return score < 45 ? 'danger' : score < 65 ? 'warning' : 'success';
}

// ───────── Form fields ─────────
export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
const inputCls = 'h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px] outline-none focus:border-primary';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx(inputCls, className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={clsx(inputCls, 'appearance-auto', className)} {...p}>{children}</select>;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx(inputCls, 'h-auto min-h-24 py-2', className)} {...p} />;
});

// ───────── Misc ─────────
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-6 animate-spin text-primary', className)} aria-label="loading" />;
}

export function PageLoader() {
  return <div className="flex min-h-[40vh] items-center justify-center"><Spinner /></div>;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-8 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-xl bg-surface-2 p-3', className)}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const cls = { info: 'bg-info-soft text-info', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', success: 'bg-success-soft text-success' }[tone];
  return (
    <div className={clsx('rounded-xl p-3 text-sm', cls, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className="text-text/90">{children}</div>}
    </div>
  );
}

/** Native <dialog> modal. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(92vw,520px)] rounded-2xl border border-border bg-surface p-0 text-text backdrop:bg-black/40">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-bold">{title}</h2>
        <button onClick={onClose} className="rounded-lg p-1 hover:bg-surface-2" aria-label="close"><X className="size-5" /></button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.value} role="tab" aria-selected={tb.value === value} onClick={() => onChange(tb.value)}
          className={clsx('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition', tb.value === value ? 'bg-surface shadow-sm text-text' : 'text-muted hover:text-text')}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

'use client';

import clsx from 'clsx';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { describeError } from './labels';

type ToastTone = 'success' | 'danger' | 'info' | 'warning';
interface ToastItem { id: number; tone: ToastTone; title: string; body?: ReactNode; details?: string[] }
interface ToastApi {
  toast: (t: Omit<ToastItem, 'id'>, ms?: number) => void;
  /** Shows a failed API call with its translated code and details. */
  toastError: (e: unknown, title?: string) => void;
}

const ToastCtx = createContext<ToastApi>({ toast: () => {}, toastError: () => {} });
export const useToast = () => useContext(ToastCtx);

const ICON = { success: CircleCheck, danger: CircleAlert, info: Info, warning: TriangleAlert } as const;
const CLS: Record<ToastTone, string> = {
  success: 'border-success/40 bg-success-soft text-success',
  danger: 'border-danger/40 bg-danger-soft text-danger',
  info: 'border-info/40 bg-info-soft text-info',
  warning: 'border-warning/40 bg-warning-soft text-warning',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);

  const toast = useCallback((t: Omit<ToastItem, 'id'>, ms?: number) => {
    const id = next.current++;
    setItems((l) => [...l.slice(-3), { ...t, id }]);
    const life = ms ?? (t.tone === 'danger' ? 9000 : 5000);
    window.setTimeout(() => dismiss(id), life);
  }, [dismiss]);

  const toastError = useCallback((e: unknown, title?: string) => {
    const d = describeError(e);
    toast({ tone: 'danger', title: title ?? d.message, body: title ? d.message : undefined, details: d.details });
  }, [toast]);

  const value = useMemo(() => ({ toast, toastError }), [toast, toastError]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:end-4 sm:w-[400px]" aria-live="polite" role="status">
        {items.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <div key={t.id} className={clsx('pointer-events-auto flex w-full items-start gap-2 rounded-xl border p-3 text-sm shadow-lg', CLS[t.tone])}>
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1 text-text">
                <p className="font-semibold">{t.title}</p>
                {t.body && <div className="text-text/90">{t.body}</div>}
                {!!t.details?.length && (
                  <ul className="mt-1 list-disc ps-4 text-xs text-muted">
                    {t.details.map((d, i) => <li key={i} dir="auto">{d}</li>)}
                  </ul>
                )}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="rounded p-1 text-muted hover:bg-surface/60 hover:text-text" aria-label="Fermer">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

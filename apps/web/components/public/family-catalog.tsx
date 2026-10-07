'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, SearchX, X } from 'lucide-react';
import type { FamilySummaryDTO, Field } from '@ctn/shared';
import { Alert, Button, EmptyState, Spinner } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { FamilyCard } from './family-card';
import { FieldIcon } from './icons';
import { FIELDS, FIELD_LABELS, countLabel } from './labels';

function buildQuery(field: Field | null, q: string): string {
  const p = new URLSearchParams();
  if (field) p.set('field', field);
  if (q.trim()) p.set('q', q.trim());
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Catalog with field chips + search; server-rendered first page, then live filtering through /api/catalog/families. */
export function FamilyCatalog({ initial, initialField, initialQ, initialError }: { initial: FamilySummaryDTO[]; initialField: Field | null; initialQ: string; initialError: boolean }) {
  const tr = useT();
  const { locale } = useLocale();
  const [field, setField] = useState<Field | null>(initialField);
  const [q, setQ] = useState(initialQ);
  const [items, setItems] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [reloadKey, setReloadKey] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!initialError) return;
    }
    const ctrl = new AbortController();
    const query = buildQuery(field, q);
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const data = await api<FamilySummaryDTO[]>(`/catalog/families${query}`, { signal: ctrl.signal });
        setItems(data);
        // keep the URL shareable (Next keeps its router in sync with history.replaceState)
        window.history.replaceState(null, '', `/concours${query}`);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [field, q, reloadKey, initialError]);

  const openCount = items.filter((f) => f.nextEdition?.status === 'OPEN').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <label htmlFor="catalog-search" className="sr-only">{tr({ ar: 'ابحث عن مناظرة', fr: 'Rechercher un concours' })}</label>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="catalog-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr({ ar: 'ابحث: ديوانة، حرس، تعليم، ممرض…', fr: 'Rechercher : douane, garde, enseignant, infirmier…' })}
            className="h-12 w-full rounded-xl border border-border bg-surface ps-11 pe-11 text-[15px] outline-none focus:border-primary"
            enterKeyHint="search"
            autoComplete="off"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="absolute end-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label={tr({ ar: 'مسح البحث', fr: 'Effacer la recherche' })}>
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <div role="group" aria-label={tr({ ar: 'تصفية حسب المجال', fr: 'Filtrer par domaine' })} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip active={field === null} onClick={() => setField(null)}>{tr({ ar: 'الكل', fr: 'Tous' })}</Chip>
          {FIELDS.map((f) => (
            <Chip key={f} active={field === f} onClick={() => setField(field === f ? null : f)}>
              <FieldIcon field={f} className="size-4" />
              {tr(FIELD_LABELS[f])}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex min-h-6 items-center justify-between gap-2 text-sm text-muted" aria-live="polite">
        <span>
          {loading ? (
            <span className="inline-flex items-center gap-2"><Spinner className="size-4" />{tr({ ar: 'جارٍ البحث…', fr: 'Recherche…' })}</span>
          ) : !error ? (
            <>
              {countLabel(locale, items.length, 'concours')}
              {openCount > 0 && <> · <span className="font-semibold text-success">{tr({ ar: `مفتوحة الآن: ${openCount}`, fr: `ouverts maintenant : ${openCount}` })}</span></>}
            </>
          ) : null}
        </span>
      </div>

      {error ? (
        <Alert tone="danger" title={tr({ ar: 'تعذّر تحميل المناظرات', fr: 'Impossible de charger les concours' })}>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setReloadKey((k) => k + 1)}>{tr({ ar: 'أعد المحاولة', fr: 'Réessayer' })}</Button>
        </Alert>
      ) : items.length === 0 && !loading ? (
        <EmptyState
          icon={<SearchX className="size-8" aria-hidden />}
          title={tr({ ar: 'لا توجد نتائج', fr: 'Aucun résultat' })}
          body={tr({ ar: 'جرّب كلمة أخرى أو مجالًا آخر. وإن لم تجد مناظرتك، أعلمنا بها لنضيفها.', fr: 'Essayez un autre mot ou domaine. Si votre concours manque, signalez-le-nous.' })}
          action={<Link href="/#waitlist" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">{tr({ ar: 'اقترح مناظرة', fr: 'Proposer un concours' })}</Link>}
        />
      ) : (
        <ul className={clsx('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3', loading && 'opacity-60')}>
          {items.map((f) => (
            <li key={f.slug}><FamilyCard locale={locale} family={f} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition',
        active ? 'border-primary bg-primary text-primary-contrast' : 'border-border bg-surface text-text hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}

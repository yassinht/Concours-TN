'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import type { FactDTO } from '@ctn/shared';
import { ProgressBar } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { useLocale, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { ErrorState, Skeleton } from './bits';
import { bi } from './format';
import { useApi } from './use-api';

interface ChecklistGroup {
  positionSlug: string | null;
  positionTitle_ar: string | null;
  positionTitle_fr: string | null;
  items: (FactDTO & { checked: boolean })[];
}

/**
 * "Prepare my application file": the concours' required documents (published facts, each with its provenance),
 * ticked off by the candidate. Shows the common documents plus those of the given positions.
 */
export function DocumentChecklist({ familySlug, positionSlugs }: { familySlug: string; positionSlugs: (string | null)[] }) {
  const tr = useT();
  const { locale } = useLocale();
  const data = useApi<ChecklistGroup[]>(`/me/checklist/${encodeURIComponent(familySlug)}`);
  const [busy, setBusy] = useState<string | null>(null);

  const groups = useMemo(() => {
    const wanted = new Set(positionSlugs.filter(Boolean));
    const all = data.data ?? [];
    const relevant = all.filter((g) => g.positionSlug == null || wanted.size === 0 || wanted.has(g.positionSlug));
    return relevant.filter((g) => g.items.length > 0);
  }, [data.data, positionSlugs]);
  const items = groups.flatMap((g) => g.items);
  const done = items.filter((i) => i.checked).length;

  async function toggle(id: string, checked: boolean) {
    setBusy(id);
    data.setData((prev) => prev?.map((g) => ({ ...g, items: g.items.map((i) => (i.id === id ? { ...i, checked } : i)) })));
    try {
      await api(`/me/checklist/${id}`, { method: 'PUT', body: { checked } });
    } catch {
      data.setData((prev) => prev?.map((g) => ({ ...g, items: g.items.map((i) => (i.id === id ? { ...i, checked: !checked } : i)) })));
    } finally {
      setBusy(null);
    }
  }

  if (data.loading) return <Skeleton className="h-24" />;
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  if (items.length === 0) {
    return <p className="text-sm text-muted">{tr({ ar: 'لم تُنشر قائمة الوثائق المطلوبة بعد — راجع البلاغ الرسمي.', fr: 'La liste des pièces n’est pas encore publiée — consultez l’avis officiel.' })}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <FileCheck2 className="size-5 shrink-0 text-primary" aria-hidden />
        <ProgressBar value={(done / items.length) * 100} tone={done === items.length ? 'success' : 'primary'} label={tr({ ar: 'تقدم ملف الترشح', fr: 'Avancement du dossier' })} />
        <span className="shrink-0 text-sm font-semibold tabular-nums">{done}/{items.length}</span>
      </div>
      {groups.map((g) => (
        <div key={g.positionSlug ?? 'common'} className="flex flex-col gap-1.5">
          {groups.length > 1 && (
            <p className="text-xs font-bold text-muted">{g.positionSlug ? bi(locale, g.positionTitle_ar, g.positionTitle_fr) : tr({ ar: 'وثائق مشتركة', fr: 'Pièces communes' })}</p>
          )}
          <ul className="flex flex-col gap-1">
            {g.items.map((i) => (
              <li key={i.id}>
                <label className={clsx('flex min-h-11 cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-surface-2', busy === i.id && 'opacity-60')}>
                  <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" checked={i.checked} disabled={busy === i.id} onChange={(e) => toggle(i.id, e.target.checked)} />
                  <span className="flex flex-col gap-1 text-sm">
                    <span className={clsx(i.checked && 'text-muted line-through')}>{bi(locale, i.display_ar, i.display_fr)}</span>
                    {(locale === 'fr' ? i.details_fr ?? i.details_ar : i.details_ar ?? i.details_fr) && (
                      <span className="text-xs text-muted">{bi(locale, i.details_ar, i.details_fr)}</span>
                    )}
                    <ProvenanceBadge p={i} compact />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

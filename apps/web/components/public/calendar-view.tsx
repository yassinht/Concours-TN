'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CalendarX } from 'lucide-react';
import type { EditionDTO, Field } from '@ctn/shared';
import { EmptyState } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { formatDate } from '@/lib/i18n';
import { CalendarSubscribe } from './calendar-subscribe';
import { EditionStatusBadge } from './edition-status';
import { FollowButton } from './follow-button';
import { FieldIcon } from './icons';
import { FIELDS, FIELD_LABELS, KEY_DATE_LABELS, daysFromToday, deadlineCountdown, editionTitle, inDays, keyDateOf, sessionLabelFor } from './labels';

type StatusFilter = 'all' | 'open' | 'upcoming';

/** Upcoming / open editions grouped by the month of their next key date, with field + status filters. */
export function CalendarView({ editions, initialField }: { editions: EditionDTO[]; initialField: Field | null }) {
  const tr = useT();
  const { locale } = useLocale();
  const [field, setField] = useState<Field | null>(initialField);
  const [status, setStatus] = useState<StatusFilter>('all');

  const presentFields = useMemo(() => new Set(editions.map((e) => e.field)), [editions]);

  const groups = useMemo(() => {
    const filtered = editions.filter((e) =>
      (!field || e.field === field)
      && (status === 'all' || (status === 'open' ? e.status === 'OPEN' : e.status !== 'OPEN')));
    const withKey = filtered.map((e) => ({ e, key: keyDateOf(e) })).sort((a, b) => (a.key.date ?? '9999').localeCompare(b.key.date ?? '9999'));
    const map = new Map<string, typeof withKey>();
    for (const item of withKey) {
      const month = item.key.date ? item.key.date.slice(0, 7) : 'undated';
      (map.get(month) ?? map.set(month, []).get(month)!).push(item);
    }
    return [...map.entries()];
  }, [editions, field, status]);

  function selectField(f: Field | null) {
    setField(f);
    const url = f ? `/calendar?field=${f}` : '/calendar';
    window.history.replaceState(null, '', url);
  }

  const chip = (active: boolean) => clsx(
    'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition',
    active ? 'border-primary bg-primary text-primary-contrast' : 'border-border bg-surface hover:bg-surface-2',
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div role="group" aria-label={tr({ ar: 'تصفية حسب الحالة', fr: 'Filtrer par statut' })} className="flex flex-wrap gap-2">
          {([
            ['all', { ar: 'الكل', fr: 'Tout' }],
            ['open', { ar: 'التسجيل مفتوح', fr: 'Inscriptions ouvertes' }],
            ['upcoming', { ar: 'مواعيد قادمة', fr: 'Échéances à venir' }],
          ] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={chip(status === v)}>{tr(label)}</button>
          ))}
        </div>
        <div role="group" aria-label={tr({ ar: 'تصفية حسب المجال', fr: 'Filtrer par domaine' })} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button type="button" aria-pressed={field === null} onClick={() => selectField(null)} className={chip(field === null)}>{tr({ ar: 'كل المجالات', fr: 'Tous les domaines' })}</button>
          {FIELDS.filter((f) => presentFields.has(f) || f === field).map((f) => (
            <button key={f} type="button" aria-pressed={field === f} onClick={() => selectField(field === f ? null : f)} className={chip(field === f)}>
              <FieldIcon field={f} className="size-4" />
              {tr(FIELD_LABELS[f])}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<CalendarX className="size-8" aria-hidden />}
          title={tr({ ar: 'لا توجد مواعيد مطابقة', fr: 'Aucune date correspondante' })}
          body={tr({ ar: 'جرّب مجالًا آخر، أو فعّل التنبيهات لنعلمك عند الإعلان عن مناظرة تناسبك.', fr: 'Essayez un autre domaine, ou activez les alertes pour être prévenu(e) d’un concours qui vous correspond.' })}
          action={<Link href="/alerts" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">{tr({ ar: 'فعّل التنبيهات', fr: 'Activer les alertes' })}</Link>}
        />
      ) : (
        groups.map(([month, items]) => (
          <section key={month} aria-labelledby={`m-${month}`} className="flex flex-col gap-3">
            <h2 id={`m-${month}`} className="border-b border-border pb-2 text-lg font-extrabold">
              {month === 'undated' ? tr({ ar: 'دون تاريخ محدد بعد', fr: 'Sans date annoncée' }) : formatDate(locale, `${month}-01`, { month: 'long', year: 'numeric' })}
            </h2>
            <ul className="flex flex-col gap-3">
              {items.map(({ e, key }) => {
                const days = daysFromToday(key.date);
                const rel = key.kind === 'deadline' && e.status === 'OPEN' ? deadlineCountdown(locale, days) : inDays(locale, days);
                return (
                  <li key={e.id} className="card flex gap-3 p-3 sm:p-4">
                    <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 py-2 text-center">
                      {key.date ? (
                        <>
                          <span className="text-xl font-extrabold tabular-nums leading-none">{Number(key.date.slice(8, 10))}</span>
                          <span className="mt-1 text-[11px] text-muted">{formatDate(locale, key.date, { month: 'short' })}</span>
                        </>
                      ) : <span className="text-muted">—</span>}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex items-center gap-1.5 text-xs text-muted"><FieldIcon field={e.field} className="size-3.5" />{tr(FIELD_LABELS[e.field])}</span>
                      <Link href={`/concours/${e.familySlug}`} className="font-bold hover:text-primary hover:underline">{editionTitle(locale, e)}</Link>
                      {e.sessionLabel && <p className="line-clamp-2 text-xs text-muted" dir="auto">{sessionLabelFor(locale, e.sessionLabel)}</p>}
                      <EditionStatusBadge locale={locale} edition={e} countdown={false} />
                      {key.kind && (
                        <p className="text-sm text-muted">
                          {tr(KEY_DATE_LABELS[key.kind])}: <span className="font-semibold text-text">{formatDate(locale, key.date)}</span>
                          {rel && <span className={clsx('ms-1', e.status === 'OPEN' && days != null && days <= 3 && 'font-semibold text-danger')}>({rel})</span>}
                        </p>
                      )}
                      {e.positionsCount != null && <p className="text-xs text-muted">{tr({ ar: 'عدد الخطط', fr: 'Postes' })}: <span className="font-semibold tabular-nums text-text">{e.positionsCount}</span></p>}
                      <div className="pt-1">
                        <FollowButton slug={e.familySlug} variant="compact" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold">{tr({ ar: 'تابع المواعيد من رزنامة هاتفك', fr: 'Suivez les dates depuis l’agenda de votre téléphone' })}</p>
        <p className="text-xs text-muted">{tr({ ar: 'تتحدّث تلقائيًا عند تغيّر التواريخ. التواريخ غير المؤكدة تحمل عبارة «للتحقق».', fr: 'Mise à jour automatique quand les dates changent. Les dates non confirmées portent la mention « À vérifier ».' })}</p>
        <CalendarSubscribe field={field} />
      </div>
    </div>
  );
}

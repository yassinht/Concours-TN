import { ExternalLink } from 'lucide-react';
import type { EditionDTO, Locale } from '@ctn/shared';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { formatDate, t } from '@/lib/i18n';
import { EditionStatusBadge } from './edition-status';
import { KEY_DATE_LABELS, daysFromToday, inDays, sessionLabelFor } from './labels';

const lastDate = (e: EditionDTO) => [e.registrationOpen, e.registrationDeadline, e.examDate].filter(Boolean).sort().at(-1) ?? '';

export function EditionDates({ locale, edition }: { locale: Locale; edition: EditionDTO }) {
  const rows: { kind: 'open' | 'deadline' | 'exam'; date: string | null }[] = [
    { kind: 'open', date: edition.registrationOpen },
    { kind: 'deadline', date: edition.registrationDeadline },
    { kind: 'exam', date: edition.examDate },
  ];
  if (rows.every((r) => !r.date)) {
    return <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">{t(locale, { ar: 'لم تُعلن التواريخ بعد.', fr: 'Dates pas encore annoncées.' })}</p>;
  }
  return (
    <dl className="grid grid-cols-3 gap-1.5 sm:gap-2">
      {rows.map((r) => {
        const rel = r.date ? inDays(locale, daysFromToday(r.date)) : null;
        return (
          <div key={r.kind} className="rounded-xl bg-surface-2 p-2 sm:p-3">
            <dt className="text-[11px] leading-tight text-muted sm:text-xs">{t(locale, KEY_DATE_LABELS[r.kind])}</dt>
            <dd className="mt-1 text-sm font-semibold sm:text-[15px]">
              {r.date ? formatDate(locale, r.date) : <span className="font-normal text-muted"><span aria-hidden>—</span><span className="sr-only">{t(locale, { ar: 'غير محدد بعد', fr: 'Non communiqué' })}</span></span>}
              {rel && <span className="block text-xs font-normal text-muted">{rel}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** All editions of a family, most recent first, each with its dates, status and source. */
export function EditionsTimeline({ locale, editions }: { locale: Locale; editions: EditionDTO[] }) {
  const sorted = [...editions].sort((a, b) => b.year - a.year || lastDate(b).localeCompare(lastDate(a)));
  return (
    <ol className="relative flex flex-col gap-5 border-s-2 border-border ps-5">
      {sorted.map((e) => (
        <li key={e.id} className="relative flex flex-col gap-2">
          <span className={`absolute -start-[27px] top-1.5 size-3 rounded-full ring-4 ring-bg ${e.status === 'OPEN' ? 'bg-success' : 'bg-border'}`} aria-hidden />
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold tabular-nums">{e.year}</span>
            <EditionStatusBadge locale={locale} edition={e} provenance={false} />
          </div>
          {e.sessionLabel && <p className="text-sm text-muted" dir="auto">{sessionLabelFor(locale, e.sessionLabel)}</p>}
          <EditionDates locale={locale} edition={e} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {e.positionsCount != null && <span>{t(locale, { ar: 'عدد الخطط', fr: 'Postes' })}: <span className="font-semibold tabular-nums text-text">{e.positionsCount}</span></span>}
            {e.candidatesCount != null && <span>{t(locale, { ar: 'عدد المترشحين', fr: 'Candidats' })}: <span className="font-semibold tabular-nums text-text">{e.candidatesCount.toLocaleString('fr-FR')}</span></span>}
            {e.announcementUrl && (
              <a href={e.announcementUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary hover:underline">
                {t(locale, e.source?.sourceType === 'OFFICIAL' ? { ar: 'البلاغ الرسمي', fr: 'Avis officiel' } : { ar: 'رابط الإعلان', fr: 'Lien de l’annonce' })}<ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
          <div><ProvenanceBadge p={e} /></div>
        </li>
      ))}
    </ol>
  );
}

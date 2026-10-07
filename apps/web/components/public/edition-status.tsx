import clsx from 'clsx';
import { CalendarClock, Hourglass } from 'lucide-react';
import type { EditionDTO, Locale } from '@ctn/shared';
import { Badge } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { formatDate, t } from '@/lib/i18n';
import { EDITION_STATUS_LABELS, KEY_DATE_LABELS, daysFromToday, deadlineCountdown, inDays, keyDateOf } from './labels';

/** Status badge of an edition: "التسجيل مفتوح" (green) + live countdown + provenance (unverified dates say so). */
export function EditionStatusBadge({ locale, edition, countdown = true, provenance = true, className }: {
  locale: Locale; edition: EditionDTO; countdown?: boolean; provenance?: boolean; className?: string;
}) {
  const st = EDITION_STATUS_LABELS[edition.status];
  const key = keyDateOf(edition);
  const days = daysFromToday(key.date);
  const countdownText = key.kind === 'deadline' && edition.status === 'OPEN' ? deadlineCountdown(locale, days) : null;
  const urgent = countdownText != null && days != null && days <= 3;
  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-1.5', className)}>
      <Badge tone={st.tone}>
        {edition.status === 'OPEN' && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
        {t(locale, st)}
      </Badge>
      {countdown && countdownText && (
        <Badge tone={urgent ? 'danger' : 'warning'}>
          <Hourglass className="size-3.5" aria-hidden />
          {countdownText}
        </Badge>
      )}
      {provenance && <ProvenanceBadge p={edition} compact />}
    </span>
  );
}

/** One line "آخر أجل للترشح: 31 ديسمبر 2026 (بعد 12 يومًا)". */
export function KeyDateLine({ locale, edition, className }: { locale: Locale; edition: EditionDTO; className?: string }) {
  const key = keyDateOf(edition);
  if (!key.date || !key.kind) return null;
  const rel = key.kind === 'deadline' && edition.status === 'OPEN' ? null : inDays(locale, daysFromToday(key.date));
  return (
    <p className={clsx('flex items-center gap-1.5 text-sm text-muted', className)}>
      <CalendarClock className="size-4 shrink-0" aria-hidden />
      <span>
        {t(locale, KEY_DATE_LABELS[key.kind])}: <span className="font-semibold text-text">{formatDate(locale, key.date)}</span>
        {rel && <span> ({rel})</span>}
      </span>
    </p>
  );
}

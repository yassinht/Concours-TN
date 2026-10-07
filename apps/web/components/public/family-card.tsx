import Link from 'next/link';
import { Building2, ChevronLeft, ChevronRight, FileQuestion, Users } from 'lucide-react';
import type { FamilySummaryDTO, Locale } from '@ctn/shared';
import { Badge } from '@/components/ui';
import { t } from '@/lib/i18n';
import { EditionStatusBadge, KeyDateLine } from './edition-status';
import { FieldIcon } from './icons';
import { FIELD_LABELS, countLabel, loc } from './labels';

/** Catalog card. Whole card is the link; no nested interactive elements. */
export function FamilyCard({ locale, family, headingLevel = 'h2' }: { locale: Locale; family: FamilySummaryDTO; headingLevel?: 'h2' | 'h3' }) {
  const H = headingLevel;
  const Chevron = locale === 'ar' ? ChevronLeft : ChevronRight;
  const open = family.nextEdition?.status === 'OPEN';
  return (
    <Link
      href={`/concours/${family.slug}`}
      className={`card group flex h-full flex-col gap-3 p-4 transition hover:border-primary sm:p-5 ${open ? 'border-success/60' : ''}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <FieldIcon field={family.field} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-xs text-muted">
            <Building2 className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{loc(locale, family.organization, 'name')}</span>
          </p>
          <H className="mt-0.5 line-clamp-2 font-bold leading-snug group-hover:text-primary">{loc(locale, family, 'name')}</H>
        </div>
        <Chevron className="mt-1 size-5 shrink-0 text-muted transition group-hover:text-primary" aria-hidden />
      </div>

      {family.nextEdition ? (
        <div className="flex flex-col gap-1.5">
          <EditionStatusBadge locale={locale} edition={family.nextEdition} />
          <KeyDateLine locale={locale} edition={family.nextEdition} />
        </div>
      ) : (
        <p className="text-sm text-muted">{t(locale, { ar: 'لا توجد دورة معلنة حاليًا', fr: 'Aucune session annoncée pour le moment' })}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs text-muted">
        <Badge tone="neutral">{t(locale, FIELD_LABELS[family.field])}</Badge>
        <span className="inline-flex items-center gap-1"><Users className="size-3.5" aria-hidden />{countLabel(locale, family.positionsCount, 'position')}</span>
        {family.questionCount > 0 && <span className="inline-flex items-center gap-1"><FileQuestion className="size-3.5" aria-hidden />{countLabel(locale, family.questionCount, 'question')}</span>}
      </div>
    </Link>
  );
}

import clsx from 'clsx';
import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react';
import type { EligibilityResult, Locale, Provenance } from '@ctn/shared';
import { Badge } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { t } from '@/lib/i18n';

export interface EligibilityRow { positionSlug: string; title_ar: string; title_fr: string; result: EligibilityResult; provenance: Provenance }

const STATUS = {
  ELIGIBLE: { tone: 'success', icon: CircleCheck, text: { ar: 'تستوفي الشروط المعلنة', fr: 'Vous remplissez les conditions annoncées' } },
  PARTIAL: { tone: 'warning', icon: CircleHelp, text: { ar: 'معطيات ناقصة للحسم', fr: 'Informations manquantes pour conclure' } },
  NOT_ELIGIBLE: { tone: 'danger', icon: CircleX, text: { ar: 'لا تستوفي شرطًا أو أكثر', fr: 'Une condition ou plus n’est pas remplie' } },
} as const;

const CHECK = {
  OK: { icon: CircleCheck, cls: 'text-success', sr: { ar: 'مستوفى', fr: 'Rempli' } },
  FAIL: { icon: CircleX, cls: 'text-danger', sr: { ar: 'غير مستوفى', fr: 'Non rempli' } },
  UNKNOWN: { icon: CircleHelp, cls: 'text-warning', sr: { ar: 'غير معروف', fr: 'Inconnu' } },
} as const;

export function EligibilityStatusBadge({ locale, status }: { locale: Locale; status: EligibilityResult['status'] }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return <Badge tone={s.tone}><Icon className="size-3.5" aria-hidden />{t(locale, s.text)}</Badge>;
}

/** Result of one position: ✓ / ✗ / ? per condition, free-text conditions, and the "rules unverified" warning. */
export function EligibilityResultCard({ locale, row, headingLevel = 'h3' }: { locale: Locale; row: EligibilityRow; headingLevel?: 'h2' | 'h3' }) {
  const H = headingLevel;
  const { result } = row;
  const other = locale === 'fr' && result.other_fr.length ? result.other_fr : result.other_ar.length ? result.other_ar : result.other_fr;
  return (
    <article className={clsx('card flex flex-col gap-3 p-4 sm:p-5', result.status === 'ELIGIBLE' && 'border-success/50', result.status === 'NOT_ELIGIBLE' && 'border-danger/40')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H className="font-bold">{locale === 'fr' ? row.title_fr : row.title_ar}</H>
        <EligibilityStatusBadge locale={locale} status={result.status} />
      </div>

      {result.checks.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {result.checks.map((c, i) => {
            const k = CHECK[c.status];
            const Icon = k.icon;
            return (
              <li key={`${c.code}-${i}`} className="flex items-start gap-2 text-[15px]">
                <Icon className={clsx('mt-0.5 size-5 shrink-0', k.cls)} aria-hidden />
                <span><span className="sr-only">{t(locale, k.sr)}: </span>{locale === 'fr' ? c.message_fr : c.message_ar}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t(locale, { ar: 'لا توجد شروط قابلة للتحقق الآلي لهذه الرتبة.', fr: 'Aucune condition vérifiable automatiquement pour ce grade.' })}</p>
      )}

      {other.length > 0 && (
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-sm font-semibold">{t(locale, { ar: 'شروط أخرى تحقق منها بنفسك', fr: 'Autres conditions à vérifier vous-même' })}</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-sm text-muted">
            {other.map((o, i) => <li key={i} dir="auto">{o}</li>)}
          </ul>
        </div>
      )}

      {result.rules_unverified && (
        <p className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t(locale, {
            ar: 'شروط هذه الرتبة مقترحة ولم يتم التحقق منها في البلاغ الرسمي بعد. النتيجة تقديرية: راجع البلاغ قبل الترشح.',
            fr: 'Les conditions de ce grade sont des suggestions non vérifiées dans l’avis officiel. Résultat indicatif : consultez l’avis avant de candidater.',
          })}
        </p>
      )}
      <div><ProvenanceBadge p={row.provenance} /></div>
    </article>
  );
}

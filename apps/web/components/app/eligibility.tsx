'use client';

import clsx from 'clsx';
import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react';
import type { EligibilityResult } from '@ctn/shared';
import { Badge } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';

export const ELIGIBILITY_STATUS = {
  ELIGIBLE: { tone: 'success', icon: CircleCheck, text: { ar: 'تستوفي الشروط المعلنة', fr: 'Conditions remplies' } },
  PARTIAL: { tone: 'warning', icon: CircleHelp, text: { ar: 'معطيات ناقصة للحسم', fr: 'Infos manquantes' } },
  NOT_ELIGIBLE: { tone: 'danger', icon: CircleX, text: { ar: 'شرط غير مستوفى', fr: 'Condition non remplie' } },
} as const;

const CHECK = {
  OK: { icon: CircleCheck, cls: 'text-success', sr: { ar: 'مستوفى', fr: 'Rempli' } },
  FAIL: { icon: CircleX, cls: 'text-danger', sr: { ar: 'غير مستوفى', fr: 'Non rempli' } },
  UNKNOWN: { icon: CircleHelp, cls: 'text-warning', sr: { ar: 'غير معروف', fr: 'Inconnu' } },
} as const;

export const STATUS_RANK: Record<EligibilityResult['status'], number> = { ELIGIBLE: 0, PARTIAL: 1, NOT_ELIGIBLE: 2 };

export function EligibilityBadge({ status, className }: { status: EligibilityResult['status']; className?: string }) {
  const tr = useT();
  const s = ELIGIBILITY_STATUS[status];
  const Icon = s.icon;
  return <Badge tone={s.tone} className={className}><Icon className="size-3.5" aria-hidden />{tr(s.text)}</Badge>;
}

/** ✓ / ✗ / ? per condition, free-text conditions and the "rules not verified" warning. Icons + text, never colour alone. */
export function EligibilityChecks({ result, className }: { result: EligibilityResult; className?: string }) {
  const tr = useT();
  const { locale } = useLocale();
  const other = locale === 'fr' && result.other_fr.length ? result.other_fr : result.other_ar.length ? result.other_ar : result.other_fr;
  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      {result.checks.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {result.checks.map((c) => {
            const m = CHECK[c.status];
            const Icon = m.icon;
            return (
              <li key={c.code} className="flex items-start gap-2 text-sm">
                <Icon className={clsx('mt-0.5 size-4 shrink-0', m.cls)} aria-hidden />
                <span><span className="sr-only">{tr(m.sr)}: </span>{locale === 'fr' ? c.message_fr : c.message_ar}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">{tr({ ar: 'لا توجد شروط يمكن التحقق منها آليًا لهذه الخطة — راجع الإعلان الرسمي.', fr: 'Aucune condition vérifiable automatiquement pour ce poste — consultez l’avis officiel.' })}</p>
      )}
      {other.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold">{tr({ ar: 'شروط أخرى (تحقق منها بنفسك):', fr: 'Autres conditions (à vérifier vous-même) :' })}</p>
          <ul className="list-inside list-disc text-muted">
            {other.map((o) => <li key={o} dir="auto">{o}</li>)}
          </ul>
        </div>
      )}
      {result.rules_unverified && (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {tr({
              ar: 'هذه الشروط مقترحة ولم يتم التحقق منها رسميًا بعد (للتحقق). اعتمد دائمًا على البلاغ الرسمي للمناظرة.',
              fr: 'Conditions suggérées, pas encore vérifiées officiellement (à vérifier). Référez-vous toujours à l’avis officiel.',
            })}
          </span>
        </p>
      )}
    </div>
  );
}

/** True when completing the profile could change the verdict (some checks are UNKNOWN). */
export function needsProfileData(result: EligibilityResult): boolean {
  return result.checks.some((c) => c.status === 'UNKNOWN');
}

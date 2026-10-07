import type { DiplomaLevel, EligibilityRules, Locale } from '@ctn/shared';
import { t } from '@/lib/i18n';
import { DIPLOMA_LABELS } from './labels';

export interface RuleLine {
  code: 'AGE' | 'GENDER' | 'NATIONALITY' | 'DIPLOMA' | 'SPECIALTY' | 'HEIGHT' | 'MARITAL' | 'OTHER';
  text: string;
  /** List values (accepted specialties), rendered separately so mixed Arabic/Latin entries keep their direction. */
  items?: string[];
}

const TUNISIAN = /^(tn|tun|tunisi(a|e|an|enne)?|تونسية?)$/i;

/** Human-readable conditions of a position, in the order candidates check them. */
export function rulesToLines(locale: Locale, rules: EligibilityRules): RuleLine[] {
  const out: RuleLine[] = [];
  const { min_age: min, max_age: max } = rules;
  if (min != null && max != null) out.push({ code: 'AGE', text: t(locale, { ar: `السن: بين ${min} و${max} سنة`, fr: `Âge : entre ${min} et ${max} ans` }) });
  else if (max != null) out.push({ code: 'AGE', text: t(locale, { ar: `السن: ${max} سنة على أقصى تقدير`, fr: `Âge : ${max} ans au plus` }) });
  else if (min != null) out.push({ code: 'AGE', text: t(locale, { ar: `السن: ${min} سنة على الأقل`, fr: `Âge : ${min} ans au moins` }) });

  if (rules.genders?.length === 1) {
    out.push({ code: 'GENDER', text: rules.genders[0] === 'M' ? t(locale, { ar: 'مفتوحة للذكور فقط', fr: 'Réservé aux hommes' }) : t(locale, { ar: 'مفتوحة للإناث فقط', fr: 'Réservé aux femmes' }) });
  }

  if (rules.nationality) {
    out.push({ code: 'NATIONALITY', text: TUNISIAN.test(rules.nationality.trim()) ? t(locale, { ar: 'الجنسية التونسية', fr: 'Nationalité tunisienne' }) : `${t(locale, { ar: 'الجنسية', fr: 'Nationalité' })}: ${rules.nationality}` });
  }

  const diplomaLabel = (d: DiplomaLevel) => t(locale, DIPLOMA_LABELS[d]);
  if (rules.diplomas?.length) {
    out.push({ code: 'DIPLOMA', text: `${t(locale, { ar: 'الشهادة المطلوبة', fr: 'Diplôme requis' })}: ${rules.diplomas.map(diplomaLabel).join(locale === 'ar' ? '، ' : ', ')}` });
  } else if (rules.min_diploma) {
    out.push({ code: 'DIPLOMA', text: `${t(locale, { ar: 'المستوى الدراسي الأدنى', fr: 'Niveau minimum' })}: ${diplomaLabel(rules.min_diploma)}` });
  }

  if (rules.specialties?.length) {
    out.push({ code: 'SPECIALTY', text: t(locale, { ar: 'الاختصاصات المقبولة', fr: 'Spécialités acceptées' }), items: rules.specialties });
  }

  const hm = rules.min_height_cm_male;
  const hf = rules.min_height_cm_female;
  if (hm != null || hf != null) {
    const parts = [
      hm != null ? t(locale, { ar: `${hm} صم للذكور`, fr: `${hm} cm (hommes)` }) : null,
      hf != null ? t(locale, { ar: `${hf} صم للإناث`, fr: `${hf} cm (femmes)` }) : null,
    ].filter(Boolean);
    out.push({ code: 'HEIGHT', text: `${t(locale, { ar: 'الطول الأدنى', fr: 'Taille minimale' })}: ${parts.join(locale === 'ar' ? '، ' : ', ')}` });
  }

  if (rules.marital_status === 'SINGLE') out.push({ code: 'MARITAL', text: t(locale, { ar: 'أن يكون المترشح أعزب / عزباء', fr: 'Être célibataire' }) });

  const preferred = locale === 'fr' ? rules.other_fr : rules.other_ar;
  const fallback = locale === 'fr' ? rules.other_ar : rules.other_fr;
  for (const o of (preferred?.length ? preferred : fallback) ?? []) out.push({ code: 'OTHER', text: o });
  return out;
}

import { DIPLOMA_LEVELS, GENDERS, type DiplomaLevel, type EligibilityRules, type Gender } from '@ctn/shared';
import { intIn, isObj, oneOfOrNull, str, strArr } from './normalize';

const SINGLE_WORDS = ['SINGLE', 'CELIBATAIRE', 'CÉLIBATAIRE', 'أعزب', 'عزباء', 'غير متزوج', 'غير متزوجة'];

function maritalStatus(v: unknown): 'SINGLE' | null {
  const s = str(v);
  if (!s) return null;
  const up = s.toUpperCase();
  return SINGLE_WORDS.some((w) => up.includes(w.toUpperCase())) ? 'SINGLE' : null;
}

/**
 * Maps a content-file eligibility block onto EligibilityRules (stored in positions.eligibility).
 * Diploma semantics: a single listed diploma equal to the position level means "at least this level"
 * (research files list the announced level, and holders of higher degrees are not excluded by it);
 * several listed diplomas are an explicit accepted list.
 */
export function mapEligibility(raw: unknown, diplomaLevel: DiplomaLevel, warn: (m: string) => void): EligibilityRules {
  const e = isObj(raw) ? raw : {};
  const diplomas = [...new Set(strArr(e.diplomas).map((d) => oneOfOrNull<DiplomaLevel>(d, DIPLOMA_LEVELS, warn, 'eligibility.diplomas')).filter((d): d is DiplomaLevel => !!d))];
  const explicitList = diplomas.length > 1 || (diplomas.length === 1 && diplomas[0] !== diplomaLevel);
  const genders = [...new Set(strArr(e.genders).map((g) => oneOfOrNull<Gender>(g, GENDERS, warn, 'eligibility.genders')).filter((g): g is Gender => !!g))];

  let minAge = intIn(e.min_age, 14, 70, warn, 'eligibility.min_age');
  let maxAge = intIn(e.max_age, 14, 70, warn, 'eligibility.max_age');
  if (minAge != null && maxAge != null && minAge > maxAge) {
    warn(`eligibility min_age ${minAge} > max_age ${maxAge} — swapped`);
    [minAge, maxAge] = [maxAge, minAge];
  }

  return {
    min_age: minAge,
    max_age: maxAge,
    genders: genders.length ? genders : null,
    nationality: str(e.nationality),
    min_diploma: explicitList ? null : diplomaLevel,
    diplomas: explicitList ? diplomas : null,
    specialties: strArr(e.specialties).length ? strArr(e.specialties) : null,
    min_height_cm_male: intIn(e.min_height_cm_male, 120, 230, warn, 'eligibility.min_height_cm_male'),
    min_height_cm_female: intIn(e.min_height_cm_female, 120, 230, warn, 'eligibility.min_height_cm_female'),
    marital_status: maritalStatus(e.marital_status),
    other_ar: strArr(e.other_ar),
    other_fr: strArr(e.other_fr),
    needs_verification: typeof e.needs_verification === 'boolean' ? e.needs_verification : true,
  };
}

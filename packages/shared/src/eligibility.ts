import { DIPLOMA_RANK, DiplomaLevel, Gender } from './enums';

/** Eligibility rules of a position, as stored in positions.eligibility (jsonb). All fields optional. */
export interface EligibilityRules {
  min_age?: number | null;
  max_age?: number | null;
  genders?: Gender[] | null;
  nationality?: string | null;
  /** Minimum diploma (inclusive). Usually the position's diploma_level. */
  min_diploma?: DiplomaLevel | null;
  /** Exact accepted diplomas (if set, overrides min_diploma for the diploma check). */
  diplomas?: DiplomaLevel[] | null;
  /** Accepted specialties (free text, matched case-insensitively against the user's specialties). */
  specialties?: string[] | null;
  min_height_cm_male?: number | null;
  min_height_cm_female?: number | null;
  marital_status?: 'SINGLE' | null;
  other_ar?: string[];
  other_fr?: string[];
  needs_verification?: boolean;
}

export interface CandidateProfile {
  birth_date?: string | null; // YYYY-MM-DD
  gender?: Gender | null;
  diploma_level?: DiplomaLevel | null;
  specialties?: string[] | null;
  height_cm?: number | null;
  marital_status?: 'SINGLE' | 'MARRIED' | 'OTHER' | null;
  nationality?: string | null;
}

export type CheckStatus = 'OK' | 'FAIL' | 'UNKNOWN';

export interface EligibilityCheck {
  code: 'AGE' | 'GENDER' | 'DIPLOMA' | 'SPECIALTY' | 'HEIGHT' | 'MARITAL' | 'NATIONALITY';
  status: CheckStatus;
  message_ar: string;
  message_fr: string;
}

export interface EligibilityResult {
  /** ELIGIBLE: all known checks OK. NOT_ELIGIBLE: at least one FAIL. PARTIAL: no fail but some unknown profile data. */
  status: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'PARTIAL';
  checks: EligibilityCheck[];
  /** True when the rules themselves are unverified suggestions. */
  rules_unverified: boolean;
  /** Free-text conditions that cannot be checked automatically. */
  other_ar: string[];
  other_fr: string[];
}

/** Age in full years at `ref` (YYYY-MM-DD or Date). */
export function ageAt(birthDate: string, ref: Date | string): number {
  const b = new Date(birthDate + (birthDate.length === 10 ? 'T00:00:00Z' : ''));
  const r = typeof ref === 'string' ? new Date(ref + (ref.length === 10 ? 'T00:00:00Z' : '')) : ref;
  let age = r.getUTCFullYear() - b.getUTCFullYear();
  const m = r.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** Human wording of an age condition, readable in RTL Arabic too (no dangling dashes when one bound is missing). */
export function ageRangeText(min: number | null, max: number | null): { ar: string; fr: string } {
  if (min != null && max != null) return { ar: `من ${min} إلى ${max} سنة`, fr: `de ${min} à ${max} ans` };
  if (max != null) return { ar: `${max} سنة على الأكثر`, fr: `${max} ans au plus` };
  if (min != null) return { ar: `${min} سنة على الأقل`, fr: `${min} ans au moins` };
  return { ar: 'دون شرط سن', fr: 'sans condition d’âge' };
}

const norm = (s: string) => s.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Deterministic eligibility matcher. Never claims certainty it does not have:
 * missing profile data ⇒ UNKNOWN check, unverified rules ⇒ rules_unverified flag.
 * `refDate` should be the age reference date of the concours (often the registration deadline) — official texts vary.
 */
export function checkEligibility(rules: EligibilityRules, profile: CandidateProfile, refDate: Date | string): EligibilityResult {
  const checks: EligibilityCheck[] = [];

  if (rules.min_age != null || rules.max_age != null) {
    if (!profile.birth_date) {
      checks.push({ code: 'AGE', status: 'UNKNOWN', message_ar: 'أضف تاريخ ميلادك للتحقق من شرط السن', message_fr: 'Ajoutez votre date de naissance pour vérifier la condition d’âge' });
    } else {
      const age = ageAt(profile.birth_date, refDate);
      const okMin = rules.min_age == null || age >= rules.min_age;
      const okMax = rules.max_age == null || age <= rules.max_age;
      const range = ageRangeText(rules.min_age ?? null, rules.max_age ?? null);
      checks.push(
        okMin && okMax
          ? { code: 'AGE', status: 'OK', message_ar: `سنك (${age}) يستوفي شرط السن: ${range.ar}`, message_fr: `Votre âge (${age}) respecte la condition : ${range.fr}` }
          : { code: 'AGE', status: 'FAIL', message_ar: `سنك (${age}) لا يستوفي شرط السن: ${range.ar}`, message_fr: `Votre âge (${age}) ne respecte pas la condition : ${range.fr}` },
      );
    }
  }

  if (rules.genders && rules.genders.length > 0 && rules.genders.length < 2) {
    if (!profile.gender) {
      checks.push({ code: 'GENDER', status: 'UNKNOWN', message_ar: 'حدد الجنس في ملفك', message_fr: 'Indiquez votre sexe dans votre profil' });
    } else {
      const ok = rules.genders.includes(profile.gender);
      const label = rules.genders[0] === 'M' ? { ar: 'الذكور', fr: 'hommes' } : { ar: 'الإناث', fr: 'femmes' };
      checks.push({
        code: 'GENDER', status: ok ? 'OK' : 'FAIL',
        message_ar: ok ? `المناظرة مفتوحة لـ${label.ar}` : `المناظرة مخصصة لـ${label.ar} فقط`,
        message_fr: ok ? `Concours ouvert aux ${label.fr}` : `Concours réservé aux ${label.fr}`,
      });
    }
  }

  if ((rules.diplomas && rules.diplomas.length) || rules.min_diploma) {
    if (!profile.diploma_level) {
      checks.push({ code: 'DIPLOMA', status: 'UNKNOWN', message_ar: 'أضف مستواك الدراسي', message_fr: 'Ajoutez votre niveau d’études' });
    } else if (rules.diplomas && rules.diplomas.length) {
      const ok = rules.diplomas.includes(profile.diploma_level);
      checks.push({ code: 'DIPLOMA', status: ok ? 'OK' : 'FAIL', message_ar: ok ? 'شهادتك من الشهادات المطلوبة' : 'شهادتك ليست ضمن الشهادات المطلوبة', message_fr: ok ? 'Votre diplôme fait partie des diplômes requis' : 'Votre diplôme ne fait pas partie des diplômes requis' });
    } else if (rules.min_diploma) {
      const ok = DIPLOMA_RANK[profile.diploma_level] >= DIPLOMA_RANK[rules.min_diploma];
      checks.push({ code: 'DIPLOMA', status: ok ? 'OK' : 'FAIL', message_ar: ok ? 'مستواك الدراسي كافٍ' : 'المستوى الدراسي المطلوب أعلى من مستواك', message_fr: ok ? 'Votre niveau d’études est suffisant' : 'Le niveau requis est supérieur au vôtre' });
    }
  }

  if (rules.specialties && rules.specialties.length) {
    const mine = (profile.specialties ?? []).map(norm);
    if (!mine.length) {
      checks.push({ code: 'SPECIALTY', status: 'UNKNOWN', message_ar: 'أضف اختصاصك الدراسي', message_fr: 'Ajoutez votre spécialité' });
    } else {
      const wanted = rules.specialties.map(norm);
      const ok = mine.some((m) => wanted.some((w) => m.includes(w) || w.includes(m)));
      checks.push({ code: 'SPECIALTY', status: ok ? 'OK' : 'FAIL', message_ar: ok ? 'اختصاصك مطلوب' : 'اختصاصك غير مذكور في الاختصاصات المطلوبة', message_fr: ok ? 'Votre spécialité est demandée' : 'Votre spécialité n’est pas listée' });
    }
  }

  const minH = profile.gender === 'F' ? rules.min_height_cm_female : profile.gender === 'M' ? rules.min_height_cm_male : (rules.min_height_cm_male ?? rules.min_height_cm_female);
  if (minH != null) {
    if (profile.height_cm == null || !profile.gender) {
      checks.push({ code: 'HEIGHT', status: 'UNKNOWN', message_ar: `يُشترط طول أدنى (${minH} صم) — أضف طولك`, message_fr: `Taille minimale requise (${minH} cm) — ajoutez votre taille` });
    } else {
      const ok = profile.height_cm >= minH;
      checks.push({ code: 'HEIGHT', status: ok ? 'OK' : 'FAIL', message_ar: ok ? `طولك يستوفي الحد الأدنى (${minH} صم)` : `الطول الأدنى المطلوب ${minH} صم`, message_fr: ok ? `Votre taille respecte le minimum (${minH} cm)` : `Taille minimale requise : ${minH} cm` });
    }
  }

  if (rules.marital_status === 'SINGLE') {
    if (!profile.marital_status) {
      checks.push({ code: 'MARITAL', status: 'UNKNOWN', message_ar: 'يُشترط أن يكون المترشح أعزب — حدد حالتك المدنية', message_fr: 'Condition : être célibataire — indiquez votre situation' });
    } else {
      const ok = profile.marital_status === 'SINGLE';
      checks.push({ code: 'MARITAL', status: ok ? 'OK' : 'FAIL', message_ar: ok ? 'شرط العزوبية مستوفى' : 'يُشترط أن يكون المترشح أعزب', message_fr: ok ? 'Condition de célibat remplie' : 'Condition : être célibataire' });
    }
  }

  if (rules.nationality && profile.nationality && profile.nationality !== rules.nationality) {
    checks.push({ code: 'NATIONALITY', status: 'FAIL', message_ar: 'يُشترط الجنسية التونسية', message_fr: 'Nationalité tunisienne requise' });
  }

  const status: EligibilityResult['status'] = checks.some((c) => c.status === 'FAIL')
    ? 'NOT_ELIGIBLE'
    : checks.some((c) => c.status === 'UNKNOWN')
      ? 'PARTIAL'
      : 'ELIGIBLE';

  return {
    status,
    checks,
    rules_unverified: !!rules.needs_verification,
    other_ar: rules.other_ar ?? [],
    other_fr: rules.other_fr ?? [],
  };
}

/**
 * Should we alert this user about this position? We alert on ELIGIBLE, and on PARTIAL
 * when nothing fails (so incomplete profiles still get relevant alerts, with a "complete your profile" hint).
 */
export function shouldAlert(result: EligibilityResult): boolean {
  return result.status !== 'NOT_ELIGIBLE';
}

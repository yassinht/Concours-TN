/** Bilingual labels and small pure helpers of the learning pages. */
import type { AttemptKind, Locale, ReadinessLabel, SyllabusNodeDTO } from '@ctn/shared';
import { READINESS_LABEL_TEXT } from '@ctn/shared/dist/enums';
import type { Bi } from '@/lib/i18n';

export const KIND_LABELS: Record<AttemptKind, Bi> = {
  DIAGNOSTIC: { ar: 'اختبار تشخيصي', fr: 'Test diagnostique' },
  PRACTICE: { ar: 'تمارين', fr: 'Entraînement' },
  DAILY: { ar: 'تمارين اليوم', fr: 'Entraînement du jour' },
  MOCK: { ar: 'امتحان تجريبي', fr: 'Examen blanc' },
  REVIEW: { ar: 'مراجعة الأخطاء', fr: 'Révision des erreurs' },
};

export const SCOPE_TEXT: Record<SyllabusNodeDTO['scope'], Bi & { tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
  OFFICIAL_PROGRAM: { ar: 'برنامج رسمي', fr: 'Programme officiel', tone: 'success' },
  INFERRED_FROM_PAST_EXAMS: { ar: 'مستنتج من امتحانات سابقة', fr: 'Déduit des anciens sujets', tone: 'info' },
  GENERAL_SKILL: { ar: 'مهارة عامة', fr: 'Compétence générale', tone: 'neutral' },
  SUGGESTED: { ar: 'مقترح', fr: 'Suggéré', tone: 'warning' },
};

export const FIDELITY_TEXT: Record<'OFFICIAL_FORMAT' | 'APPROXIMATED', Bi & { tone: 'success' | 'warning'; hint: Bi }> = {
  OFFICIAL_FORMAT: {
    ar: 'نفس صيغة الامتحان الرسمي', fr: 'Format officiel', tone: 'success',
    hint: { ar: 'عدد الأسئلة والمواد والتوقيت مأخوذة من مصدر رسمي.', fr: 'Nombre de questions, matières et durée issus d’une source officielle.' },
  },
  APPROXIMATED: {
    ar: 'صيغة تقريبية', fr: 'Format approximatif', tone: 'warning',
    hint: { ar: 'الصيغة الرسمية غير منشورة: التوزيع مستنتج من امتحانات سابقة وقد يختلف يوم المناظرة.', fr: 'Format officiel non publié : répartition déduite des anciens sujets, elle peut différer le jour J.' },
  },
};

export const REPORT_REASONS: { value: 'WRONG_ANSWER' | 'AMBIGUOUS' | 'TYPO' | 'OUTDATED' | 'OTHER'; label: Bi }[] = [
  { value: 'WRONG_ANSWER', label: { ar: 'الإجابة الصحيحة خاطئة', fr: 'La bonne réponse est fausse' } },
  { value: 'AMBIGUOUS', label: { ar: 'السؤال غامض أو له أكثر من إجابة', fr: 'Question ambiguë / plusieurs réponses' } },
  { value: 'TYPO', label: { ar: 'خطأ في الكتابة', fr: 'Faute de frappe' } },
  { value: 'OUTDATED', label: { ar: 'معلومة قديمة أو تغيّرت', fr: 'Information obsolète' } },
  { value: 'OTHER', label: { ar: 'سبب آخر', fr: 'Autre' } },
];

const READINESS_TONE: Record<ReadinessLabel, 'success' | 'primary' | 'warning' | 'danger'> = {
  EXCELLENT: 'success', GOOD: 'primary', NEEDS_IMPROVEMENT: 'warning', NOT_READY: 'danger',
};
/** French wording of the readiness labels (the shared READINESS_LABEL_TEXT.fr is in English). */
const READINESS_FR: Record<ReadinessLabel, string> = {
  EXCELLENT: 'Excellente préparation', GOOD: 'Bonne préparation', NEEDS_IMPROVEMENT: 'À renforcer', NOT_READY: 'Pas encore prêt',
};
export function readinessText(label: ReadinessLabel): Bi & { tone: 'success' | 'primary' | 'warning' | 'danger' } {
  return { ar: READINESS_LABEL_TEXT[label].ar, fr: READINESS_FR[label], tone: READINESS_TONE[label] };
}

export const DIFFICULTY_TEXT: Record<'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT', Bi> = {
  EASY: { ar: 'سهل', fr: 'Facile' },
  MEDIUM: { ar: 'متوسط', fr: 'Moyen' },
  HARD: { ar: 'صعب', fr: 'Difficile' },
  EXPERT: { ar: 'متقدم', fr: 'Expert' },
};

/** Physical test codes tracked in the training log: unit, and whether a lower value is better (running times). */
export const PHYSICAL_TESTS: { code: string; label: Bi; unit: string; unitLabel: Bi; lowerIsBetter: boolean; step: string }[] = [
  { code: 'RUN_100M', label: { ar: 'جري 100 متر', fr: 'Course 100 m' }, unit: 's', unitLabel: { ar: 'ثانية', fr: 's' }, lowerIsBetter: true, step: '0.01' },
  { code: 'RUN_1000M', label: { ar: 'جري 1000 متر', fr: 'Course 1000 m' }, unit: 's', unitLabel: { ar: 'ثانية', fr: 's' }, lowerIsBetter: true, step: '1' },
  { code: 'RUN_2000M', label: { ar: 'جري 2000 متر', fr: 'Course 2000 m' }, unit: 's', unitLabel: { ar: 'ثانية', fr: 's' }, lowerIsBetter: true, step: '1' },
  { code: 'PUSHUPS', label: { ar: 'تمارين الضغط', fr: 'Pompes' }, unit: 'reps', unitLabel: { ar: 'مرة', fr: 'rép.' }, lowerIsBetter: false, step: '1' },
  { code: 'SITUPS', label: { ar: 'تمارين البطن', fr: 'Abdominaux' }, unit: 'reps', unitLabel: { ar: 'مرة', fr: 'rép.' }, lowerIsBetter: false, step: '1' },
  { code: 'PULLUPS', label: { ar: 'العقلة (الجذب)', fr: 'Tractions' }, unit: 'reps', unitLabel: { ar: 'مرة', fr: 'rép.' }, lowerIsBetter: false, step: '1' },
  { code: 'LONG_JUMP', label: { ar: 'القفز الطويل', fr: 'Saut en longueur' }, unit: 'm', unitLabel: { ar: 'متر', fr: 'm' }, lowerIsBetter: false, step: '0.01' },
];

/** "1:05" / "12:30" / "1:02:03" from seconds. Latin digits in both locales. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Human duration: "12 min 30 s" / "12 د 30 ث". */
export function durationText(locale: Locale, seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (locale === 'ar') return m ? `${m} د${r ? ` ${r} ث` : ''}` : `${r} ث`;
  return m ? `${m} min${r ? ` ${r} s` : ''}` : `${r} s`;
}

/** Running time from a physical log value (seconds) as m:ss.d when ≥ 60 s. */
export function formatPhysical(value: number, unit: string, locale: Locale): string {
  if (unit === 's') {
    if (value >= 60) return clock(value) + (value % 1 ? `.${Math.round((value % 1) * 10)}` : '');
    return `${Number.isInteger(value) ? value : value.toFixed(2)} ${locale === 'ar' ? 'ث' : 's'}`;
  }
  if (unit === 'm') return `${value.toFixed(2)} ${locale === 'ar' ? 'م' : 'm'}`;
  if (unit === 'reps') return `${value} ${locale === 'ar' ? 'مرة' : 'rép.'}`;
  return `${value} ${unit}`;
}

/** Option letters: Arabic abjad order for Arabic questions, Latin otherwise. */
const AR_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
export function optionLetter(language: 'ar' | 'fr' | 'en', i: number): string {
  if (language === 'ar') return AR_LETTERS[i] ?? String(i + 1);
  return String.fromCharCode(65 + i);
}

/** 0..100 percent from a 0..1 ratio (GET /me/progress returns ratios; attempt results are already percentages). */
export function pct(ratio: number): number {
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

/** "3:45", "3'45", "3m45", "225", "12,8" → seconds (running tests). */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  const mmss = /^(\d{1,3})\s*[:'m]\s*(\d{1,2}(?:\.\d+)?)\s*s?$/i.exec(s);
  if (mmss) {
    const sec = Number(mmss[2]);
    return sec < 60 ? Number(mmss[1]) * 60 + sec : null;
  }
  const v = Number(s.replace(/s$/i, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function parseValue(raw: string, unit: string): number | null {
  if (unit === 's') return parseDuration(raw);
  const v = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(v) || v < 0) return null;
  return unit === 'reps' ? Math.round(v) : v;
}

type CountUnit = 'question' | 'day' | 'minute' | 'topic' | 'attempt' | 'time' | 'answer' | 'session' | 'explanation';

/** Arabic forms: one (with "واحد"), dual, 3–10 plural, 11–99 accusative singular, otherwise singular. */
const AR_UNITS: Record<CountUnit, { one: string; two: string; few: string; many: string; base: string }> = {
  question: { one: 'سؤال واحد', two: 'سؤالان', few: 'أسئلة', many: 'سؤالًا', base: 'سؤال' },
  day: { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا', base: 'يوم' },
  minute: { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة', base: 'دقيقة' },
  topic: { one: 'محور واحد', two: 'محوران', few: 'محاور', many: 'محورًا', base: 'محور' },
  attempt: { one: 'محاولة واحدة', two: 'محاولتان', few: 'محاولات', many: 'محاولة', base: 'محاولة' },
  time: { one: 'مرة واحدة', two: 'مرتان', few: 'مرات', many: 'مرة', base: 'مرة' },
  answer: { one: 'إجابة واحدة', two: 'إجابتان', few: 'إجابات', many: 'إجابة', base: 'إجابة' },
  session: { one: 'حصة واحدة', two: 'حصتان', few: 'حصص', many: 'حصة', base: 'حصة' },
  explanation: { one: 'شرح واحد', two: 'شرحان', few: 'شروحات', many: 'شرحًا', base: 'شرح' },
};
const FR_UNITS: Record<CountUnit, [string, string]> = {
  question: ['question', 'questions'], day: ['jour', 'jours'], minute: ['minute', 'minutes'], topic: ['thème', 'thèmes'],
  attempt: ['tentative', 'tentatives'], time: ['fois', 'fois'], answer: ['réponse', 'réponses'], session: ['séance', 'séances'],
  explanation: ['explication', 'explications'],
};

/** "24 سؤالًا" / "سؤالان" / "3 questions" — grammatical counts for both locales. */
export function nOf(locale: Locale, n: number, unit: CountUnit): string {
  if (locale === 'fr') {
    const [sg, pl] = FR_UNITS[unit];
    return `${n} ${Math.abs(n) <= 1 ? sg : pl}`;
  }
  const u = AR_UNITS[unit];
  if (n === 1) return u.one;
  if (n === 2) return u.two;
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} ${u.few}`;
  if (r >= 11 && r <= 99) return `${n} ${u.many}`;
  return `${n} ${u.base}`;
}

/** Both locales at once, for `tr()`. */
export function biCount(n: number, unit: CountUnit): { ar: string; fr: string } {
  return { ar: nOf('ar', n, unit), fr: nOf('fr', n, unit) };
}

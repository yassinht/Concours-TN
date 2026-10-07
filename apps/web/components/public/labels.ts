/**
 * Labels and small formatting helpers shared by the public pages (server and client).
 *
 * Values are imported from the per-file builds of @ctn/shared: the package index also re-exports the zod
 * schemas (CommonJS, not tree-shakable), which would otherwise end up in the client bundle.
 */
import type { Confidence, EditionDTO, EditionStatus, Field, Locale, PhaseKind, SourceType, SyllabusNodeDTO } from '@ctn/shared';
import { FIELDS } from '@ctn/shared/dist/enums';
import type { Bi } from '@/lib/i18n';

export { FIELDS };
export { FIELD_LABELS, DIPLOMA_LEVELS, DIPLOMA_LABELS, DOMAIN_LABELS } from '@ctn/shared/dist/enums';
export { PLANS, formatTnd } from '@ctn/shared/dist/pricing';

export const OFFICIAL_PORTAL = 'https://www.concours.gov.tn';

export const EDITION_STATUS_LABELS: Record<EditionStatus, Bi & { tone: 'success' | 'info' | 'warning' | 'neutral' | 'primary' }> = {
  EXPECTED: { ar: 'متوقعة', fr: 'Attendu', tone: 'warning' },
  ANNOUNCED: { ar: 'معلن عنها', fr: 'Annoncé', tone: 'info' },
  OPEN: { ar: 'التسجيل مفتوح', fr: 'Inscriptions ouvertes', tone: 'success' },
  CLOSED: { ar: 'التسجيل مغلق', fr: 'Inscriptions closes', tone: 'neutral' },
  EXAM_DONE: { ar: 'أُجريت الاختبارات', fr: 'Épreuves passées', tone: 'neutral' },
  RESULTS: { ar: 'صدرت النتائج', fr: 'Résultats publiés', tone: 'primary' },
};

export const FREQUENCY_LABELS: Record<string, Bi> = {
  ANNUAL: { ar: 'سنوية عادةً', fr: 'Annuel en général' },
  BIENNIAL: { ar: 'كل سنتين عادةً', fr: 'Tous les deux ans en général' },
  IRREGULAR: { ar: 'غير منتظمة', fr: 'Irrégulier' },
  UNKNOWN: { ar: 'غير معروفة', fr: 'Inconnue' },
};

export const PHASE_KIND_LABELS: Record<PhaseKind, Bi> = {
  WRITTEN: { ar: 'اختبار كتابي', fr: 'Écrit' },
  PHYSICAL: { ar: 'اختبارات رياضية', fr: 'Épreuves physiques' },
  ORAL: { ar: 'اختبار شفاهي', fr: 'Oral' },
  PSYCHOTECH: { ar: 'اختبار نفسي-تقني', fr: 'Psychotechnique' },
  MEDICAL: { ar: 'فحص طبي', fr: 'Visite médicale' },
  FILE_REVIEW: { ar: 'دراسة الملفات', fr: 'Étude des dossiers' },
  INTERVIEW: { ar: 'مقابلة', fr: 'Entretien' },
  TRAINING: { ar: 'تكوين', fr: 'Formation' },
};

export const SOURCE_TYPE_LABELS: Record<SourceType, Bi & { tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
  OFFICIAL: { ar: 'رسمي', fr: 'Officiel', tone: 'success' },
  SECONDARY: { ar: 'مصدر ثانوي', fr: 'Source secondaire', tone: 'info' },
  COMMUNITY: { ar: 'تجارب مترشحين', fr: 'Communauté', tone: 'neutral' },
  SUGGESTED: { ar: 'مقترح — للتحقق', fr: 'Suggestion — à vérifier', tone: 'warning' },
};

export const CONFIDENCE_LABELS: Record<Confidence, Bi> = {
  HIGH: { ar: 'ثقة عالية', fr: 'Confiance élevée' },
  MEDIUM: { ar: 'ثقة متوسطة', fr: 'Confiance moyenne' },
  LOW: { ar: 'ثقة ضعيفة', fr: 'Confiance faible' },
};

export const SCOPE_LABELS: Record<SyllabusNodeDTO['scope'], Bi & { tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
  OFFICIAL_PROGRAM: { ar: 'برنامج رسمي', fr: 'Programme officiel', tone: 'success' },
  INFERRED_FROM_PAST_EXAMS: { ar: 'مستنتج من امتحانات سابقة', fr: 'Déduit des annales', tone: 'info' },
  GENERAL_SKILL: { ar: 'مهارة عامة', fr: 'Compétence générale', tone: 'neutral' },
  SUGGESTED: { ar: 'مقترح — للتحقق', fr: 'Suggéré — à vérifier', tone: 'warning' },
};

export const GENDER_LABELS: Record<'M' | 'F', Bi> = { M: { ar: 'ذكر', fr: 'Homme' }, F: { ar: 'أنثى', fr: 'Femme' } };

export const MARITAL_LABELS: Record<'SINGLE' | 'MARRIED' | 'OTHER', Bi> = {
  SINGLE: { ar: 'أعزب / عزباء', fr: 'Célibataire' },
  MARRIED: { ar: 'متزوج(ة)', fr: 'Marié(e)' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
};

// ───────── Counting (Arabic number agreement) ─────────

type Unit = 'day' | 'question' | 'position' | 'source' | 'minute' | 'concours' | 'fact' | 'edition';

/** Arabic: 1 → singular "واحد", 2 → dual, 3–10 → plural, 11–99 → accusative singular, 0/100+ → singular. */
const AR_UNITS: Record<Unit, { one: string; two: string; few: string; many: string; base: string }> = {
  day: { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا', base: 'يوم' },
  question: { one: 'سؤال واحد', two: 'سؤالان', few: 'أسئلة', many: 'سؤالًا', base: 'سؤال' },
  position: { one: 'رتبة واحدة', two: 'رتبتان', few: 'رتب', many: 'رتبة', base: 'رتبة' },
  source: { one: 'مصدر واحد', two: 'مصدران', few: 'مصادر', many: 'مصدرًا', base: 'مصدر' },
  minute: { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة', base: 'دقيقة' },
  concours: { one: 'مناظرة واحدة', two: 'مناظرتان', few: 'مناظرات', many: 'مناظرة', base: 'مناظرة' },
  fact: { one: 'معلومة واحدة', two: 'معلومتان', few: 'معلومات', many: 'معلومة', base: 'معلومة' },
  edition: { one: 'دورة واحدة', two: 'دورتان', few: 'دورات', many: 'دورة', base: 'دورة' },
};
const FR_UNITS: Record<Unit, [string, string]> = {
  day: ['jour', 'jours'],
  question: ['question', 'questions'],
  position: ['grade', 'grades'],
  source: ['source', 'sources'],
  minute: ['minute', 'minutes'],
  concours: ['concours', 'concours'],
  fact: ['information', 'informations'],
  edition: ['session', 'sessions'],
};

export function countLabel(locale: Locale, n: number, unit: Unit): string {
  if (locale === 'fr') {
    const [sg, pl] = FR_UNITS[unit];
    return `${n.toLocaleString('fr-FR')} ${n <= 1 ? sg : pl}`;
  }
  const u = AR_UNITS[unit];
  if (n === 1) return u.one;
  if (n === 2) return u.two;
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} ${u.few}`;
  if (r >= 11 && r <= 99) return `${n} ${u.many}`;
  return `${n} ${u.base}`;
}

/** "Last day today" / "3 days left" / "closed X days ago"-free wording for a deadline countdown. */
export function deadlineCountdown(locale: Locale, days: number | null): string | null {
  if (days == null || days < 0) return null;
  if (days === 0) return locale === 'ar' ? 'آخر يوم: اليوم' : 'Dernier jour : aujourd’hui';
  if (days === 1) return locale === 'ar' ? 'آخر أجل: غدًا' : 'Clôture : demain';
  return locale === 'ar' ? `يتبقى ${countLabel('ar', days, 'day')}` : `${countLabel('fr', days, 'day')} restants`;
}

/** "in 12 days" for an upcoming (non-deadline) date. */
export function inDays(locale: Locale, days: number | null): string | null {
  if (days == null || days < 0) return null;
  if (days === 0) return locale === 'ar' ? 'اليوم' : 'aujourd’hui';
  if (days === 1) return locale === 'ar' ? 'غدًا' : 'demain';
  return locale === 'ar' ? `بعد ${countLabel('ar', days, 'day')}` : `dans ${countLabel('fr', days, 'day')}`;
}

// ───────── Editions ─────────

const datesOf = (e: Pick<EditionDTO, 'registrationOpen' | 'registrationDeadline' | 'examDate'>) =>
  [e.registrationOpen, e.registrationDeadline, e.examDate].filter((d): d is string => !!d).map((d) => d.slice(0, 10));

/** Today in Africa/Tunis as YYYY-MM-DD (the API uses the same reference day). */
export function tunisToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole days from Tunis-today to `iso` (negative when past). Timezone-stable on server and client. */
export function daysFromToday(iso: string | null | undefined, today = tunisToday()): number | null {
  if (!iso) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const d = iso.slice(0, 10);
  const b = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** The date that matters next for an edition (deadline when open, else the earliest upcoming date). */
export function keyDateOf(e: EditionDTO, today = tunisToday()): { date: string | null; kind: 'open' | 'deadline' | 'exam' | null } {
  if (e.status === 'OPEN' && e.registrationDeadline) return { date: e.registrationDeadline.slice(0, 10), kind: 'deadline' };
  const candidates: { date: string | null; kind: 'open' | 'deadline' | 'exam' }[] = [
    { date: e.registrationOpen, kind: 'open' },
    { date: e.registrationDeadline, kind: 'deadline' },
    { date: e.examDate, kind: 'exam' },
  ];
  const upcoming = candidates
    .filter((c): c is { date: string; kind: 'open' | 'deadline' | 'exam' } => !!c.date && c.date.slice(0, 10) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (upcoming) return { date: upcoming.date.slice(0, 10), kind: upcoming.kind };
  const last = datesOf(e).sort().at(-1) ?? null;
  return { date: last, kind: null };
}

export const KEY_DATE_LABELS: Record<'open' | 'deadline' | 'exam', Bi> = {
  open: { ar: 'فتح باب الترشح', fr: 'Ouverture des inscriptions' },
  deadline: { ar: 'آخر أجل للترشح', fr: 'Clôture des inscriptions' },
  exam: { ar: 'موعد الاختبارات', fr: 'Date des épreuves' },
};

export function editionTitle(locale: Locale, e: EditionDTO): string {
  return `${locale === 'fr' ? e.familyName_fr : e.familyName_ar} ${e.year}`;
}

const ARABIC = /[\u0600-\u06FF]/;

/**
 * Session labels are often stored bilingual ("… / …"): keep the half in the reader's language
 * (Arabic script for ar, the other half for fr); a monolingual label is returned as is.
 */
export function sessionLabelFor(locale: Locale, label: string | null | undefined): string | null {
  if (!label) return null;
  const parts = label.split(' / ').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return label;
  const ar = parts.filter((p) => ARABIC.test(p));
  const other = parts.filter((p) => !ARABIC.test(p));
  if (!ar.length || !other.length) return label;
  return (locale === 'ar' ? ar : other).join(' / ');
}

// ───────── Misc ─────────

const FIELD_SET = new Set<string>(FIELDS);
export function asField(v: string | null | undefined): Field | null {
  return v && FIELD_SET.has(v) ? (v as Field) : null;
}

export function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Bilingual column of a DTO: loc(locale, family, 'name') → name_fr | name_ar (falls back to the other language).
 * Typed on the exact keys so DTO interfaces are accepted (lib/i18n `pick` needs an index signature).
 */
export function loc<K extends string>(locale: Locale, row: Record<`${K}_ar` | `${K}_fr`, string | null | undefined>, base: K): string {
  const ar = row[`${base}_ar` as `${K}_ar`];
  const fr = row[`${base}_fr` as `${K}_fr`];
  return (locale === 'fr' ? fr || ar : ar || fr) ?? '';
}

/**
 * Small, dependency-free helpers for the logged-in app (/app/*) and the auth pages.
 * Values from @ctn/shared are imported from the per-file builds so zod never reaches the client bundle.
 */
import type { EditionDTO, Locale } from '@ctn/shared';
import type { Bi } from '@/lib/i18n';

/** Today in Africa/Tunis as YYYY-MM-DD (the API uses the same reference day). */
export function tunisToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole days from Tunis-today to `iso` (negative when past). */
export function daysFromToday(iso: string | null | undefined, today = tunisToday()): number | null {
  if (!iso) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const d = iso.slice(0, 10);
  const b = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

type Unit = 'day' | 'question' | 'minute' | 'concours' | 'friend' | 'notification' | 'lesson';

/** Arabic counting: 1 → "واحد", 2 → dual, 3–10 → plural, 11–99 → accusative singular, otherwise singular. */
const AR: Record<Unit, { one: string; two: string; few: string; many: string; base: string }> = {
  day: { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا', base: 'يوم' },
  question: { one: 'سؤال واحد', two: 'سؤالان', few: 'أسئلة', many: 'سؤالًا', base: 'سؤال' },
  minute: { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة', base: 'دقيقة' },
  concours: { one: 'مناظرة واحدة', two: 'مناظرتان', few: 'مناظرات', many: 'مناظرة', base: 'مناظرة' },
  friend: { one: 'صديق واحد', two: 'صديقان', few: 'أصدقاء', many: 'صديقًا', base: 'صديق' },
  notification: { one: 'إشعار واحد', two: 'إشعاران', few: 'إشعارات', many: 'إشعارًا', base: 'إشعار' },
  lesson: { one: 'درس واحد', two: 'درسان', few: 'دروس', many: 'درسًا', base: 'درس' },
};
const FR: Record<Unit, [string, string]> = {
  day: ['jour', 'jours'],
  question: ['question', 'questions'],
  minute: ['minute', 'minutes'],
  concours: ['concours', 'concours'],
  friend: ['ami', 'amis'],
  notification: ['notification', 'notifications'],
  lesson: ['leçon', 'leçons'],
};

export function countLabel(locale: Locale, n: number, unit: Unit): string {
  if (locale === 'fr') {
    const [sg, pl] = FR[unit];
    return `${n.toLocaleString('fr-FR')} ${Math.abs(n) <= 1 ? sg : pl}`;
  }
  const u = AR[unit];
  if (n === 1) return u.one;
  if (n === 2) return u.two;
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} ${u.few}`;
  if (r >= 11 && r <= 99) return `${n} ${u.many}`;
  return `${n} ${u.base}`;
}

/** "Last day today" / "closes tomorrow" / "5 days left" for a registration deadline. */
export function deadlineText(locale: Locale, days: number | null): string | null {
  if (days == null || days < 0) return null;
  if (days === 0) return locale === 'ar' ? 'آخر يوم للتسجيل: اليوم' : 'Dernier jour d’inscription : aujourd’hui';
  if (days === 1) return locale === 'ar' ? 'آخر أجل للتسجيل: غدًا' : 'Clôture des inscriptions : demain';
  return locale === 'ar' ? `يتبقى ${countLabel('ar', days, 'day')} للتسجيل` : `${countLabel('fr', days, 'day')} pour s’inscrire`;
}

/** "in 12 days" / "today" / "tomorrow". */
export function inDays(locale: Locale, days: number | null): string | null {
  if (days == null || days < 0) return null;
  if (days === 0) return locale === 'ar' ? 'اليوم' : 'aujourd’hui';
  if (days === 1) return locale === 'ar' ? 'غدًا' : 'demain';
  return locale === 'ar' ? `بعد ${countLabel('ar', days, 'day')}` : `dans ${countLabel('fr', days, 'day')}`;
}

export function editionTitle(locale: Locale, e: Pick<EditionDTO, 'familyName_ar' | 'familyName_fr' | 'sessionLabel' | 'year'>): string {
  const name = locale === 'fr' ? e.familyName_fr || e.familyName_ar : e.familyName_ar || e.familyName_fr;
  return e.sessionLabel ? `${name} — ${e.sessionLabel}` : `${name} ${e.year}`;
}

/** Bilingual column with fallback to the other language. */
export function bi(locale: Locale, ar: string | null | undefined, fr: string | null | undefined): string {
  return (locale === 'fr' ? fr || ar : ar || fr) ?? '';
}

/**
 * Only same-origin relative paths are accepted as a post-login destination (open-redirect guard):
 * "/app/billing" ok; "//evil.com", "/\\evil.com", "https://…" rejected.
 */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next || typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next.slice(0, 500);
}

/** Notification / deep-link targets: internal paths, or http(s) URLs opened in a new tab. Anything else is dropped. */
export function linkTarget(url: string | null | undefined): { href: string; external: boolean } | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return { href: url, external: false };
  try {
    const u = new URL(url);
    if (typeof window !== 'undefined' && u.origin === window.location.origin) return { href: `${u.pathname}${u.search}${u.hash}`, external: false };
    if (u.protocol === 'https:' || u.protocol === 'http:') return { href: u.toString(), external: true };
  } catch {
    /* not a URL */
  }
  return null;
}

export function relativeTime(locale: Locale, iso: string, now = Date.now()): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-TN-u-nu-latn' : 'fr', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-TN', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function greeting(now = new Date()): Bi {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Tunis', hour: '2-digit', hour12: false }).format(now));
  if (h >= 5 && h < 12) return { ar: 'صباح الخير', fr: 'Bonjour' };
  if (h >= 12 && h < 18) return { ar: 'مساء الخير', fr: 'Bon après-midi' };
  return { ar: 'مساء النور', fr: 'Bonsoir' };
}

export const READINESS_TEXT: Record<'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT' | 'NOT_READY', Bi & { tone: 'success' | 'primary' | 'warning' | 'danger' }> = {
  EXCELLENT: { ar: 'تحضير ممتاز', fr: 'Excellente préparation', tone: 'success' },
  GOOD: { ar: 'تحضير جيد', fr: 'Bonne préparation', tone: 'primary' },
  NEEDS_IMPROVEMENT: { ar: 'يحتاج إلى تحسين', fr: 'À renforcer', tone: 'warning' },
  NOT_READY: { ar: 'غير جاهز بعد', fr: 'Pas encore prêt', tone: 'danger' },
};

export const GENDER_TEXT: Record<'M' | 'F', Bi> = { M: { ar: 'ذكر', fr: 'Homme' }, F: { ar: 'أنثى', fr: 'Femme' } };
export const MARITAL_TEXT: Record<'SINGLE' | 'MARRIED' | 'OTHER', Bi> = {
  SINGLE: { ar: 'أعزب / عزباء', fr: 'Célibataire' },
  MARRIED: { ar: 'متزوج(ة)', fr: 'Marié(e)' },
  OTHER: { ar: 'أخرى', fr: 'Autre' },
};

/** Arabic names of the 24 governorates (the API stores the French/Latin name). */
export const GOVERNORATE_AR: Record<string, string> = {
  Tunis: 'تونس', Ariana: 'أريانة', 'Ben Arous': 'بن عروس', Manouba: 'منوبة', Nabeul: 'نابل', Zaghouan: 'زغوان', Bizerte: 'بنزرت',
  'Béja': 'باجة', Jendouba: 'جندوبة', 'Le Kef': 'الكاف', Siliana: 'سليانة', Sousse: 'سوسة', Monastir: 'المنستير', Mahdia: 'المهدية',
  Sfax: 'صفاقس', Kairouan: 'القيروان', Kasserine: 'القصرين', 'Sidi Bouzid': 'سيدي بوزيد', 'Gabès': 'قابس', 'Médenine': 'مدنين',
  Tataouine: 'تطاوين', Gafsa: 'قفصة', Tozeur: 'توزر', 'Kébili': 'قبلي',
};

/** Human message for the stable API error codes (falls back to a generic message). */
export function errorText(code: string | undefined): Bi {
  switch (code) {
    case 'EMAIL_TAKEN': return { ar: 'هذا البريد مسجّل مسبقًا. سجّل الدخول بدلًا من ذلك.', fr: 'Cet e-mail est déjà utilisé. Connectez-vous plutôt.' };
    case 'INVALID_CREDENTIALS': return { ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', fr: 'E-mail ou mot de passe incorrect.' };
    case 'TOKEN_INVALID': return { ar: 'الرابط غير صالح أو منتهي الصلاحية.', fr: 'Lien invalide ou expiré.' };
    case 'VALIDATION_FAILED': return { ar: 'تحقق من المعطيات المدخلة.', fr: 'Vérifiez les informations saisies.' };
    case 'RATE_LIMITED':
    case 'TOO_MANY_REQUESTS':
    case 'ThrottlerException: Too Many Requests': return { ar: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.', fr: 'Trop de tentatives. Patientez un peu puis réessayez.' };
    case 'REGISTRATION_REQUIRED': return { ar: 'أنشئ حسابًا مجانيًا للمواصلة.', fr: 'Créez un compte gratuit pour continuer.' };
    case 'SESSION_REQUIRED': return { ar: 'انتهت الجلسة. أعد تحميل الصفحة.', fr: 'Session expirée. Rechargez la page.' };
    case 'LIMIT_REACHED': return { ar: 'بلغت الحد اليومي المجاني من الأسئلة.', fr: 'Limite gratuite quotidienne atteinte.' };
    case 'PREMIUM_REQUIRED': return { ar: 'هذه الميزة متاحة في الاشتراك المميز.', fr: 'Fonctionnalité réservée au Premium.' };
    case 'NO_QUESTIONS': return { ar: 'لا توجد أسئلة منشورة كافية لهذا الموضوع بعد.', fr: 'Pas encore assez de questions publiées pour ce thème.' };
    case 'NOTHING_TO_REVIEW': return { ar: 'لا توجد أخطاء للمراجعة الآن. أحسنت!', fr: 'Rien à réviser pour le moment. Bravo !' };
    case 'FAMILY_REQUIRED': return { ar: 'اختر مناظرة أولًا.', fr: 'Choisissez d’abord un concours.' };
    case 'PROMO_INVALID': return { ar: 'رمز التخفيض غير صالح.', fr: 'Code promo invalide.' };
    case 'PROVIDER_UNAVAILABLE': return { ar: 'طريقة الدفع هذه غير متاحة حاليًا.', fr: 'Ce moyen de paiement est indisponible pour le moment.' };
    case 'PROVIDER_ERROR': return { ar: 'تعذّر الاتصال بمزوّد الدفع. حاول لاحقًا أو اختر طريقة أخرى.', fr: 'Le prestataire de paiement ne répond pas. Réessayez ou choisissez un autre moyen.' };
    case 'PAYMENT_NOT_PENDING': return { ar: 'تمت معالجة هذا الدفع مسبقًا.', fr: 'Ce paiement a déjà été traité.' };
    case 'NOT_FOUND': return { ar: 'العنصر غير موجود.', fr: 'Élément introuvable.' };
    case 'NETWORK': return { ar: 'لا يوجد اتصال بالإنترنت.', fr: 'Pas de connexion Internet.' };
    default: return { ar: 'حدث خطأ غير متوقع. حاول مرة أخرى.', fr: 'Une erreur inattendue est survenue. Réessayez.' };
  }
}

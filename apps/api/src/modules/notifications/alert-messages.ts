import type { EditionStatus, EligibilityResult, Locale } from '@ctn/shared';
import { daysAr, daysFr, formatDate, questionsAr } from './notifications.util';

/**
 * Notification copy (Arabic / French). Principles: dates the team has not verified are labelled "to verify", unverified
 * eligibility rules are never presented as official, and a PARTIAL match invites the user to complete the profile.
 */
export interface Message {
  title: string;
  body: string;
}

export interface EditionFacts {
  familyName_ar: string;
  familyName_fr: string;
  status: EditionStatus;
  registrationOpen: string | null;
  registrationDeadline: string | null;
  examDate: string | null;
  /** The edition's dates come from an unverified source. */
  needsVerification: boolean;
}

export interface MatchedPosition {
  title_ar: string;
  title_fr: string;
  result: EligibilityResult;
}

const name = (e: EditionFacts, l: Locale) => (l === 'ar' ? e.familyName_ar : e.familyName_fr);

/** "N days remain" with Arabic verb/number agreement: بقي يوم واحد، بقي يومان، بقيت 7 أيام، بقي 11 يومًا. */
function remainAr(n: number): string {
  return n >= 3 && n <= 10 ? `بقيت ${daysAr(n)}` : `بقي ${daysAr(n)}`;
}
const lines = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join('\n');

function listAr(items: string[], max = 3): string {
  const shown = items.slice(0, max).join('، ');
  const more = items.length - max;
  return more > 0 ? `${shown} و${more === 1 ? 'خطة أخرى' : more === 2 ? 'خطتان أخريان' : `${more} خطط أخرى`}` : shown;
}

function listFr(items: string[], max = 3): string {
  const shown = items.slice(0, max).join(', ');
  const more = items.length - max;
  return more > 0 ? `${shown} et ${more} autre${more > 1 ? 's' : ''}` : shown;
}

function datesLine(e: EditionFacts, l: Locale): string {
  const verify = e.needsVerification ? (l === 'ar' ? ' (تواريخ للتحقق)' : ' (dates à vérifier)') : '';
  if (e.status === 'ANNOUNCED' && e.registrationOpen && e.registrationDeadline) {
    return l === 'ar'
      ? `التسجيل من ${formatDate(e.registrationOpen)} إلى ${formatDate(e.registrationDeadline)}${verify}`
      : `Inscriptions du ${formatDate(e.registrationOpen)} au ${formatDate(e.registrationDeadline)}${verify}`;
  }
  if (e.registrationDeadline) {
    return l === 'ar'
      ? `آخر أجل للتسجيل: ${formatDate(e.registrationDeadline)}${verify}`
      : `Date limite d’inscription : ${formatDate(e.registrationDeadline)}${verify}`;
  }
  if (e.examDate) {
    return l === 'ar' ? `تاريخ الاختبار: ${formatDate(e.examDate)}${verify}` : `Date de l’épreuve : ${formatDate(e.examDate)}${verify}`;
  }
  return l === 'ar' ? 'الآجال لم تُعلن بعد — تابع الإعلان الرسمي.' : 'Dates pas encore publiées — suivez l’avis officiel.';
}

/** "A concours matching your profile": one message per user per edition, listing the matched positions. */
export function concoursMatchMessage(l: Locale, e: EditionFacts, matched: MatchedPosition[], opts: { suggestFollow?: boolean } = {}): Message {
  const eligible = matched.some((m) => m.result.status === 'ELIGIBLE');
  const unverified = matched.some((m) => m.result.rules_unverified);
  // No rule could be checked (no position on file / no conditions): say nothing about eligibility.
  const checked = matched.some((m) => m.result.checks.length > 0);
  const titles = matched.map((m) => (l === 'ar' ? m.title_ar : m.title_fr)).filter(Boolean);
  if (l === 'ar') {
    return {
      title: `مناظرة جديدة تناسب ملفك: ${e.familyName_ar}`,
      body: lines(
        titles.length ? `الخطط: ${listAr(titles)}` : null,
        datesLine(e, l),
        !checked ? null : eligible ? 'ملفك يستوفي الشروط المعروفة.' : 'أكمل ملفك الشخصي للتأكد من أهليتك (بعض المعطيات ناقصة).',
        unverified ? 'الشروط للتحقق: راجع الإعلان الرسمي قبل الترشح.' : null,
        opts.suggestFollow ? 'تابع المناظرة لتصلك تذكيرات آخر أجل التسجيل وموعد الاختبار.' : null,
      ),
    };
  }
  return {
    title: `Nouveau concours pour votre profil : ${e.familyName_fr}`,
    body: lines(
      titles.length ? `Postes : ${listFr(titles)}` : null,
      datesLine(e, l),
      !checked ? null : eligible ? 'Votre profil remplit les conditions connues.' : 'Complétez votre profil pour confirmer votre éligibilité (informations manquantes).',
      unverified ? 'Conditions à vérifier : consultez l’avis officiel avant de candidater.' : null,
      opts.suggestFollow ? 'Suivez ce concours pour recevoir les rappels de date limite et d’épreuve.' : null,
    ),
  };
}

/** Registration-deadline reminder at D-7, D-2 and D-0. */
export function deadlineMessage(l: Locale, e: EditionFacts, daysLeft: number): Message {
  const date = formatDate(e.registrationDeadline);
  const verify = e.needsVerification ? (l === 'ar' ? ' (تاريخ للتحقق)' : ' (date à vérifier)') : '';
  if (l === 'ar') {
    const title = daysLeft <= 0
      ? `اليوم آخر أجل للتسجيل: ${name(e, l)}`
      : `${remainAr(daysLeft)} على آخر أجل للتسجيل: ${name(e, l)}`;
    return {
      title,
      body: lines(`آخر أجل: ${date}${verify}.`, 'جهّز وثائقك وسجّل عبر الموقع الرسمي ولا تنتظر اليوم الأخير.'),
    };
  }
  const title = daysLeft <= 0
    ? `Dernier jour pour s’inscrire : ${name(e, l)}`
    : `Plus que ${daysFr(daysLeft)} pour s’inscrire : ${name(e, l)}`;
  return {
    title,
    body: lines(`Date limite : ${date}${verify}.`, 'Préparez votre dossier et inscrivez-vous sur le site officiel sans attendre le dernier jour.'),
  };
}

/** Exam reminder at D-7 and D-1. */
export function examMessage(l: Locale, e: EditionFacts, daysLeft: number): Message {
  const date = formatDate(e.examDate);
  const verify = e.needsVerification ? (l === 'ar' ? ' (تاريخ للتحقق)' : ' (date à vérifier)') : '';
  if (l === 'ar') {
    return daysLeft <= 1
      ? { title: `الاختبار غدًا: ${name(e, l)}`, body: lines(`موعد الاختبار: ${date}${verify}.`, 'راجع ملخصاتك، حضّر بطاقة التعريف والاستدعاء، ونم جيدًا. بالتوفيق!') }
      : { title: `الاختبار بعد ${daysAr(daysLeft, true)}: ${name(e, l)}`, body: lines(`موعد الاختبار: ${date}${verify}.`, 'أنجز امتحانًا تجريبيًا كاملًا هذا الأسبوع وراجع أخطاءك.') };
  }
  return daysLeft <= 1
    ? { title: `Épreuve demain : ${name(e, l)}`, body: lines(`Date de l’épreuve : ${date}${verify}.`, 'Relisez vos fiches, préparez votre CIN et votre convocation, et dormez bien. Bonne chance !') }
    : { title: `Épreuve dans ${daysFr(daysLeft)} : ${name(e, l)}`, body: lines(`Date de l’épreuve : ${date}${verify}.`, 'Faites un examen blanc complet cette semaine et revoyez vos erreurs.') };
}

/** Registration window opens today (followers and users who were matched). */
export function registrationOpensMessage(l: Locale, e: EditionFacts): Message {
  const verify = e.needsVerification ? (l === 'ar' ? ' (تاريخ للتحقق)' : ' (date à vérifier)') : '';
  if (l === 'ar') {
    return {
      title: `فُتح باب التسجيل: ${name(e, l)}`,
      body: lines(e.registrationDeadline ? `آخر أجل: ${formatDate(e.registrationDeadline)}${verify}.` : null, 'تحقق من الشروط والوثائق المطلوبة ثم سجّل عبر الموقع الرسمي.'),
    };
  }
  return {
    title: `Inscriptions ouvertes : ${name(e, l)}`,
    body: lines(e.registrationDeadline ? `Date limite : ${formatDate(e.registrationDeadline)}${verify}.` : null, 'Vérifiez les conditions et les pièces demandées, puis inscrivez-vous sur le site officiel.'),
  };
}

/** Admin-triggered update of a followed edition (dates changed, results published…). */
export function concoursUpdateMessage(l: Locale, e: EditionFacts, summary: { ar: string; fr: string }): Message {
  return l === 'ar'
    ? { title: `تحديث: ${name(e, l)}`, body: lines(summary.ar, datesLine(e, l)) }
    : { title: `Mise à jour : ${name(e, l)}`, body: lines(summary.fr, datesLine(e, l)) };
}

export function studyReminderMessage(l: Locale, s: { streak: number; familyName?: string | null; daysToExam?: number | null }): Message {
  if (l === 'ar') {
    return {
      title: 'حصة اليوم في انتظارك',
      body: lines(
        s.familyName && s.daysToExam != null && s.daysToExam > 0 ? `${remainAr(s.daysToExam)} على ${s.familyName}.` : null,
        s.streak >= 2 ? `سلسلتك الحالية: ${daysAr(s.streak)}. حافظ عليها، 10 دقائق تكفي.` : '10 دقائق اليوم تقرّبك من النجاح.',
      ),
    };
  }
  return {
    title: 'Votre séance du jour vous attend',
    body: lines(
      s.familyName && s.daysToExam != null && s.daysToExam > 0 ? `J-${s.daysToExam} avant ${s.familyName}.` : null,
      s.streak >= 2 ? `Gardez votre série (${daysFr(s.streak)} d’affilée). 10 minutes suffisent.` : '10 minutes aujourd’hui vous rapprochent de la réussite.',
    ),
  };
}

export function streakAtRiskMessage(l: Locale, s: { streak: number; freezeWillBeUsed: boolean }): Message {
  if (l === 'ar') {
    return {
      title: `سلسلتك (${daysAr(s.streak)}) في خطر`,
      body: s.freezeWillBeUsed
        ? 'أجب عن سؤال واحد اليوم للحفاظ عليها دون استعمال يوم تجميد.'
        : 'أجب عن سؤال واحد قبل منتصف الليل حتى لا تخسرها.',
    };
  }
  return {
    title: `Votre série de ${daysFr(s.streak)} est en danger`,
    body: s.freezeWillBeUsed
      ? 'Répondez à une question aujourd’hui pour la garder sans utiliser de gel de série.'
      : 'Répondez à une question avant minuit pour ne pas la perdre.',
  };
}

export function subscriptionExpiredMessage(l: Locale): Message {
  return l === 'ar'
    ? { title: 'انتهى اشتراكك المميز', body: 'انتهت صلاحية اشتراكك. جدّده لمواصلة الامتحانات التجريبية والتدريب غير المحدود.' }
    : { title: 'Votre abonnement Premium a expiré', body: 'Renouvelez-le pour continuer les examens blancs et l’entraînement illimité.' };
}

export function subscriptionEndingMessage(l: Locale, daysLeft: number, endsOn: string): Message {
  return l === 'ar'
    ? { title: daysLeft <= 1 ? 'اشتراكك ينتهي غدًا' : `اشتراكك ينتهي بعد ${daysAr(daysLeft, true)}`, body: `ينتهي اشتراكك المميز يوم ${formatDate(endsOn)}. جدّده لتواصل التحضير دون انقطاع.` }
    : { title: daysLeft <= 1 ? 'Votre abonnement se termine demain' : `Votre abonnement se termine dans ${daysFr(daysLeft)}`, body: `Votre abonnement Premium prend fin le ${formatDate(endsOn)}. Renouvelez-le pour continuer sans interruption.` };
}

export interface WeeklyRecap {
  xp: number;
  answered: number;
  streak: number;
  nextDeadline: { familyName_ar: string; familyName_fr: string; date: string } | null;
}

/** Sunday recap for users who practised this week: effort, streak and the closest deadline they follow. */
export function weeklyDigestMessage(l: Locale, r: WeeklyRecap): Message {
  if (l === 'ar') {
    return {
      title: 'حصيلة أسبوعك',
      body: lines(
        r.answered > 0 ? `هذا الأسبوع: ${questionsAr(r.answered)} و${r.xp} XP.` : `هذا الأسبوع: ${r.xp} XP.`,
        r.streak >= 2 ? `سلسلتك الحالية: ${daysAr(r.streak)}.` : null,
        r.nextDeadline ? `أقرب آخر أجل للتسجيل: ${r.nextDeadline.familyName_ar} — ${formatDate(r.nextDeadline.date)}.` : null,
        'واصل، كل حصة تقرّبك من النجاح.',
      ),
    };
  }
  return {
    title: 'Votre bilan de la semaine',
    body: lines(
      r.answered > 0 ? `Cette semaine : ${r.answered} question${r.answered > 1 ? 's' : ''} et ${r.xp} XP.` : `Cette semaine : ${r.xp} XP.`,
      r.streak >= 2 ? `Série en cours : ${daysFr(r.streak)}.` : null,
      r.nextDeadline ? `Prochaine date limite : ${r.nextDeadline.familyName_fr} — ${formatDate(r.nextDeadline.date)}.` : null,
      'Continuez : chaque séance vous rapproche de la réussite.',
    ),
  };
}

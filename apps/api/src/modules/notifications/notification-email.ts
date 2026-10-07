import type { Locale, NotificationType } from '@ctn/shared';

/**
 * Notification emails are written in the recipient's language (Arabic → RTL, French → LTR), unlike the bilingual
 * transactional emails of the auth module. Inline styles only: mail clients strip <style>.
 */
export interface NotificationEmailInput {
  locale: Locale;
  type: NotificationType;
  title: string;
  body: string;
  /** Absolute CTA link (APP_URL + path), or null. */
  ctaUrl: string | null;
  unsubscribeUrl: string;
  settingsUrl: string;
}

export interface NotificationEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const CTA: Partial<Record<NotificationType, { ar: string; fr: string }>> = {
  CONCOURS_MATCH: { ar: 'عرض المناظرة', fr: 'Voir le concours' },
  CONCOURS_UPDATE: { ar: 'عرض التفاصيل', fr: 'Voir les détails' },
  DEADLINE_REMINDER: { ar: 'عرض شروط التسجيل', fr: 'Voir les modalités d’inscription' },
  EXAM_REMINDER: { ar: 'مواصلة التحضير', fr: 'Continuer la préparation' },
  STUDY_REMINDER: { ar: 'ابدأ حصة اليوم', fr: 'Commencer la séance du jour' },
  STREAK_AT_RISK: { ar: 'أجب عن سؤال الآن', fr: 'Répondre à une question' },
  SUBSCRIPTION: { ar: 'إدارة الاشتراك', fr: 'Gérer mon abonnement' },
};
const DEFAULT_CTA = { ar: 'فتح Concours TN', fr: 'Ouvrir Concours TN' };

const FOOTER = {
  ar: {
    disclaimer: 'Concours TN منصة مستقلة وليست موقعًا رسميًا: ارجع دائمًا إلى البلاغ الرسمي قبل الترشح.',
    why: 'تلقيت هذا البريد لأنك فعّلت تنبيهات Concours TN.',
    settings: 'إعدادات التنبيهات',
    unsubscribe: 'إيقاف رسائل البريد',
  },
  fr: {
    disclaimer: 'Concours TN est une plateforme indépendante, pas un site officiel : référez-vous toujours à l’avis officiel avant de candidater.',
    why: 'Vous recevez cet e-mail car vous avez activé les alertes Concours TN.',
    settings: 'Préférences de notification',
    unsubscribe: 'Ne plus recevoir d’e-mails',
  },
};

export function notificationEmail(n: NotificationEmailInput): NotificationEmail {
  const rtl = n.locale === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const cta = (CTA[n.type] ?? DEFAULT_CTA)[n.locale];
  const f = FOOTER[n.locale];
  const paragraphs = n.body.split(/\n+/).map((p) => p.trim()).filter(Boolean);

  const button = n.ctaUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(n.ctaUrl)}" style="background:#0f766e;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">${escapeHtml(cta)}</a></p>
      <p dir="ltr" style="font-size:12px;color:#6b7280;word-break:break-all;text-align:${align}">${escapeHtml(n.ctaUrl)}</p>`
    : '';

  const html = `<!doctype html><html lang="${n.locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(n.title)}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Tahoma,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px" dir="${dir}">
    <div style="background:#ffffff;border-radius:12px;padding:24px;text-align:${align}">
      <p style="margin:0 0 16px;font-weight:bold;color:#0f766e">${rtl ? 'مناظرات تونس · Concours TN' : 'Concours TN · مناظرات تونس'}</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.4;color:#111827">${escapeHtml(n.title)}</h1>
      ${paragraphs.map((p) => `<p style="margin:0 0 10px;line-height:1.7;color:#374151">${escapeHtml(p)}</p>`).join('\n      ')}
      ${button}
    </div>
    <p style="font-size:12px;color:#6b7280;text-align:${align};line-height:1.6">
      ${escapeHtml(f.disclaimer)}<br>
      ${escapeHtml(f.why)}<br>
      <a href="${escapeHtml(n.settingsUrl)}" style="color:#6b7280">${escapeHtml(f.settings)}</a> ·
      <a href="${escapeHtml(n.unsubscribeUrl)}" style="color:#6b7280">${escapeHtml(f.unsubscribe)}</a>
    </p>
  </div>
</body></html>`;

  const text = [
    n.title,
    '',
    ...paragraphs,
    ...(n.ctaUrl ? ['', `${cta}: ${n.ctaUrl}`] : []),
    '',
    '—',
    f.disclaimer,
    f.why,
    `${f.settings}: ${n.settingsUrl}`,
    `${f.unsubscribe}: ${n.unsubscribeUrl}`,
  ].join('\n');

  return { subject: `${n.title} — Concours TN`, html, text };
}

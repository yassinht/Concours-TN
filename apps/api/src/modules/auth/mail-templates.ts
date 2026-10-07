/** Bilingual (Arabic first, French second) transactional emails. Plain inline styles: mail clients ignore <style>. */

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

interface Block {
  title: string;
  paragraphs: string[];
  cta?: string;
}

function render(ar: Block, fr: Block, url: string | null, footer: { ar: string; fr: string }): string {
  const button = (label: string) =>
    url
      ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#0f766e;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">${escapeHtml(label)}</a></p>`
      : '';
  const section = (b: Block, dir: 'rtl' | 'ltr', lang: string) => `
    <div dir="${dir}" lang="${lang}" style="text-align:${dir === 'rtl' ? 'right' : 'left'};padding:8px 0">
      <h2 style="margin:0 0 12px;font-size:20px;color:#111827">${escapeHtml(b.title)}</h2>
      ${b.paragraphs.map((p) => `<p style="margin:0 0 10px;line-height:1.6;color:#374151">${escapeHtml(p)}</p>`).join('')}
      ${b.cta ? button(b.cta) : ''}
    </div>`;
  const link = url
    ? `<p dir="ltr" style="font-size:12px;color:#6b7280;word-break:break-all">${escapeHtml(url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Tahoma,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#ffffff;border-radius:12px;padding:24px">
      <p style="margin:0 0 16px;font-weight:bold;color:#0f766e">Concours TN · مناظرات تونس</p>
      ${section(ar, 'rtl', 'ar')}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
      ${section(fr, 'ltr', 'fr')}
      ${link}
    </div>
    <p dir="rtl" style="font-size:12px;color:#6b7280;text-align:right">${escapeHtml(footer.ar)}</p>
    <p dir="ltr" style="font-size:12px;color:#6b7280">${escapeHtml(footer.fr)}</p>
  </div></body></html>`;
}

function toText(ar: Block, fr: Block, url: string | null): string {
  return [ar.title, ...ar.paragraphs, url ?? '', '', fr.title, ...fr.paragraphs, url ?? ''].join('\n').trim();
}

const IGNORE = {
  ar: 'إذا لم تطلب هذا البريد، يمكنك تجاهله بأمان.',
  fr: 'Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet e-mail.',
};

export function magicLinkMail(url: string, minutes: number): MailContent {
  const ar: Block = {
    title: 'رابط الدخول إلى حسابك',
    paragraphs: [`اضغط على الزر للدخول مباشرة. الرابط صالح لمدة ${minutes} دقيقة ولمرة واحدة فقط.`],
    cta: 'الدخول إلى Concours TN',
  };
  const fr: Block = {
    title: 'Votre lien de connexion',
    paragraphs: [`Cliquez sur le bouton pour vous connecter. Le lien est valable ${minutes} minutes et une seule fois.`],
    cta: 'Se connecter à Concours TN',
  };
  return { subject: 'رابط الدخول · Lien de connexion — Concours TN', html: render(ar, fr, url, IGNORE), text: toText(ar, fr, url) };
}

export function resetPasswordMail(url: string, minutes: number): MailContent {
  const ar: Block = {
    title: 'إعادة تعيين كلمة السر',
    paragraphs: [`طلبت إعادة تعيين كلمة السر. الرابط صالح لمدة ${minutes} دقيقة ولمرة واحدة فقط.`],
    cta: 'اختيار كلمة سر جديدة',
  };
  const fr: Block = {
    title: 'Réinitialisation du mot de passe',
    paragraphs: [`Vous avez demandé à réinitialiser votre mot de passe. Le lien est valable ${minutes} minutes, une seule fois.`],
    cta: 'Choisir un nouveau mot de passe',
  };
  return { subject: 'كلمة السر · Mot de passe — Concours TN', html: render(ar, fr, url, IGNORE), text: toText(ar, fr, url) };
}

/** Sent after registration: welcome + email confirmation (confirmed addresses are the ones concours alerts go to). */
export function welcomeMail(name: string | null, verifyUrl: string | null): MailContent {
  const hiAr = name ? `مرحبًا ${name}،` : 'مرحبًا،';
  const hiFr = name ? `Bonjour ${name},` : 'Bonjour,';
  const ar: Block = {
    title: 'أهلًا بك في Concours TN',
    paragraphs: [
      hiAr,
      'حسابك جاهز. أكمل ملفك الشخصي (تاريخ الولادة، الشهادة، الاختصاص) لنُعلمك فور فتح مناظرة تتوافق مع شروطك.',
      ...(verifyUrl ? ['أكّد بريدك الإلكتروني لتصلك تنبيهات المناظرات والمواعيد النهائية.'] : []),
    ],
    cta: verifyUrl ? 'تأكيد البريد الإلكتروني' : undefined,
  };
  const fr: Block = {
    title: 'Bienvenue sur Concours TN',
    paragraphs: [
      hiFr,
      'Votre compte est prêt. Complétez votre profil (date de naissance, diplôme, spécialité) : nous vous alerterons dès qu’un concours correspondant à vos conditions ouvre.',
      ...(verifyUrl ? ['Confirmez votre adresse e-mail pour recevoir les alertes concours et les rappels de dates limites.'] : []),
    ],
    cta: verifyUrl ? 'Confirmer mon e-mail' : undefined,
  };
  return {
    subject: 'مرحبًا بك · Bienvenue — Concours TN',
    html: render(ar, fr, verifyUrl, { ar: 'تلقيت هذا البريد لأنك أنشأت حسابًا على Concours TN.', fr: 'Vous recevez cet e-mail car vous avez créé un compte Concours TN.' }),
    text: toText(ar, fr, verifyUrl),
  };
}

export function verifyEmailMail(url: string): MailContent {
  const ar: Block = { title: 'تأكيد البريد الإلكتروني', paragraphs: ['اضغط على الزر لتأكيد بريدك وتفعيل تنبيهات المناظرات.'], cta: 'تأكيد البريد' };
  const fr: Block = { title: 'Confirmez votre e-mail', paragraphs: ['Cliquez sur le bouton pour confirmer votre adresse et activer les alertes concours.'], cta: 'Confirmer' };
  return { subject: 'تأكيد البريد · Confirmation e-mail — Concours TN', html: render(ar, fr, url, IGNORE), text: toText(ar, fr, url) };
}

export function passwordChangedMail(): MailContent {
  const ar: Block = { title: 'تم تغيير كلمة السر', paragraphs: ['تم تغيير كلمة سر حسابك. إذا لم تقم بذلك، استعمل "نسيت كلمة السر" فورًا.'] };
  const fr: Block = { title: 'Mot de passe modifié', paragraphs: ['Le mot de passe de votre compte a été modifié. Si ce n’était pas vous, utilisez « mot de passe oublié » immédiatement.'] };
  return { subject: 'كلمة السر · Mot de passe modifié — Concours TN', html: render(ar, fr, null, IGNORE), text: toText(ar, fr, null) };
}

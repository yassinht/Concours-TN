'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Gift, MessageCircle, Send, Share2, UserPlus, Users } from 'lucide-react';
import { Button, ButtonLink, Stat } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { ErrorState, PageHeader, Skeleton } from '../bits';
import { countLabel } from '../format';
import { track, useApi } from '../use-api';

interface Referral { code: string; link: string; invited: number; rewarded: number; rewardDays: number; earnedDays?: number }

function shareMessage(locale: 'ar' | 'fr', link: string, days: number): string {
  return locale === 'ar'
    ? `أستعد للمناظرات العمومية مع Concours TN 🇹🇳: اختبار تشخيصي مجاني، بنك أسئلة بالإصلاح، وتنبيهات بالمناظرات التي تناسب ملفك.\nسجّل برابطي واحصل على ${countLabel('ar', days, 'day')} بريميوم مجانًا 🎁\n${link}`
    : `Je prépare les concours publics avec Concours TN 🇹🇳 : diagnostic gratuit, questions corrigées et alertes des concours qui correspondent à ton profil.\nInscris-toi avec mon lien et reçois ${countLabel('fr', days, 'day')} de Premium offerts 🎁\n${link}`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without async clipboard (older WebViews).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function ReferralView() {
  const tr = useT();
  const { locale } = useLocale();
  const { me } = useSession();
  const registered = !!me && !me.isGuest;
  const ref = useApi<Referral>(registered ? '/me/referral' : null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === 'function'), []);

  async function doCopy(kind: 'code' | 'link', text: string) {
    if (await copy(text)) {
      setCopied(kind);
      track('referral_copy', { kind });
      window.setTimeout(() => setCopied(null), 2000);
    }
  }

  const header = (
    <PageHeader
      title={tr({ ar: 'ادعُ أصدقاءك', fr: 'Parrainez vos amis' })}
      subtitle={tr({ ar: 'التحضير مع الأصدقاء أسهل — وكل دعوة ناجحة تمنحكما أيام بريميوم مجانية.', fr: 'Se préparer à plusieurs, c’est plus facile — et chaque parrainage réussi vous offre des jours Premium à tous les deux.' })}
    />
  );

  if (!me) return <>{header}<Skeleton className="h-64" /></>;

  if (!registered) {
    return (
      <>
        {header}
        <div className="card flex flex-col items-center gap-3 p-6 text-center">
          <Gift className="size-10 text-accent" aria-hidden />
          <p className="font-bold">{tr({ ar: 'أنشئ حسابًا مجانيًا للحصول على رابط الدعوة الخاص بك', fr: 'Créez un compte gratuit pour obtenir votre lien de parrainage' })}</p>
          <ButtonLink href="/register?next=/app/referral"><UserPlus className="size-4" aria-hidden />{tr({ ar: 'إنشاء حساب', fr: 'Créer un compte' })}</ButtonLink>
        </div>
      </>
    );
  }

  if (ref.loading) return <>{header}<Skeleton className="h-64" /></>;
  if (ref.error || !ref.data) return <>{header}<ErrorState error={ref.error} onRetry={ref.reload} /></>;

  const r = ref.data;
  const message = shareMessage(locale, r.link, r.rewardDays);
  const earned = r.earnedDays ?? r.rewarded * r.rewardDays;
  const shareLinks = [
    { key: 'whatsapp', href: `https://wa.me/?text=${encodeURIComponent(message)}`, label: 'WhatsApp', icon: MessageCircle, cls: 'bg-success text-white' },
    { key: 'facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(r.link)}`, label: 'Facebook', icon: Share2, cls: 'bg-info text-white' },
    { key: 'telegram', href: `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(message.replace(r.link, '').trim())}`, label: 'Telegram', icon: Send, cls: 'bg-info-soft text-info' },
  ];

  async function nativeShare() {
    try {
      await navigator.share({ title: 'Concours TN', text: message });
      track('referral_share', { channel: 'native' });
    } catch {
      /* cancelled */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      <section className="flex flex-col gap-4 rounded-2xl bg-accent-soft p-4 sm:p-5" aria-labelledby="ref-h">
        <h2 id="ref-h" className="flex items-center gap-2 text-lg font-bold text-accent"><Gift className="size-5" aria-hidden />{tr({ ar: `${countLabel('ar', r.rewardDays, 'day')} بريميوم لك ولصديقك`, fr: `${countLabel('fr', r.rewardDays, 'day')} de Premium pour vous et votre ami` })}</h2>
        <ol className="grid gap-2 text-sm sm:grid-cols-3">
          {[
            { ar: 'شارك رابطك أو رمزك', fr: 'Partagez votre lien ou code' },
            { ar: 'يسجّل صديقك عبر الرابط', fr: 'Votre ami s’inscrit avec le lien' },
            { ar: 'عند إنجازه للاختبار التشخيصي، تحصلان معًا على الأيام المجانية', fr: 'Dès qu’il termine son diagnostic, vous recevez tous les deux les jours offerts' },
          ].map((s, i) => (
            <li key={i} className="flex items-start gap-2 rounded-xl bg-surface p-3">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">{i + 1}</span>
              <span>{tr(s)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card flex flex-col gap-4 p-4" aria-labelledby="ref-share">
        <h2 id="ref-share" className="text-lg font-bold">{tr({ ar: 'رابطك ورمزك', fr: 'Votre lien et votre code' })}</h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{tr({ ar: 'رمز الدعوة', fr: 'Code de parrainage' })}</span>
          <div className="flex items-center gap-2">
            <code className="flex h-12 flex-1 items-center justify-center rounded-xl border-2 border-dashed border-accent bg-surface-2 text-xl font-extrabold tracking-[0.2em]" dir="ltr">{r.code}</code>
            <Button variant="secondary" onClick={() => doCopy('code', r.code)} className="h-12" aria-label={tr({ ar: 'نسخ الرمز', fr: 'Copier le code' })}>
              {copied === 'code' ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ref-link" className="text-sm font-semibold">{tr({ ar: 'رابط الدعوة', fr: 'Lien de parrainage' })}</label>
          <div className="flex items-center gap-2">
            <input id="ref-link" readOnly value={r.link} dir="ltr" onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 text-sm" />
            <Button onClick={() => doCopy('link', r.link)} className="h-11 shrink-0">
              {copied === 'link' ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied === 'link' ? tr({ ar: 'نُسخ', fr: 'Copié' }) : tr({ ar: 'نسخ', fr: 'Copier' })}
            </Button>
          </div>
          <p className="sr-only" aria-live="polite">{copied ? tr({ ar: 'تم النسخ', fr: 'Copié' }) : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canShare && (
            <Button variant="secondary" onClick={nativeShare}><Share2 className="size-4" aria-hidden />{tr({ ar: 'مشاركة', fr: 'Partager' })}</Button>
          )}
          {shareLinks.map((s) => {
            const Icon = s.icon;
            return (
              <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" onClick={() => track('referral_share', { channel: s.key })}
                className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-[15px] font-semibold hover:opacity-90 ${s.cls}`}>
                <Icon className="size-4" aria-hidden />{s.label}
              </a>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="ref-stats">
        <h2 id="ref-stats" className="mb-2 flex items-center gap-2 text-lg font-bold"><Users className="size-5 text-primary" aria-hidden />{tr({ ar: 'نتائجك', fr: 'Vos résultats' })}</h2>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={tr({ ar: 'دعوات مسجّلة', fr: 'Inscrits' })} value={r.invited} />
          <Stat label={tr({ ar: 'دعوات ناجحة', fr: 'Validés' })} value={r.rewarded} />
          <Stat label={tr({ ar: 'أيام مكتسبة', fr: 'Jours gagnés' })} value={earned} />
        </div>
        {r.invited > r.rewarded && (
          <p className="mt-2 text-sm text-muted">
            {tr({ ar: `${countLabel('ar', r.invited - r.rewarded, 'friend')} لم ينجز الاختبار التشخيصي بعد — ذكّرهم!`, fr: `${countLabel('fr', r.invited - r.rewarded, 'friend')} n’${r.invited - r.rewarded > 1 ? 'ont' : 'a'} pas encore fait le diagnostic — relancez-les !` })}
          </p>
        )}
      </section>
    </div>
  );
}

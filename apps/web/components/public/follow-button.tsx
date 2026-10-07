'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BellPlus, BellRing, Check, Mail, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui';
import { useSession, useT } from '@/components/providers';
import { useFollows } from './follows';
import { PushOptIn } from './push-optin';

/**
 * "نبّهني عند فتح المناظرة": ensures a (guest) session, follows the family, then invites to complete the profile
 * (so eligibility-based alerts can be personal), enable phone notifications, and register for e-mail alerts.
 */
export function FollowButton({ slug, variant = 'full' }: { slug: string; variant?: 'full' | 'compact' }) {
  const tr = useT();
  const { me } = useSession();
  const { follows, ready, follow, unfollow } = useFollows();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [justFollowed, setJustFollowed] = useState(false);
  const followed = follows.has(slug);

  async function onFollow() {
    setBusy(true);
    setError(false);
    try {
      await follow(slug);
      setJustFollowed(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function onUnfollow() {
    setBusy(true);
    setError(false);
    try {
      await unfollow(slug);
      setJustFollowed(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const errorText = error && (
    <p className="text-xs text-danger" role="alert">{tr({ ar: 'تعذّر الحفظ. تحقق من الاتصال وحاول مجددًا.', fr: 'Échec de l’enregistrement. Vérifiez la connexion et réessayez.' })}</p>
  );

  if (variant === 'compact') {
    return (
      <div className="flex flex-col gap-1">
        {followed ? (
          <Button variant="ghost" size="sm" onClick={onUnfollow} loading={busy} aria-pressed className="min-h-11 text-success" title={tr({ ar: 'اضغط لإلغاء التنبيهات', fr: 'Toucher pour retirer l’alerte' })}>
            <Check className="size-4" aria-hidden />
            {tr({ ar: 'ضمن تنبيهاتي', fr: 'Dans mes alertes' })}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onFollow} loading={busy || !ready} aria-pressed={false} className="min-h-11">
            <BellPlus className="size-4" aria-hidden />
            {tr({ ar: 'أضف إلى تنبيهاتي', fr: 'Ajouter à mes alertes' })}
          </Button>
        )}
        {errorText}
      </div>
    );
  }

  const isGuest = !me || me.isGuest;
  const showInvite = followed && (justFollowed || !me?.onboarding.hasProfile);

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {followed ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-success-soft px-4 text-sm font-semibold text-success">
            <BellRing className="size-4" aria-hidden />
            {tr({ ar: 'ستصلك التنبيهات الخاصة بهذه المناظرة', fr: 'Vous serez alerté(e) pour ce concours' })}
          </span>
          <Button variant="ghost" size="sm" onClick={onUnfollow} loading={busy} className="min-h-11 text-muted">
            {tr({ ar: 'إلغاء المتابعة', fr: 'Ne plus suivre' })}
          </Button>
        </div>
      ) : (
        <Button variant="accent" size="lg" onClick={onFollow} loading={busy} disabled={!ready} className="self-start">
          <BellPlus className="size-5" aria-hidden />
          {tr({ ar: 'نبّهني عند فتح المناظرة', fr: 'M’alerter à l’ouverture' })}
        </Button>
      )}
      {errorText}

      {showInvite && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm">
            {tr({
              ar: 'سننبّهك عند فتح باب الترشح، ثم قبل آخر أجل بـ7 أيام وبيومين ويوم الأجل نفسه.',
              fr: 'Nous vous alerterons à l’ouverture des inscriptions, puis 7 jours, 2 jours et le jour même de la clôture.',
            })}
          </p>
          <Link href={`/concours/${slug}/eligibility`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline">
            <UserCheck className="size-4" aria-hidden />
            {tr({ ar: 'أكمل ملفك وتحقق من أهليتك لتصلك التنبيهات المناسبة لك فقط', fr: 'Complétez votre profil et vérifiez votre éligibilité pour des alertes ciblées' })}
          </Link>
          <PushOptIn compact />
          {isGuest && (
            <Link href={`/register?next=${encodeURIComponent(`/concours/${slug}`)}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline">
              <Mail className="size-4" aria-hidden />
              {tr({ ar: 'أنشئ حسابًا مجانيًا لتصلك التنبيهات بالبريد الإلكتروني أيضًا', fr: 'Créez un compte gratuit pour recevoir aussi les alertes par e-mail' })}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

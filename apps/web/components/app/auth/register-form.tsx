'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, Gift, ShieldCheck, UserPlus } from 'lucide-react';
import type { MeDTO } from '@ctn/shared';
import { Alert, Button, ButtonLink, Field, Input } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import type { Bi } from '@/lib/i18n';
import { errorText } from '../format';
import { errorCode, track } from '../use-api';
import { AuthCard, GoogleButton, PasswordInput, PasswordStrength } from './auth-ui';

const REF_RE = /^[A-Za-z0-9_-]{3,40}$/;

/** Referral code remembered from an earlier landing on the site (?ref= kept in the UTM session store). */
function storedRef(): string {
  try {
    const raw = sessionStorage.getItem('ctn_utm');
    const ref = raw ? (JSON.parse(raw) as Record<string, string>).ref : undefined;
    return ref && REF_RE.test(ref) ? ref : '';
  } catch {
    return '';
  }
}

export function RegisterForm({ next, refCode }: { next: string; refCode?: string }) {
  const tr = useT();
  const router = useRouter();
  const { locale } = useLocale();
  const { me, refresh } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState(refCode && REF_RE.test(refCode) ? refCode.toUpperCase() : '');
  const [showReferral, setShowReferral] = useState(!!refCode);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: Bi; code: string } | null>(null);

  useEffect(() => {
    if (referral) return;
    const r = storedRef();
    if (r) {
      setReferral(r.toUpperCase());
      setShowReferral(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError({ text: { ar: 'كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل.', fr: 'Le mot de passe doit contenir au moins 8 caractères.' }, code: 'VALIDATION_FAILED' });
      return;
    }
    setBusy(true);
    setError(null);
    const code = referral.trim();
    try {
      await api<{ user: MeDTO }>('/auth/register', {
        body: { name: name.trim(), email: email.trim(), password, locale, ...(code && REF_RE.test(code) ? { referralCode: code } : {}) },
      });
      track('signup', { method: 'password', referral: !!code, wasGuest: !!me?.isGuest, next });
      await refresh();
      router.replace(next);
    } catch (err) {
      const c = errorCode(err);
      setError({ text: errorText(c), code: c });
      setBusy(false);
    }
  }

  if (me && !me.isGuest) {
    return (
      <AuthCard title={tr({ ar: 'لديك حساب بالفعل', fr: 'Vous avez déjà un compte' })} subtitle={<span dir="auto">{me.email ?? me.name}</span>}>
        <ButtonLink href={next} size="lg" block>{tr({ ar: 'متابعة إلى فضائي', fr: 'Continuer vers mon espace' })}</ButtonLink>
      </AuthCard>
    );
  }

  const loginHref = `/login${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <AuthCard
      title={tr({ ar: 'أنشئ حسابك المجاني', fr: 'Créez votre compte gratuit' })}
      subtitle={tr({ ar: 'احفظ تقدمك، واستقبل تنبيهات المناظرات التي تناسب ملفك.', fr: 'Sauvegardez votre progression et recevez les alertes des concours qui vous correspondent.' })}
      footer={
        <>
          {tr({ ar: 'لديك حساب؟', fr: 'Déjà inscrit ?' })}{' '}
          <Link href={loginHref} className="font-semibold text-primary underline-offset-2 hover:underline">{tr({ ar: 'سجّل الدخول', fr: 'Se connecter' })}</Link>
        </>
      }
    >
      {me?.isGuest && (
        <p className="flex items-start gap-2 rounded-xl bg-success-soft p-3 text-sm">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <span>
            {tr({
              ar: 'كل ما أنجزته كزائر (الاختبار التشخيصي، الإجابات، ملفك والتنبيهات) سيُنقل تلقائيًا إلى حسابك.',
              fr: 'Tout ce que vous avez fait en tant qu’invité (diagnostic, réponses, profil et alertes) est conservé dans votre compte.',
            })}
          </span>
        </p>
      )}

      <GoogleButton next={next} label={tr({ ar: 'التسجيل بحساب Google', fr: 'S’inscrire avec Google' })} />

      {error && (
        <Alert tone="danger">
          {tr(error.text)}
          {error.code === 'EMAIL_TAKEN' && (
            <> <Link href={loginHref} className="font-semibold underline">{tr({ ar: 'تسجيل الدخول', fr: 'Se connecter' })}</Link></>
          )}
        </Alert>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={tr({ ar: 'الاسم', fr: 'Nom' })} htmlFor="name" hint={tr({ ar: 'يظهر الاسم الأول فقط في الترتيب العام.', fr: 'Seul le prénom apparaît dans le classement.' })}>
          <Input id="name" name="name" autoComplete="name" enterKeyHint="next" required maxLength={120} dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tr({ ar: 'البريد الإلكتروني', fr: 'E-mail' })} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" enterKeyHint="next" required maxLength={200} dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={tr({ ar: 'كلمة المرور', fr: 'Mot de passe' })} htmlFor="new-password" hint={tr({ ar: '8 أحرف على الأقل', fr: '8 caractères minimum' })}>
          <PasswordInput id="new-password" name="new-password" autoComplete="new-password" enterKeyHint="done" required minLength={8} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <PasswordStrength value={password} />

        {showReferral ? (
          <Field label={<span className="inline-flex items-center gap-1.5"><Gift className="size-4 text-accent" aria-hidden />{tr({ ar: 'رمز الدعوة (اختياري)', fr: 'Code de parrainage (facultatif)' })}</span>} htmlFor="referral" hint={tr({ ar: 'تحصل أنت وصديقك على أيام بريميوم مجانية بعد إنجازك للاختبار التشخيصي.', fr: 'Vous et votre ami recevez des jours Premium offerts après votre diagnostic.' })}>
            <Input id="referral" name="referral" autoComplete="off" maxLength={40} dir="ltr" value={referral} onChange={(e) => setReferral(e.target.value.toUpperCase())} />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowReferral(true)} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-primary hover:underline">
            <Gift className="size-4" aria-hidden />
            {tr({ ar: 'لدي رمز دعوة', fr: 'J’ai un code de parrainage' })}
          </button>
        )}

        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" />
          <span>
            {tr({ ar: 'أوافق على', fr: 'J’accepte les' })}{' '}
            <Link href="/legal/terms" target="_blank" className="font-semibold text-primary underline">{tr({ ar: 'شروط الاستعمال', fr: 'conditions d’utilisation' })}</Link>{' '}
            {tr({ ar: 'و', fr: 'et la' })}{' '}
            <Link href="/legal/privacy" target="_blank" className="font-semibold text-primary underline">{tr({ ar: 'سياسة الخصوصية', fr: 'politique de confidentialité' })}</Link>
            {tr({ ar: ' (حماية المعطيات الشخصية وفق القانون الأساسي عدد 63 لسنة 2004).', fr: ' (protection des données personnelles, loi organique n° 2004-63).' })}
          </span>
        </label>

        <Button type="submit" size="lg" block loading={busy} disabled={!consent}>
          <UserPlus className="size-4" aria-hidden />
          {tr({ ar: 'إنشاء الحساب', fr: 'Créer mon compte' })}
        </Button>
        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          {tr({ ar: 'لن نشارك بريدك مع أي طرف. يمكنك تصدير معطياتك أو حذف حسابك في أي وقت.', fr: 'Votre e-mail n’est jamais partagé. Vous pouvez exporter vos données ou supprimer votre compte à tout moment.' })}
        </p>
      </form>
    </AuthCard>
  );
}

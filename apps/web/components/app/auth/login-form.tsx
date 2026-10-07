'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { KeyRound, Mail, MailCheck } from 'lucide-react';
import type { MeDTO } from '@ctn/shared';
import { Alert, Button, ButtonLink, Field, Input } from '@/components/ui';
import { useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import type { Bi } from '@/lib/i18n';
import { errorText } from '../format';
import { errorCode } from '../use-api';
import { AuthCard, DevLink, GoogleButton, PasswordInput } from './auth-ui';

const QUERY_ERRORS: Record<string, Bi> = {
  link_invalid: { ar: 'رابط الدخول غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.', fr: 'Lien de connexion invalide ou expiré. Demandez-en un nouveau.' },
  google_cancelled: { ar: 'تم إلغاء الدخول عبر Google.', fr: 'Connexion Google annulée.' },
  google_state: { ar: 'انتهت مهلة الدخول عبر Google. أعد المحاولة.', fr: 'La connexion Google a expiré. Réessayez.' },
  google_failed: { ar: 'تعذّر الدخول عبر Google. جرّب البريد الإلكتروني.', fr: 'Connexion Google impossible. Utilisez votre e-mail.' },
};

export function LoginForm({ next, queryError }: { next: string; queryError?: string }) {
  const tr = useT();
  const router = useRouter();
  const { me, refresh } = useSession();
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bi | null>(queryError ? QUERY_ERRORS[queryError] ?? QUERY_ERRORS.google_failed : null);
  const [magicSent, setMagicSent] = useState<{ devLink?: string } | null>(null);
  const [switching, setSwitching] = useState(false);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<{ user: MeDTO }>('/auth/login', { body: { email: email.trim(), password } });
      await refresh();
      router.replace(next);
    } catch (err) {
      setError(errorText(errorCode(err)));
      setBusy(false);
    }
  }

  async function submitMagic(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ok: true; devLink?: string }>('/auth/magic-link', { body: { email: email.trim() } });
      setMagicSent({ devLink: r.devLink });
    } catch (err) {
      setError(errorText(errorCode(err)));
    } finally {
      setBusy(false);
    }
  }

  async function useAnotherAccount() {
    setSwitching(true);
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    await refresh();
    setSwitching(false);
  }

  const registerHref = `/register${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`;

  if (me && !me.isGuest) {
    return (
      <AuthCard title={tr({ ar: 'أنت متصل بالفعل', fr: 'Vous êtes déjà connecté' })} subtitle={<span dir="auto">{me.email ?? me.name}</span>}>
        <ButtonLink href={next} size="lg" block>{tr({ ar: 'متابعة إلى فضائي', fr: 'Continuer vers mon espace' })}</ButtonLink>
        <Button variant="ghost" onClick={useAnotherAccount} loading={switching}>{tr({ ar: 'الدخول بحساب آخر', fr: 'Utiliser un autre compte' })}</Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={tr({ ar: 'تسجيل الدخول', fr: 'Connexion' })}
      subtitle={tr({ ar: 'واصل تحضيرك من حيث توقفت، على أي جهاز.', fr: 'Reprenez votre préparation là où vous l’avez laissée, sur tous vos appareils.' })}
      footer={
        <>
          {tr({ ar: 'ليس لديك حساب؟', fr: 'Pas encore de compte ?' })}{' '}
          <Link href={registerHref} className="font-semibold text-primary underline-offset-2 hover:underline">{tr({ ar: 'أنشئ حسابًا مجانيًا', fr: 'Créer un compte gratuit' })}</Link>
        </>
      }
    >
      <GoogleButton next={next} label={tr({ ar: 'المتابعة بحساب Google', fr: 'Continuer avec Google' })} />

      {error && <Alert tone="danger">{tr(error)}</Alert>}

      {mode === 'password' ? (
        <form onSubmit={submitPassword} className="flex flex-col gap-4">
          <Field label={tr({ ar: 'البريد الإلكتروني', fr: 'E-mail' })} htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" enterKeyHint="next" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={tr({ ar: 'كلمة المرور', fr: 'Mot de passe' })} htmlFor="current-password">
            <PasswordInput id="current-password" name="current-password" autoComplete="current-password" enterKeyHint="go" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="-mt-2 text-end">
            <Link href={`/forgot${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
              {tr({ ar: 'نسيت كلمة المرور؟', fr: 'Mot de passe oublié ?' })}
            </Link>
          </div>
          <Button type="submit" size="lg" block loading={busy}>
            <KeyRound className="size-4" aria-hidden />
            {tr({ ar: 'دخول', fr: 'Se connecter' })}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setMode('magic'); setError(null); }}>
            <Mail className="size-4" aria-hidden />
            {tr({ ar: 'أرسل لي رابط دخول بالبريد (دون كلمة مرور)', fr: 'Recevoir un lien de connexion par e-mail' })}
          </Button>
        </form>
      ) : magicSent ? (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <p className="flex items-start gap-2 rounded-xl bg-success-soft p-3 text-sm">
            <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <span>
              {tr({
                ar: `إذا كان هناك حساب مرتبط بـ ${email}، فقد أرسلنا إليه رابط دخول صالحًا لفترة محدودة. تحقق أيضًا من مجلد الرسائل غير المرغوب فيها.`,
                fr: `Si un compte existe pour ${email}, un lien de connexion temporaire vient d’y être envoyé. Pensez à vérifier les indésirables.`,
              })}
            </span>
          </p>
          <DevLink href={magicSent.devLink} />
          <Button variant="secondary" onClick={() => { setMagicSent(null); setMode('password'); }}>{tr({ ar: 'العودة إلى الدخول بكلمة المرور', fr: 'Revenir au mot de passe' })}</Button>
        </div>
      ) : (
        <form onSubmit={submitMagic} className="flex flex-col gap-4">
          <Field label={tr({ ar: 'البريد الإلكتروني', fr: 'E-mail' })} htmlFor="email" hint={tr({ ar: 'سنرسل لك رابطًا يُدخلك مباشرة دون كلمة مرور.', fr: 'Nous vous enverrons un lien qui vous connecte directement, sans mot de passe.' })}>
            <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" enterKeyHint="send" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" block loading={busy}>
            <Mail className="size-4" aria-hidden />
            {tr({ ar: 'أرسل رابط الدخول', fr: 'Envoyer le lien' })}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setMode('password'); setError(null); }}>{tr({ ar: 'الدخول بكلمة المرور', fr: 'Se connecter avec un mot de passe' })}</Button>
        </form>
      )}
    </AuthCard>
  );
}

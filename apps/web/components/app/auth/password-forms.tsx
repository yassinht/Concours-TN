'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { KeyRound, MailCheck, Send } from 'lucide-react';
import type { MeDTO } from '@ctn/shared';
import { Alert, Button, ButtonLink, Field, Input } from '@/components/ui';
import { useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import type { Bi } from '@/lib/i18n';
import { errorText } from '../format';
import { errorCode } from '../use-api';
import { AuthCard, DevLink, PasswordInput, PasswordStrength } from './auth-ui';

export function ForgotForm({ initialEmail }: { initialEmail?: string }) {
  const tr = useT();
  const [email, setEmail] = useState(initialEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bi | null>(null);
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ok: true; devLink?: string }>('/auth/password/forgot', { body: { email: email.trim() } });
      setSent({ devLink: r.devLink });
    } catch (err) {
      setError(errorText(errorCode(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={tr({ ar: 'نسيت كلمة المرور', fr: 'Mot de passe oublié' })}
      subtitle={tr({ ar: 'أدخل بريدك وسنرسل لك رابطًا لاختيار كلمة مرور جديدة.', fr: 'Saisissez votre e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.' })}
      footer={<Link href="/login" className="font-semibold text-primary hover:underline">{tr({ ar: 'العودة إلى تسجيل الدخول', fr: 'Retour à la connexion' })}</Link>}
    >
      {sent ? (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <p className="flex items-start gap-2 rounded-xl bg-success-soft p-3 text-sm">
            <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <span>
              {tr({
                ar: `إذا كان هناك حساب مرتبط بـ ${email}، ستصلك رسالة خلال دقائق. الرابط صالح لفترة محدودة ولاستعمال واحد.`,
                fr: `Si un compte existe pour ${email}, vous recevrez un e-mail dans quelques minutes. Le lien est temporaire et à usage unique.`,
              })}
            </span>
          </p>
          <DevLink href={sent.devLink} />
          <Button variant="secondary" onClick={() => setSent(null)}>{tr({ ar: 'لم يصلني شيء — أعد الإرسال', fr: 'Rien reçu ? Renvoyer' })}</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Alert tone="danger">{tr(error)}</Alert>}
          <Field label={tr({ ar: 'البريد الإلكتروني', fr: 'E-mail' })} htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" enterKeyHint="send" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" block loading={busy}>
            <Send className="size-4" aria-hidden />
            {tr({ ar: 'أرسل رابط إعادة التعيين', fr: 'Envoyer le lien' })}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetForm({ token }: { token?: string }) {
  const tr = useT();
  const router = useRouter();
  const { refresh } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: Bi; code: string } | null>(null);

  if (!token || token.length < 10) {
    return (
      <AuthCard title={tr({ ar: 'رابط غير صالح', fr: 'Lien invalide' })}>
        <Alert tone="warning">{tr({ ar: 'هذا الرابط ناقص أو منتهي الصلاحية. اطلب رابطًا جديدًا.', fr: 'Ce lien est incomplet ou expiré. Demandez-en un nouveau.' })}</Alert>
        <ButtonLink href="/forgot" block>{tr({ ar: 'طلب رابط جديد', fr: 'Demander un nouveau lien' })}</ButtonLink>
      </AuthCard>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError({ text: { ar: 'كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل.', fr: 'Le mot de passe doit contenir au moins 8 caractères.' }, code: 'VALIDATION_FAILED' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api<{ user: MeDTO }>('/auth/password/reset', { body: { token, password } });
      await refresh();
      router.replace('/app');
    } catch (err) {
      const c = errorCode(err);
      setError({ text: errorText(c === 'BAD_REQUEST' ? 'TOKEN_INVALID' : c), code: c });
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={tr({ ar: 'اختر كلمة مرور جديدة', fr: 'Choisissez un nouveau mot de passe' })}
      subtitle={tr({ ar: 'ستُسجّل دخولك مباشرة بعد الحفظ.', fr: 'Vous serez connecté juste après l’enregistrement.' })}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger">
            {tr(error.text)}
            {error.code === 'TOKEN_INVALID' && <> <Link href="/forgot" className="font-semibold underline">{tr({ ar: 'طلب رابط جديد', fr: 'Demander un nouveau lien' })}</Link></>}
          </Alert>
        )}
        {/* Hidden username helps password managers attach the new password to the right account. */}
        <input type="text" name="username" autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden readOnly value="" />
        <Field label={tr({ ar: 'كلمة المرور الجديدة', fr: 'Nouveau mot de passe' })} htmlFor="new-password" hint={tr({ ar: '8 أحرف على الأقل', fr: '8 caractères minimum' })}>
          <PasswordInput id="new-password" name="new-password" autoComplete="new-password" enterKeyHint="done" required minLength={8} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <PasswordStrength value={password} />
        <Button type="submit" size="lg" block loading={busy}>
          <KeyRound className="size-4" aria-hidden />
          {tr({ ar: 'حفظ كلمة المرور', fr: 'Enregistrer le mot de passe' })}
        </Button>
      </form>
    </AuthCard>
  );
}

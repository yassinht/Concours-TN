'use client';

import Link from 'next/link';
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ExternalLink, Eye, EyeOff, Languages } from 'lucide-react';
import { Input } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';

export function AuthHeader() {
  const tr = useT();
  const { locale, setLocale } = useLocale();
  const next = locale === 'ar' ? 'fr' : 'ar';
  return (
    <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-3">
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 font-extrabold tracking-tight" aria-label={tr({ ar: 'Concours TN — الصفحة الرئيسية', fr: 'Concours TN — accueil' })}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" width={32} height={32} className="size-8 rounded-lg" />
        <span dir="ltr" className="text-[17px]">Concours <span className="text-accent">TN</span></span>
      </Link>
      <button
        type="button"
        onClick={() => setLocale(next)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2"
        aria-label={next === 'fr' ? 'Passer en français' : 'التبديل إلى العربية'}
        lang={next}
      >
        <Languages className="size-4" aria-hidden />
        {next === 'fr' ? 'Français' : 'العربية'}
      </button>
    </header>
  );
}

export function AuthCard({ title, subtitle, children, footer }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-extrabold">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
      {footer && <div className="text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}

/** Password input with a show/hide toggle (pasting allowed, browser password managers supported). */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const tr = useT();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className="pe-12" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 end-0 inline-flex w-11 items-center justify-center rounded-e-xl text-muted hover:text-text"
        aria-label={visible ? tr({ ar: 'إخفاء كلمة المرور', fr: 'Masquer le mot de passe' }) : tr({ ar: 'إظهار كلمة المرور', fr: 'Afficher le mot de passe' })}
        aria-pressed={visible}
        aria-controls={props.id}
      >
        {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </button>
    </div>
  );
}

/** Simple strength hint (length + variety); the API only enforces 8 characters minimum. */
export function PasswordStrength({ value }: { value: string }) {
  const tr = useT();
  if (!value) return null;
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-zA-Z؀-ۿ]/.test(value) && /\d/.test(value)) score++;
  if (/[^a-zA-Z0-9؀-ۿ]/.test(value)) score++;
  const level = value.length < 8 ? 0 : Math.min(3, score);
  const label = [
    { ar: 'قصيرة جدًا (8 أحرف على الأقل)', fr: 'Trop court (8 caractères minimum)' },
    { ar: 'مقبولة', fr: 'Correct' },
    { ar: 'جيدة', fr: 'Bon' },
    { ar: 'قوية', fr: 'Solide' },
  ][level];
  const tone = ['bg-danger', 'bg-warning', 'bg-primary', 'bg-success'][level];
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < Math.max(1, level) ? tone : 'bg-surface-2'}`} />)}
      </div>
      <span className="text-xs text-muted">{tr(label)}</span>
    </div>
  );
}

export function OrDivider() {
  const tr = useT();
  return (
    <div className="flex items-center gap-3 text-xs text-muted" role="separator">
      <span className="h-px flex-1 bg-border" />
      {tr({ ar: 'أو', fr: 'ou' })}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

const GOOGLE_KEY = 'ctn_google_auth';

/**
 * Google sign-in button, shown only when the API has Google configured
 * (GET /auth/google answers 302 when enabled, 404 GOOGLE_DISABLED otherwise).
 */
export function GoogleButton({ next, label }: { next: string; label: ReactNode }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = sessionStorage.getItem(GOOGLE_KEY);
      if (cached === '1' || cached === '0') {
        setAvailable(cached === '1');
        return;
      }
    } catch {
      /* ignore */
    }
    fetch('/api/auth/google', { redirect: 'manual', credentials: 'include' })
      .then((res) => {
        const ok = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
        if (cancelled) return;
        setAvailable(ok);
        try {
          sessionStorage.setItem(GOOGLE_KEY, ok ? '1' : '0');
        } catch {
          /* ignore */
        }
      })
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!available) return null;
  return (
    <>
      <a
        href={`/api/auth/google?next=${encodeURIComponent(next)}`}
        className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border bg-surface px-4 text-[15px] font-semibold hover:bg-surface-2"
      >
        <GoogleMark />
        {label}
      </a>
      <OrDivider />
    </>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Development helper: the API returns the e-mailed link when NODE_ENV ≠ production. */
export function DevLink({ href }: { href?: string }) {
  const tr = useT();
  if (!href) return null;
  return (
    <div className="rounded-xl border border-dashed border-warning bg-warning-soft p-3 text-xs">
      <p className="font-semibold text-warning">{tr({ ar: 'وضع التطوير — الرابط المرسل بالبريد:', fr: 'Mode développement — lien envoyé par e-mail :' })}</p>
      <a href={href} className="mt-1 inline-flex items-center gap-1 break-all font-mono text-text underline" dir="ltr">
        {href}
        <ExternalLink className="size-3 shrink-0" aria-hidden />
      </a>
    </div>
  );
}

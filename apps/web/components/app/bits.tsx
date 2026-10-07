'use client';

import clsx from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Crown, RotateCcw, TriangleAlert, WifiOff } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { errorText } from './format';
import { errorCode } from './use-api';

export function PageHeader({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: string; actions?: ReactNode }) {
  const tr = useT();
  const { locale } = useLocale();
  const BackIcon = locale === 'ar' ? ArrowRight : ArrowLeft;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {back && (
        <Link href={back} className="-ms-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-2 text-sm font-semibold text-muted hover:text-text">
          <BackIcon className="size-4" aria-hidden />
          {tr({ ar: 'رجوع', fr: 'Retour' })}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-extrabold leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 id={id} className="text-lg font-bold">{children}</h2>
      {action}
    </div>
  );
}

/** Error block with the API code translated and a retry button. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const tr = useT();
  const code = errorCode(error);
  const offline = code === 'NETWORK';
  const Icon = offline ? WifiOff : TriangleAlert;
  return (
    <div className={clsx('flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center', className)} role="alert">
      <Icon className="size-7 text-danger" aria-hidden />
      <p className="font-semibold">{tr(errorText(code))}</p>
      {offline && (
        <Link href="/app/offline" className="text-sm font-semibold text-primary underline">{tr({ ar: 'تدرّب بالمحتوى المحمّل', fr: 'Réviser le contenu téléchargé' })}</Link>
      )}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
          {tr({ ar: 'إعادة المحاولة', fr: 'Réessayer' })}
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-2xl bg-surface-2', className)} aria-hidden />;
}

/** Premium upsell (free users). `reason` tailors the message: daily limit reached, mock, offline, generic. */
export function UpsellCard({ reason = 'generic', guest, className }: { reason?: 'limit' | 'mock' | 'offline' | 'generic'; guest?: boolean; className?: string }) {
  const tr = useT();
  const title = {
    limit: { ar: 'بلغت حد الأسئلة المجانية لليوم', fr: 'Vous avez atteint la limite gratuite du jour' },
    mock: { ar: 'امتحانات تجريبية غير محدودة', fr: 'Examens blancs illimités' },
    offline: { ar: 'التحضير دون اتصال ميزة بريميوم', fr: 'La révision hors ligne est une fonction Premium' },
    generic: { ar: 'سرّع تحضيرك مع بريميوم', fr: 'Accélérez votre préparation avec Premium' },
  }[reason];
  return (
    <div className={clsx('flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4', className)}>
      <p className="flex items-center gap-2 font-bold text-accent">
        <Crown className="size-5" aria-hidden />
        {tr(title)}
      </p>
      <ul className="grid gap-1 text-sm">
        <li>• {tr({ ar: 'أسئلة غير محدودة كل يوم مع التصحيح والشرح', fr: 'Questions illimitées chaque jour, avec corrigés et explications' })}</li>
        <li>• {tr({ ar: 'امتحانات تجريبية بنفس صيغة المناظرة وتوقيتها', fr: 'Examens blancs au format et au chronométrage du concours' })}</li>
        <li>• {tr({ ar: 'المساعد الذكي لشرح الأخطاء وتحليل مفصل لتقدمك', fr: 'Tuteur pour comprendre vos erreurs et analyses détaillées' })}</li>
        <li>• {tr({ ar: 'حزم للتحضير دون اتصال بالإنترنت', fr: 'Packs de révision hors ligne' })}</li>
      </ul>
      <ButtonLink href={guest ? '/register?next=/app/billing' : '/app/billing'} variant="accent" className="self-start">
        <Crown className="size-4" aria-hidden />
        {guest ? tr({ ar: 'أنشئ حسابًا ثم اشترك', fr: 'Créer un compte puis s’abonner' }) : tr({ ar: 'اكتشف العروض', fr: 'Voir les offres' })}
      </ButtonLink>
    </div>
  );
}

/** Toggle switch (role="switch"), ≥44px touch target. */
export function Switch({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean; id: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-semibold">{label}</label>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="group inline-flex min-h-11 shrink-0 items-center disabled:opacity-50"
      >
        <span className={clsx('relative inline-flex h-7 w-12 items-center rounded-full transition', checked ? 'bg-primary' : 'bg-border')}>
          <span className={clsx('absolute size-5 rounded-full bg-white shadow transition-[inset-inline-start]', checked ? 'start-6' : 'start-1')} />
        </span>
      </button>
    </div>
  );
}

/** Multi-select chip (checkbox semantics). */
export function Chip({ selected, onToggle, children, icon }: { selected: boolean; onToggle: () => void; children: ReactNode; icon?: ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={clsx(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition',
        selected ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted hover:text-text',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

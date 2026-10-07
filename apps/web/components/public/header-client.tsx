'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, Languages, LogIn } from 'lucide-react';
import { ButtonLink } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import type { Bi } from '@/lib/i18n';

const NAV: { href: string; label: Bi }[] = [
  { href: '/concours', label: { ar: 'المناظرات', fr: 'Concours' } },
  { href: '/calendar', label: { ar: 'الرزنامة', fr: 'Calendrier' } },
  { href: '/alerts', label: { ar: 'التنبيهات', fr: 'Alertes' } },
  { href: '/pricing', label: { ar: 'الأسعار', fr: 'Tarifs' } },
];

export function NavLinks({ className }: { className?: string }) {
  const tr = useT();
  const pathname = usePathname();
  return (
    <nav aria-label={tr({ ar: 'القائمة الرئيسية', fr: 'Navigation principale' })} className={className}>
      <ul className="flex gap-0.5 overflow-x-auto pb-1 sm:gap-1 md:-mx-1 md:pb-0">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold transition sm:px-3 sm:text-sm',
                  active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                {tr(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function LangSwitch() {
  const { locale, setLocale } = useLocale();
  const next = locale === 'ar' ? 'fr' : 'ar';
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-border px-2.5 text-sm font-semibold hover:bg-surface-2"
      aria-label={next === 'fr' ? 'Passer en français' : 'التبديل إلى العربية'}
      lang={next}
    >
      <Languages className="hidden size-4 sm:block" aria-hidden />
      <span className="hidden sm:inline">{next === 'fr' ? 'Français' : 'العربية'}</span>
      <span className="sm:hidden">{next === 'fr' ? 'FR' : 'ع'}</span>
    </button>
  );
}

/**
 * Bell with the unread count (concours matching the profile, deadline reminders…), for visitors who already have a session.
 * Refreshed when the tab regains focus so a returning visitor sees new alerts.
 */
function NotificationBell({ className }: { className?: string }) {
  const tr = useT();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ unread: number }>('/me/notifications/unread-count').then((r) => alive && setUnread(r.unread)).catch(() => {});
    load();
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);
  const label = unread > 0
    ? tr({ ar: `الإشعارات: ${unread} غير مقروءة`, fr: `Notifications : ${unread} non lue(s)` })
    : tr({ ar: 'الإشعارات', fr: 'Notifications' });
  return (
    <Link href="/app/notifications" aria-label={label} title={label} className={clsx('relative min-h-11 min-w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-text', className)}>
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute end-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-white tabular-nums" aria-hidden>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

export function AuthCta() {
  const tr = useT();
  const { me, loading } = useSession();
  if (loading) return <span className="inline-block h-11 w-28 animate-pulse rounded-xl bg-surface-2" aria-hidden />;
  if (me && !me.isGuest) {
    return (
      <div className="flex items-center gap-1.5">
        <NotificationBell className="inline-flex" />
        <ButtonLink href="/app" size="sm" className="min-h-11">{tr({ ar: 'فضائي', fr: 'Mon espace' })}</ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {me && <NotificationBell className="hidden sm:inline-flex" />}
      <Link href="/login" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-text">
        <LogIn className="size-4 sm:hidden" aria-hidden />
        <span className="sr-only sm:not-sr-only">{tr({ ar: 'دخول', fr: 'Connexion' })}</span>
      </Link>
      <ButtonLink href={me ? '/app' : '/register'} size="sm" className="min-h-11">
        {me ? (
          tr({ ar: 'متابعة التحضير', fr: 'Continuer' })
        ) : (
          <>
            <span className="sm:hidden">{tr({ ar: 'ابدأ مجانًا', fr: 'Commencer' })}</span>
            <span className="hidden sm:inline">{tr({ ar: 'ابدأ مجانًا', fr: 'Commencer gratuitement' })}</span>
          </>
        )}
      </ButtonLink>
    </div>
  );
}

'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  Bell, ChartLine, ClipboardCheck, Crown, Dumbbell, Flame, Gift, HardDriveDownload, House, Languages, Library, Radar, Star, UserRound, WifiOff, X,
} from 'lucide-react';
import { useLocale, useSession, useT } from '@/components/providers';
import { api, ApiError } from '@/lib/api';
import { setAppBadge } from '@/lib/push';
import type { Bi } from '@/lib/i18n';
import { applyStoredTheme } from './theme';
import './install'; // registers the beforeinstallprompt listener as early as possible

// ───────── Shell context (unread badge shared with the notifications page) ─────────

interface ShellCtxValue {
  unread: number;
  setUnread: (n: number | ((prev: number) => number)) => void;
  refreshUnread: () => Promise<void>;
}
const ShellCtx = createContext<ShellCtxValue>({ unread: 0, setUnread: () => {}, refreshUnread: async () => {} });
export const useShell = () => useContext(ShellCtx);

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
interface NavItem { href: string; label: Bi; icon: Icon; exact?: boolean; also?: string[] }

const PRIMARY: NavItem[] = [
  { href: '/app', label: { ar: 'الرئيسية', fr: 'Accueil' }, icon: House, exact: true },
  { href: '/app/practice', label: { ar: 'تدرب', fr: 'S’entraîner' }, icon: Dumbbell, also: ['/app/lesson', '/app/mistakes', '/app/bookmarks'] },
  { href: '/app/mock', label: { ar: 'امتحان', fr: 'Examen' }, icon: ClipboardCheck },
  { href: '/app/progress', label: { ar: 'تقدمي', fr: 'Progrès' }, icon: ChartLine },
  { href: '/app/profile', label: { ar: 'حسابي', fr: 'Compte' }, icon: UserRound },
];

const SECONDARY: NavItem[] = [
  { href: '/app/alerts', label: { ar: 'مناظرات تناسبني', fr: 'Concours pour moi' }, icon: Radar },
  { href: '/app/notifications', label: { ar: 'الإشعارات', fr: 'Notifications' }, icon: Bell },
  { href: '/concours', label: { ar: 'دليل المناظرات', fr: 'Catalogue des concours' }, icon: Library },
  { href: '/app/offline', label: { ar: 'المحتوى دون اتصال', fr: 'Hors ligne' }, icon: HardDriveDownload },
  { href: '/app/referral', label: { ar: 'ادعُ أصدقاءك', fr: 'Parrainage' }, icon: Gift },
  { href: '/app/billing', label: { ar: 'الاشتراك', fr: 'Abonnement' }, icon: Crown },
];

/** Routes where the bottom bar is hidden so the learner stays focused (exam sessions, onboarding flow). */
const FOCUS_ROUTES = ['/app/session/', '/app/onboarding'];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.also ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`));
}

const POLL_MS = 60_000;
const GUEST_BANNER_KEY = 'ctn_guest_banner_hidden';

export function AppShell({ children }: { children: ReactNode }) {
  const tr = useT();
  const pathname = usePathname() ?? '/app';
  const { me, loading, ensureSession } = useSession();
  const [unread, setUnreadState] = useState(0);
  const [online, setOnline] = useState(true);
  const [guestBannerHidden, setGuestBannerHidden] = useState(false);
  const unreadEndpoint = useRef<'count' | 'list'>('count');

  const setUnread = useCallback((n: number | ((prev: number) => number)) => {
    setUnreadState((prev) => {
      const v = Math.max(0, typeof n === 'function' ? n(prev) : n);
      setAppBadge(v);
      return v;
    });
  }, []);

  const refreshUnread = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      if (unreadEndpoint.current === 'count') {
        try {
          const r = await api<{ unread: number }>('/me/notifications/unread-count');
          setUnread(r.unread);
          return;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
          unreadEndpoint.current = 'list';
        }
      }
      const r = await api<{ unread: number }>('/me/notifications?limit=1');
      setUnread(r.unread);
    } catch {
      /* keep the last known value (offline, session expired…) */
    }
  }, [setUnread]);

  useEffect(() => {
    applyStoredTheme();
    try {
      setGuestBannerHidden(sessionStorage.getItem(GUEST_BANNER_KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Session guard: every /app page works for guests too, so make sure a (guest) session exists — once the
  // provider's initial /auth/me has answered (avoids racing it and creating a guest for a signed-in visitor).
  useEffect(() => {
    if (!loading && !me) ensureSession().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, me]);

  // Unread badge: poll every minute while the tab is visible, refresh immediately when it becomes visible again.
  const userId = me?.id;
  useEffect(() => {
    if (!userId) return;
    void refreshUnread();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUnread();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refreshUnread();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, refreshUnread]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const focus = FOCUS_ROUTES.some((r) => pathname.startsWith(r));
  const ctx = useMemo(() => ({ unread, setUnread, refreshUnread }), [unread, setUnread, refreshUnread]);

  function hideGuestBanner() {
    setGuestBannerHidden(true);
    try {
      sessionStorage.setItem(GUEST_BANNER_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  return (
    <ShellCtx.Provider value={ctx}>
      <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:shadow">
        {tr({ ar: 'انتقل إلى المحتوى', fr: 'Aller au contenu' })}
      </a>
      <div className="min-h-dvh md:flex">
        <SideNav pathname={pathname} unread={unread} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar unread={unread} />
          {!online && (
            <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-sm text-warning" role="status">
              <WifiOff className="size-4 shrink-0" aria-hidden />
              <span>{tr({ ar: 'أنت غير متصل بالإنترنت.', fr: 'Vous êtes hors ligne.' })}</span>
              <Link href="/app/offline" className="font-semibold underline">{tr({ ar: 'تدرّب بالمحتوى المحمّل', fr: 'Réviser le contenu téléchargé' })}</Link>
            </div>
          )}
          {me?.isGuest && !guestBannerHidden && !pathname.startsWith('/app/session/') && (
            <div className="flex items-center gap-2 border-b border-border bg-primary-soft px-4 py-1.5 text-sm">
              <Link href={`/register?next=${encodeURIComponent(pathname)}`} className="flex min-h-9 flex-1 items-center gap-2 font-semibold text-primary hover:underline">
                <UserRound className="size-4 shrink-0" aria-hidden />
                {tr({ ar: 'سجّل للحفاظ على تقدمك', fr: 'Créez un compte pour garder votre progression' })}
              </Link>
              <button type="button" onClick={hideGuestBanner} className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface" aria-label={tr({ ar: 'إخفاء', fr: 'Masquer' })}>
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}
          <main id="app-main" className={clsx('mx-auto w-full max-w-3xl flex-1 px-4 pt-4', focus ? 'pb-8' : 'safe-bottom md:pb-10')}>
            {children}
          </main>
        </div>
      </div>
      {!focus && <BottomNav pathname={pathname} />}
    </ShellCtx.Provider>
  );
}

function Logo() {
  const tr = useT();
  return (
    <Link href="/app" className="inline-flex min-h-11 items-center gap-2 font-extrabold tracking-tight" aria-label={tr({ ar: 'Concours TN — الرئيسية', fr: 'Concours TN — accueil' })}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon.svg" alt="" width={28} height={28} className="size-7 rounded-lg" />
      <span dir="ltr" className="text-base">Concours <span className="text-accent">TN</span></span>
    </Link>
  );
}

function TopBar({ unread }: { unread: number }) {
  const tr = useT();
  const { locale, setLocale } = useLocale();
  const { me } = useSession();
  const next = locale === 'ar' ? 'fr' : 'ar';
  const streak = me?.stats.streak ?? 0;
  const level = me?.stats.level ?? 1;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-1.5 px-3 sm:px-4">
        <div className="me-auto">
          <span className="md:hidden"><Logo /></span>
        </div>
        {me && (
          <Link
            href="/app/progress"
            className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-bold tabular-nums hover:bg-surface-2"
            aria-label={tr({ ar: `سلسلة ${streak} يوم ومستوى ${level}`, fr: `Série de ${streak} jour(s), niveau ${level}` })}
          >
            <Flame className={clsx('size-5', streak > 0 ? 'text-accent' : 'text-muted')} aria-hidden />
            <span>{streak}</span>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Star className="size-4 text-warning" aria-hidden />
            <span>{tr({ ar: `مستوى ${level}`, fr: `Niv. ${level}` })}</span>
          </Link>
        )}
        <Link
          href="/app/notifications"
          className="relative inline-flex size-11 items-center justify-center rounded-xl hover:bg-surface-2"
          aria-label={unread > 0 ? tr({ ar: `الإشعارات، ${unread} غير مقروءة`, fr: `Notifications, ${unread} non lue(s)` }) : tr({ ar: 'الإشعارات', fr: 'Notifications' })}
        >
          <Bell className="size-5" aria-hidden />
          {unread > 0 && (
            <span className="absolute end-1.5 top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-5 text-white tabular-nums" aria-hidden>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setLocale(next)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-xl px-2 text-sm font-semibold hover:bg-surface-2"
          aria-label={next === 'fr' ? 'Passer en français' : 'التبديل إلى العربية'}
          lang={next}
        >
          <Languages className="size-4" aria-hidden />
          <span>{next === 'fr' ? 'FR' : 'ع'}</span>
        </button>
      </div>
    </header>
  );
}

function SideNav({ pathname, unread }: { pathname: string; unread: number }) {
  const tr = useT();
  const { me } = useSession();
  const link = (item: NavItem) => {
    const active = isActive(pathname, item);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          className={clsx('flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition', active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-text')}
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          <span className="flex-1">{tr(item.label)}</span>
          {item.href === '/app/notifications' && unread > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold leading-5 text-white tabular-nums">{unread > 99 ? '99+' : unread}</span>
          )}
        </Link>
      </li>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 overflow-y-auto border-e border-border bg-surface px-3 py-3 md:flex">
      <div className="px-1"><Logo /></div>
      <nav aria-label={tr({ ar: 'القائمة الرئيسية', fr: 'Navigation principale' })}>
        <ul className="flex flex-col gap-0.5">{PRIMARY.map(link)}</ul>
      </nav>
      <nav aria-label={tr({ ar: 'روابط أخرى', fr: 'Autres liens' })} className="border-t border-border pt-3">
        <ul className="flex flex-col gap-0.5">{SECONDARY.map(link)}</ul>
      </nav>
      {me && !me.premium.active && !me.isGuest && (
        <Link href="/app/billing" className="mt-auto flex flex-col gap-1 rounded-2xl bg-accent-soft p-3 text-sm hover:opacity-90">
          <span className="flex items-center gap-2 font-bold text-accent"><Crown className="size-4" aria-hidden />{tr({ ar: 'جرّب بريميوم', fr: 'Passer Premium' })}</span>
          <span className="text-muted">{tr({ ar: 'أسئلة غير محدودة، امتحانات تجريبية وتحضير دون اتصال.', fr: 'Questions illimitées, examens blancs et révision hors ligne.' })}</span>
        </Link>
      )}
    </aside>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  const tr = useT();
  return (
    <nav
      aria-label={tr({ ar: 'القائمة الرئيسية', fr: 'Navigation principale' })}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-surface/85 md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {PRIMARY.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx('flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition', active ? 'text-primary' : 'text-muted hover:text-text')}
              >
                <span className={clsx('inline-flex h-7 w-12 items-center justify-center rounded-full transition', active && 'bg-primary-soft')}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {tr(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

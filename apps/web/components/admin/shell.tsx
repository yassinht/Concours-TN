'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  BadgeHelp, Bot, ClipboardCheck, FileText, Flag, History, House, Landmark, LayoutDashboard, LayoutTemplate, ListChecks, LogOut, Megaphone, Menu,
  Radar, Search, ShieldAlert, UserPlus, Users, Wallet, X,
} from 'lucide-react';
import type { MeDTO } from '@ctn/shared';
import { ButtonLink, Spinner } from '@/components/ui';
import { useSession } from '@/components/providers';
import { api } from '@/lib/api';
import { ROLE_LABEL } from './labels';
import { ToastProvider } from './toast';
import type { AdminStats } from './types';

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
interface NavItem { href: string; label: string; icon: Icon; exact?: boolean; adminOnly?: boolean; badge?: (s: AdminStats) => number }

const NAV: NavItem[] = [
  { href: '/admin', label: 'Tableau de bord', icon: LayoutDashboard, exact: true },
  { href: '/admin/review', label: 'Revue', icon: ClipboardCheck, badge: (s) => s.content.questions.AI_REVIEWED ?? 0 },
  { href: '/admin/questions', label: 'Questions', icon: ListChecks },
  { href: '/admin/concours', label: 'Concours', icon: Landmark, badge: (s) => s.alerts?.pendingEditions ?? 0 },
  { href: '/admin/facts', label: 'Faits à vérifier', icon: BadgeHelp, badge: (s) => s.content.factsNeedingVerification },
  { href: '/admin/sources', label: 'Sources & documents', icon: FileText },
  { href: '/admin/ingest', label: 'Veille (ingest)', icon: Radar },
  { href: '/admin/ai', label: 'IA', icon: Bot },
  { href: '/admin/blueprints', label: 'Blueprints', icon: LayoutTemplate },
  { href: '/admin/reports', label: 'Signalements', icon: Flag, badge: (s) => s.content.openReports },
  { href: '/admin/users', label: 'Utilisateurs', icon: Users, adminOnly: true },
  { href: '/admin/payments', label: 'Paiements', icon: Wallet, adminOnly: true, badge: (s) => s.revenue.pendingManual },
  { href: '/admin/broadcast', label: 'Notifications', icon: Megaphone, adminOnly: true },
  { href: '/admin/waitlist', label: 'Waitlist', icon: UserPlus, adminOnly: true },
  { href: '/admin/audit', label: 'Audit', icon: History },
];

const STAFF = ['ADMIN', 'EDITOR'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATS_POLL_MS = 120_000;

interface AdminCtxValue {
  me: MeDTO;
  isAdmin: boolean;
  stats: AdminStats | null;
  refreshStats: () => Promise<void>;
}
const AdminCtx = createContext<AdminCtxValue | null>(null);

export function useAdmin(): AdminCtxValue {
  const v = useContext(AdminCtx);
  if (!v) throw new Error('useAdmin outside AdminShell');
  return v;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Admin back-office frame: role guard (GET /auth/me), side navigation with live counters, toasts. French-first UI. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { me, loading, refresh } = useSession();
  const pathname = usePathname() ?? '/admin';
  const [checked, setChecked] = useState(false);

  // The session provider loads /auth/me once at boot; re-check here so a role change is picked up on entering the admin.
  useEffect(() => {
    let alive = true;
    void refresh().finally(() => alive && setChecked(true));
    return () => {
      alive = false;
    };
  }, [refresh]);

  if (loading || !checked) {
    return <div className="flex min-h-dvh items-center justify-center" lang="fr" dir="ltr"><Spinner /></div>;
  }
  if (!me || me.isGuest || !STAFF.includes(me.role)) return <Forbidden me={me} next={pathname} />;
  return (
    <div lang="fr" dir="ltr">
      <ToastProvider>
        <StaffFrame me={me} pathname={pathname}>{children}</StaffFrame>
      </ToastProvider>
    </div>
  );
}

function Forbidden({ me, next }: { me: MeDTO | null; next: string }) {
  const signedIn = !!me && !me.isGuest;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4" lang="fr" dir="ltr">
      <div className="card flex max-w-md flex-col items-center gap-3 p-6 text-center">
        <ShieldAlert className="size-10 text-danger" aria-hidden />
        <p className="text-sm font-bold tracking-wider text-muted">ERREUR 403</p>
        <h1 className="text-xl font-extrabold">Accès réservé à l’équipe éditoriale</h1>
        <p className="text-sm text-muted">
          {signedIn
            ? `Le compte ${me?.email ?? ''} n’a pas le rôle Administrateur ou Éditeur. Connectez-vous avec un compte de l’équipe.`
            : 'Connectez-vous avec un compte Administrateur ou Éditeur pour accéder au back-office.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink href={`/login?next=${encodeURIComponent(next)}`}>Se connecter</ButtonLink>
          <ButtonLink href="/" variant="secondary">Retour au site</ButtonLink>
        </div>
      </div>
    </main>
  );
}

function StaffFrame({ me, pathname, children }: { me: MeDTO; pathname: string; children: ReactNode }) {
  const { logout } = useSession();
  const router = useRouter();
  const isAdmin = me.role === 'ADMIN';
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api<AdminStats>('/admin/stats'));
    } catch {
      /* counters are a convenience: the pages show their own errors */
    }
  }, []);

  useEffect(() => {
    void refreshStats();
    const t = window.setInterval(() => void refreshStats(), STATS_POLL_MS);
    return () => window.clearInterval(t);
  }, [refreshStats]);

  // Close the mobile drawer on navigation.
  useEffect(() => setOpen(false), [pathname]);

  const ctx = useMemo(() => ({ me, isAdmin, stats, refreshStats }), [me, isAdmin, stats, refreshStats]);
  const items = NAV.filter((n) => isAdmin || !n.adminOnly);

  const search = (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        const v = query.trim();
        if (!v) return;
        // A pasted question id opens the editor directly.
        router.push(UUID_RE.test(v) ? `/admin/questions/${v}` : `/admin/questions?q=${encodeURIComponent(v)}`);
        setQuery('');
      }}
    >
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        aria-label="Rechercher une question (texte ou identifiant)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Question : texte ou id…"
        className="h-9 w-full rounded-lg border border-border bg-surface-2 ps-8 pe-2 text-sm outline-none focus:border-primary"
      />
    </form>
  );

  const nav = (
    <nav aria-label="Navigation du back-office" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item);
        const count = stats && item.badge ? item.badge(stats) : 0;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold transition',
              active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{item.label}</span>
            {count > 0 && (
              <span className="rounded-full bg-warning-soft px-1.5 text-xs font-bold tabular-nums text-warning" aria-label={`${count} en attente`}>{count > 999 ? '999+' : count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
      <div className="min-w-0">
        <p className="truncate font-semibold">{me.name ?? me.email}</p>
        <p className="text-xs text-muted">{ROLE_LABEL[me.role]}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        <Link href="/app" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-muted hover:bg-surface-2 hover:text-text"><House className="size-4" aria-hidden />App</Link>
        <button type="button" onClick={() => void logout()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-muted hover:bg-surface-2 hover:text-text"><LogOut className="size-4" aria-hidden />Déconnexion</button>
      </div>
    </div>
  );

  return (
    <AdminCtx.Provider value={ctx}>
      <div className="min-h-dvh bg-bg" lang="fr" dir="ltr">
        {/* Top bar (tablet / phone) */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-3 lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Ouvrir le menu" aria-expanded={open} aria-controls="admin-drawer">
            <Menu className="size-5" aria-hidden />
          </button>
          <Link href="/admin" className="font-extrabold">Concours TN <span className="text-muted">· Admin</span></Link>
        </header>

        {/* Drawer (tablet / phone) */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="admin-drawer">
            <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-label="Fermer le menu" />
            <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-3 overflow-y-auto bg-surface p-3 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="font-extrabold">Concours TN · Admin</span>
                <button type="button" onClick={() => setOpen(false)} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Fermer le menu"><X className="size-5" aria-hidden /></button>
              </div>
              {search}
              {nav}
              {footer}
            </div>
          </div>
        )}

        <div className="mx-auto flex max-w-[1500px]">
          <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-3 overflow-y-auto border-e border-border bg-surface p-3 lg:flex">
            <Link href="/admin" className="px-2.5 py-1 text-lg font-extrabold">Concours TN <span className="text-sm font-semibold text-muted">Admin</span></Link>
            {search}
            <div className="flex-1">{nav}</div>
            {footer}
          </aside>
          <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
        </div>
        {/* Dialogs opened from inside forms are portaled here (same language/direction, outside any <form>). */}
        <div id="admin-portal" />
      </div>
    </AdminCtx.Provider>
  );
}

/** Shown by ADMIN-only pages when an EDITOR opens them. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAdmin();
  if (isAdmin) return <>{children}</>;
  return (
    <div className="card flex flex-col items-center gap-2 p-6 text-center">
      <ShieldAlert className="size-8 text-warning" aria-hidden />
      <h1 className="text-lg font-bold">Réservé aux administrateurs</h1>
      <p className="max-w-md text-sm text-muted">Les comptes, paiements, diffusions et la liste d’attente contiennent des données personnelles ou financières : seuls les administrateurs y ont accès.</p>
    </div>
  );
}

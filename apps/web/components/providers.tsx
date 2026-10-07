'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale, MeDTO } from '@ctn/shared';
import { api } from '@/lib/api';
import { LOCALE_COOKIE, t as translate, type Bi } from '@/lib/i18n';

// ───────── Locale ─────────
const LocaleCtx = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({ locale: 'ar', setLocale: () => {} });

export function useLocale() {
  return useContext(LocaleCtx);
}

/** Inline bilingual text for client components: <T ar="…" fr="…" /> */
export function T({ ar, fr }: Bi) {
  const { locale } = useLocale();
  return <>{translate(locale, { ar, fr })}</>;
}

/** Hook form: const tr = useT(); tr({ ar, fr }) */
export function useT() {
  const { locale } = useLocale();
  return useCallback((text: Bi) => translate(locale, text), [locale]);
}

// ───────── Session ─────────
interface SessionCtxValue {
  me: MeDTO | null;
  loading: boolean;
  refresh: () => Promise<MeDTO | null>;
  /** Ensures a session exists (creates a guest session when needed) and returns it. */
  ensureSession: () => Promise<MeDTO>;
  logout: () => Promise<void>;
}
const SessionCtx = createContext<SessionCtxValue | null>(null);

export function useSession(): SessionCtxValue {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession outside provider');
  return v;
}

export function Providers({ locale: initialLocale, children }: { locale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [me, setMe] = useState<MeDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    setLocaleState(l);
    // persist on the account too (best effort)
    api('/me/profile', { method: 'PUT', body: { locale: l } }).catch(() => {});
    window.location.reload();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: MeDTO | null }>('/auth/me');
      setMe(r.user);
      return r.user;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureSession = useCallback(async () => {
    const cur = me ?? (await refresh());
    if (cur) return cur;
    const r = await api<{ user: MeDTO }>('/auth/guest', { method: 'POST', body: { locale } });
    setMe(r.user);
    return r.user;
  }, [me, refresh, locale]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setMe(null);
    window.location.href = '/';
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  const session = useMemo(() => ({ me, loading, refresh, ensureSession, logout }), [me, loading, refresh, ensureSession, logout]);

  return (
    <LocaleCtx.Provider value={{ locale, setLocale }}>
      <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>
    </LocaleCtx.Provider>
  );
}

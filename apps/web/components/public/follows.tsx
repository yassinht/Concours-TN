'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/components/providers';
import { track } from './track';

interface FollowsCtx {
  /** Followed family slugs (empty until loaded / without a session). */
  follows: Set<string>;
  ready: boolean;
  /** Creates a guest session if needed, then follows the family (alerts + deadline reminders). */
  follow: (slug: string) => Promise<void>;
  unfollow: (slug: string) => Promise<void>;
}

const Ctx = createContext<FollowsCtx | null>(null);

/** Loads the visitor's follows once per page (only when a session already exists — no guest is created on view). */
export function FollowsProvider({ children }: { children: ReactNode }) {
  const { me, loading, ensureSession } = useSession();
  const [follows, setFollows] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  // Local changes win over a list fetched concurrently (ensureSession() changes `me`, which refetches).
  const local = useRef(new Map<string, boolean>());

  useEffect(() => {
    if (loading) return;
    if (!me) {
      setFollows(new Set());
      setReady(true);
      return;
    }
    const ctrl = new AbortController();
    api<{ familySlug: string }[]>('/me/follows', { signal: ctrl.signal })
      .then((rows) => {
        const next = new Set(rows.map((r) => r.familySlug));
        for (const [slug, on] of local.current) {
          if (on) next.add(slug);
          else next.delete(slug);
        }
        setFollows(next);
      })
      .catch(() => {})
      .finally(() => setReady(true));
    return () => ctrl.abort();
  }, [me, loading]);

  const follow = useCallback(async (slug: string) => {
    await ensureSession();
    await api(`/me/follows/${encodeURIComponent(slug)}`, { method: 'POST' });
    local.current.set(slug, true);
    setFollows((s) => new Set(s).add(slug));
    track('concours_follow', { familySlug: slug });
  }, [ensureSession]);

  const unfollow = useCallback(async (slug: string) => {
    await api(`/me/follows/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    local.current.set(slug, false);
    setFollows((s) => {
      const n = new Set(s);
      n.delete(slug);
      return n;
    });
  }, []);

  const value = useMemo(() => ({ follows, ready, follow, unfollow }), [follows, ready, follow, unfollow]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFollows(): FollowsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFollows outside FollowsProvider');
  return v;
}

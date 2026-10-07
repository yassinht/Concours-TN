'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface Loadable<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<T | undefined>;
  setData: (updater: T | ((prev: T | undefined) => T | undefined)) => void;
}

/** GET `path` (null = skip). Stale responses (path changed meanwhile) are ignored; the previous data stays visible while reloading. */
export function useAdminApi<T>(path: string | null): Loadable<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const seq = useRef(0);

  const load = useCallback(async (): Promise<T | undefined> => {
    if (!path) {
      setLoading(false);
      return undefined;
    }
    const id = ++seq.current;
    setLoading(true);
    try {
      const r = await api<T>(path);
      if (id === seq.current) {
        setDataState(r);
        setError(null);
      }
      return r;
    } catch (e) {
      if (id === seq.current) setError(e);
      return undefined;
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T | undefined)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | undefined) => T | undefined)(prev) : updater));
  }, []);

  return { data, error, loading, reload: load, setData };
}

// ───────── Shared lookups (families, sources) cached for the session of the page ─────────

const cache = new Map<string, { at: number; promise: Promise<unknown> }>();
const listeners = new Map<string, Set<() => void>>();
const TTL_MS = 60_000;

function fetchCached<T>(path: string, force = false): Promise<T> {
  const hit = cache.get(path);
  if (hit && !force && Date.now() - hit.at < TTL_MS) return hit.promise as Promise<T>;
  const promise = api<T>(path);
  cache.set(path, { at: Date.now(), promise });
  promise.catch(() => cache.delete(path));
  return promise;
}

/** Drops a cached lookup and tells every component using it to refetch (after creating a source, a family…). */
export function invalidateLookup(path: string): void {
  cache.delete(path);
  listeners.get(path)?.forEach((fn) => fn());
}

/** Like useAdminApi but shared between components (one request for every <SourceSelect> on a page). */
export function useLookup<T>(path: string): { data: T | undefined; error: unknown; loading: boolean } {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    const run = (force = false) => {
      fetchCached<T>(path, force)
        .then((data) => alive && setState({ data, error: null, loading: false }))
        .catch((error: unknown) => alive && setState((s) => ({ ...s, error, loading: false })));
    };
    const onInvalidate = () => run(true);
    const set = listeners.get(path) ?? new Set();
    set.add(onInvalidate);
    listeners.set(path, set);
    run();
    return () => {
      alive = false;
      set.delete(onInvalidate);
    };
  }, [path]);
  return state;
}

export const SOURCES_LOOKUP = '/admin/sources?pageSize=200';
export const FAMILIES_LOOKUP = '/admin/families';

/** Remembers a small UI preference per browser (filters, last tab). Never throws (private mode, blocked storage). */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const set = useCallback((v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  return [value, set];
}

/**
 * Mirrors filters in the URL (shareable, survives reload) without a navigation: Next.js integrates the native History
 * API with useSearchParams, so no server round trip happens on every filter change.
 */
export function useUrlSync(url: string): void {
  useEffect(() => {
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, '', url);
  }, [url]);
}

/** Debounced copy of a value (search boxes). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

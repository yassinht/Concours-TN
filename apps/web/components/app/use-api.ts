'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | Error | null;
  loading: boolean;
  reload: () => Promise<T | undefined>;
  setData: (updater: T | ((prev: T | undefined) => T | undefined)) => void;
}

/** Stable error code of a failed call ('NETWORK' when the request never reached the API). */
export function errorCode(e: unknown): string {
  if (e instanceof ApiError) return e.code;
  if (e instanceof TypeError) return 'NETWORK';
  return 'ERROR';
}

/**
 * GET helper for client pages: loads `path` (null = skip), exposes reload/setData for optimistic updates.
 * Stale responses (path changed meanwhile) are ignored.
 */
export function useApi<T>(path: string | null, opts: { enabled?: boolean } = {}): ApiState<T> {
  const enabled = opts.enabled ?? true;
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path && enabled);
  const seq = useRef(0);

  const load = useCallback(async (): Promise<T | undefined> => {
    if (!path || !enabled) {
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
      if (id === seq.current) setError(e instanceof Error ? e : new Error(String(e)));
      return undefined;
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T | undefined)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | undefined) => T | undefined)(prev) : updater));
  }, []);

  return { data, error, loading, reload: load, setData };
}

/** Fire-and-forget funnel event (POST /events). Never blocks or breaks the UI. */
export function track(name: string, props: Record<string, unknown> = {}): void {
  api('/events', { body: { name, props } }).catch(() => {});
}

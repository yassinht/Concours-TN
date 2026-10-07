'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { StartAttemptInput } from '@ctn/shared';
import { useSession } from '@/components/providers';
import { errorCode, track, useApi } from '@/components/app/use-api';
import { errorText } from '@/components/app/format';
import { api } from '@/lib/api';
import type { Bi } from '@/lib/i18n';
import type { PaywallReason } from './paywall';
import type { EnrollmentRow, SessionView } from './types';

/** GET that waits for the (possibly guest) session created by the app shell, so the first call never 401s. */
export function useSessionApi<T>(path: string | null) {
  const { me } = useSession();
  return useApi<T>(me ? path : null);
}

/** Enrollments of the user, with the primary one first. */
export function useEnrollments() {
  const state = useSessionApi<EnrollmentRow[]>('/me/enrollments');
  const list = state.data ? [...state.data].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)) : undefined;
  return { ...state, list, primary: list?.[0] ?? null };
}

/**
 * Starts an attempt and opens the session. 402 opens the paywall, other failures become a bilingual message.
 * `key` lets a page show the spinner on the button that was pressed.
 */
export function useStartAttempt(from: string) {
  const router = useRouter();
  const { ensureSession } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Bi | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  const start = useCallback(async (input: StartAttemptInput, key = 'default'): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      await ensureSession();
      const a = await api<SessionView>('/attempts', { body: input });
      track('attempt_start', { kind: input.kind, from, familySlug: input.familySlug ?? null });
      router.push(`/app/session/${a.id}`);
      return true;
    } catch (e) {
      const code = errorCode(e);
      if (code === 'LIMIT_REACHED') setPaywall('limit');
      else if (code === 'PREMIUM_REQUIRED') setPaywall('mock');
      else setError(errorText(code));
      setBusy(null);
      return false;
    }
  }, [ensureSession, router, from]);

  return { start, busy, error, setError, paywall, closePaywall: () => setPaywall(null), openPaywall: setPaywall };
}

/** Reads a JSON value from localStorage (never throws: private mode / blocked storage). */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the feature degrades silently */
  }
}

/** navigator.onLine as state (true on the server). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
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
  return online;
}

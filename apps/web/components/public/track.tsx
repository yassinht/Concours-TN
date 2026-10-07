'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';

const UTM_KEY = 'ctn_utm';
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'] as const;
/** One event per name+page per page load (StrictMode runs effects twice in dev). */
const sent = new Set<string>();

/** UTM parameters of the visit, remembered for the session so the waitlist / signup can attribute them. */
export function readUtm(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const stored = sessionStorage.getItem(UTM_KEY);
    if (stored) Object.assign(out, JSON.parse(stored) as Record<string, string>);
  } catch {
    /* storage unavailable (private mode) */
  }
  const params = new URLSearchParams(window.location.search);
  for (const k of UTM_PARAMS) {
    const v = params.get(k);
    if (v) out[k] = v.slice(0, 200);
  }
  if (Object.keys(out).length) {
    try {
      sessionStorage.setItem(UTM_KEY, JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Fire-and-forget funnel event (POST /events). Never blocks or breaks the UI. */
export function track(name: string, props: Record<string, unknown> = {}): void {
  api('/events', { body: { name, props } }).catch(() => {});
}

/** Drop-in for server pages: <TrackEvent name="landing_view" props={{…}} /> */
export function TrackEvent({ name, props }: { name: string; props?: Record<string, unknown> }) {
  const key = `${name}:${JSON.stringify(props ?? {})}`;
  useEffect(() => {
    if (sent.has(key)) return;
    sent.add(key);
    const utm = readUtm();
    let referrer: string | undefined;
    try {
      referrer = document.referrer ? new URL(document.referrer).hostname : undefined;
    } catch {
      referrer = undefined;
    }
    track(name, { ...(props ?? {}), path: window.location.pathname, ...(referrer && referrer !== window.location.hostname ? { referrer } : {}), ...(Object.keys(utm).length ? { utm } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/**
 * Web Push helpers (client only). The service worker (/sw.js) displays the notifications the API sends:
 * concours matching the profile, registration deadlines, exam reminders, study reminders.
 *
 * Permission is only ever requested after an explicit tap (browsers penalise prompts on page load).
 */
import { api } from './api';

export type PushStatus =
  | 'unsupported' // no Push API in this browser
  | 'ios-install' // iPhone/iPad Safari tab: push only works once the app is added to the home screen
  | 'denied' // the user blocked notifications for the site
  | 'default' // never asked
  | 'granted' // permission granted but this device has no subscription yet
  | 'subscribed';

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'ios-install' | 'denied' | 'dismissed' | 'unavailable' | 'error'; message?: string };

const SW_URL = '/sw.js';

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ reports itself as Mac; touch points tell them apart.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function hasPushApi(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Support without touching the permission (safe to call on render). */
export function pushSupport(): 'supported' | 'unsupported' | 'ios-install' {
  if (hasPushApi()) return 'supported';
  return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
}

function withTimeout<T>(p: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(code)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** The active service worker registration (registers /sw.js on demand: the app shell only does it in production). */
export async function swRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  return withTimeout(navigator.serviceWorker.ready, 15_000, 'SW_TIMEOUT');
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!hasPushApi()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushStatus(): Promise<PushStatus> {
  const support = pushSupport();
  if (support !== 'supported') return support;
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  try {
    return (await currentSubscription()) ? 'subscribed' : 'granted';
  } catch {
    return 'granted';
  }
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options?.applicationServerKey;
  if (!current) return true; // unknown: keep the existing subscription
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

/** Asks permission (must be called from a user gesture), subscribes this device and registers it with the API. */
export async function enablePush(): Promise<EnableResult> {
  const support = pushSupport();
  if (support !== 'supported') return { ok: false, reason: support };
  try {
    const { key } = await api<{ key: string | null }>('/push/vapid-public-key');
    if (!key) return { ok: false, reason: 'unavailable' };
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'denied') return { ok: false, reason: 'denied' };
    if (permission !== 'granted') return { ok: false, reason: 'dismissed' };
    const reg = await swRegistration();
    const appKey = urlBase64ToUint8Array(key);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, appKey)) {
      // The server rotated its VAPID keys: the old subscription can no longer receive our messages.
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, reason: 'error', message: 'BAD_SUBSCRIPTION' };
    await api('/push/subscribe', { body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Unsubscribes this device (browser side and API side). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await api('/push/unsubscribe', { body: { endpoint } }).catch(() => {});
}

/** Asks the API to send a test notification to this account's devices. */
export async function sendTestPush(locale: 'ar' | 'fr'): Promise<{ ok: boolean; status: string; error: string | null }> {
  return api(`/push/test?locale=${locale}`, { method: 'POST', body: {} });
}

/** Unread count on the installed app icon (Badging API, where supported). */
export function setAppBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) nav.setAppBadge?.(count)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* unsupported */
  }
}

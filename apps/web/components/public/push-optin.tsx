'use client';

import { useEffect, useState } from 'react';
import { BellRing, Check, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui';
import { useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { track } from './track';

type State = 'checking' | 'unsupported' | 'ios-install' | 'idle' | 'busy' | 'on' | 'denied' | 'unavailable' | 'error';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIosBrowserTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function swRegistration(): Promise<ServiceWorkerRegistration> {
  // The app shell registers /sw.js in production; register it on demand otherwise (push needs it).
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/**
 * "Receive alerts on this phone" — Web Push opt-in, asked only after an explicit tap (never on page load).
 * The service worker shows the CONCOURS_MATCH / deadline notifications sent by the API.
 */
export function PushOptIn({ compact }: { compact?: boolean }) {
  const tr = useT();
  const { ensureSession } = useSession();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) return setState(isIosBrowserTab() ? 'ios-install' : 'unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      if (Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setState(sub ? 'on' : 'idle');
        return;
      }
      if (!cancelled) setState('idle');
    })().catch(() => !cancelled && setState('idle'));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setState('busy');
    try {
      await ensureSession();
      const { key } = await api<{ key: string | null }>('/push/vapid-public-key');
      if (!key) return setState('unavailable');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setState(permission === 'denied' ? 'denied' : 'idle');
      const reg = await swRegistration();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('BAD_SUBSCRIPTION');
      await api('/push/subscribe', { body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } });
      track('push_enabled', { from: window.location.pathname });
      setState('on');
    } catch {
      setState('error');
    }
  }

  if (state === 'checking' || state === 'unsupported') return null;

  const box = compact ? 'flex flex-col gap-2' : 'flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3';
  return (
    <div className={box} aria-live="polite">
      {state === 'on' ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-success">
          <Check className="size-4" aria-hidden />
          {tr({ ar: 'الإشعارات مفعّلة على هذا الجهاز', fr: 'Notifications activées sur cet appareil' })}
        </p>
      ) : state === 'ios-install' ? (
        <p className="flex items-start gap-2 text-sm text-muted">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          {tr({
            ar: 'على iPhone: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من هناك لتفعيل الإشعارات.',
            fr: 'Sur iPhone : touchez Partager puis « Sur l’écran d’accueil », puis ouvrez l’app depuis l’icône pour activer les notifications.',
          })}
        </p>
      ) : state === 'denied' ? (
        <p className="text-sm text-muted">
          {tr({
            ar: 'الإشعارات محظورة في متصفحك. يمكنك السماح بها من إعدادات الموقع، وستصلك التنبيهات داخل التطبيق في كل الأحوال.',
            fr: 'Les notifications sont bloquées par le navigateur. Autorisez-les dans les réglages du site ; les alertes restent visibles dans l’app.',
          })}
        </p>
      ) : state === 'unavailable' ? (
        <p className="text-sm text-muted">
          {tr({ ar: 'إشعارات الهاتف غير متاحة حاليًا — ستصلك التنبيهات داخل التطبيق.', fr: 'Les notifications push ne sont pas encore disponibles — vous recevrez les alertes dans l’app.' })}
        </p>
      ) : (
        <>
          {!compact && (
            <p className="text-sm text-muted">
              {tr({ ar: 'فعّل الإشعارات على هاتفك حتى لا يفوتك فتح باب الترشح أو آخر أجل.', fr: 'Activez les notifications pour ne rater ni l’ouverture ni la clôture des inscriptions.' })}
            </p>
          )}
          <Button variant="secondary" onClick={enable} loading={state === 'busy'} className="self-start">
            <BellRing className="size-4" aria-hidden />
            {tr({ ar: 'فعّل إشعارات الهاتف', fr: 'Activer les notifications' })}
          </Button>
          {state === 'error' && (
            <p className="text-xs text-danger" role="alert">
              {tr({ ar: 'تعذّر تفعيل الإشعارات. حاول مرة أخرى.', fr: 'Impossible d’activer les notifications. Réessayez.' })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

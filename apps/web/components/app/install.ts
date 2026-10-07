'use client';

import { useEffect, useState } from 'react';

/** Chrome/Edge/Samsung "install app" prompt, captured once per page load (the event fires only once). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let installed = false;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** { canInstall, install } — install() shows the browser's native prompt (must run from a tap). */
export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    canInstall: !!deferred && !installed,
    installed,
    async install(): Promise<boolean> {
      if (!deferred) return false;
      const ev = deferred;
      deferred = null;
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      listeners.forEach((l) => l());
      return outcome === 'accepted';
    },
  };
}

'use client';

import { useEffect, useState } from 'react';
import { Check, Facebook, Link2, MessageCircle, Share2 } from 'lucide-react';
import { useT } from '@/components/providers';
import { track } from './track';

const btn = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2';

/** Share a page (native share sheet when available, WhatsApp / Facebook / copy link otherwise). */
export function ShareButtons({ path, title }: { path: string; title: string }) {
  const tr = useT();
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL ?? '');
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator.share === 'function');
  }, []);

  const url = `${origin}${path}`;
  const text = `${title} — Concours TN`;

  async function nativeShare() {
    try {
      await navigator.share({ title: text, url });
      track('share', { path, channel: 'native' });
    } catch {
      /* dismissed */
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track('share', { path, channel: 'copy' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canShare && (
        <button type="button" onClick={nativeShare} className={btn}>
          <Share2 className="size-4" aria-hidden />
          {tr({ ar: 'شارك', fr: 'Partager' })}
        </button>
      )}
      <a className={btn} href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`} target="_blank" rel="noopener noreferrer" onClick={() => track('share', { path, channel: 'whatsapp' })}>
        <MessageCircle className="size-4" aria-hidden />
        WhatsApp
      </a>
      <a className={btn} href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" onClick={() => track('share', { path, channel: 'facebook' })}>
        <Facebook className="size-4" aria-hidden />
        Facebook
      </a>
      <button type="button" onClick={copy} className={btn} aria-live="polite">
        {copied ? <Check className="size-4 text-success" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        {copied ? tr({ ar: 'تم نسخ الرابط', fr: 'Lien copié' }) : tr({ ar: 'انسخ الرابط', fr: 'Copier le lien' })}
      </button>
    </div>
  );
}

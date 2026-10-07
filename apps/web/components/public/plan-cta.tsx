'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useSession, useT } from '@/components/providers';
import { track } from './track';

/** Plan button: registered users go straight to checkout, others register first and come back to it. */
export function PlanCta({ planCode, highlight }: { planCode: string; highlight?: boolean }) {
  const tr = useT();
  const { me } = useSession();
  const cls = clsx(
    'inline-flex min-h-12 w-full items-center justify-center rounded-xl px-4 font-semibold transition hover:opacity-90',
    highlight ? 'bg-accent text-white' : 'bg-primary text-primary-contrast',
  );
  if (planCode === 'FREE') {
    return (
      <Link href="/#diagnostic" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border bg-surface px-4 font-semibold hover:bg-surface-2">
        {tr({ ar: 'ابدأ مجانًا', fr: 'Commencer gratuitement' })}
      </Link>
    );
  }
  const target = `/app/billing?plan=${encodeURIComponent(planCode)}`;
  const href = me && !me.isGuest ? target : `/register?next=${encodeURIComponent(target)}`;
  return (
    <Link href={href} className={cls} onClick={() => track('checkout_intent', { planCode, registered: !!me && !me.isGuest })}>
      {tr({ ar: 'اشترك الآن', fr: 'S’abonner' })}
    </Link>
  );
}

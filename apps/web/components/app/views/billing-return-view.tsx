'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleX, Crown, Hourglass } from 'lucide-react';
import type { PaymentStatus } from '@ctn/shared';
import { ButtonLink, Spinner } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/i18n';

type Status = 'paid' | 'pending' | 'failed';
const POLL_MS = 5_000;
const POLL_MAX = 24; // ~2 minutes

/** Landing page after a payment provider (the API verified the payment server-side before redirecting here). */
export function BillingReturnView({ status: initial, paymentId }: { status: Status; paymentId?: string }) {
  const tr = useT();
  const { locale } = useLocale();
  const { me, refresh } = useSession();
  const [status, setStatus] = useState<Status>(initial);
  const polls = useRef(0);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Pending (provider still confirming, or manual transfer): poll the payment for a while.
  useEffect(() => {
    if (status !== 'pending' || !paymentId) return;
    const id = window.setInterval(async () => {
      polls.current += 1;
      if (polls.current > POLL_MAX) return window.clearInterval(id);
      try {
        const b = await api<{ payments: { id: string; status: PaymentStatus }[] }>('/billing/me');
        const p = b.payments.find((x) => x.id === paymentId);
        if (p?.status === 'PAID') {
          setStatus('paid');
          void refresh();
        } else if (p?.status === 'FAILED') {
          setStatus('failed');
        }
      } catch {
        /* keep polling */
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [status, paymentId, refresh]);

  if (status === 'paid') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center" role="status" aria-live="polite">
        <span className="inline-flex size-16 items-center justify-center rounded-full bg-success-soft text-success"><CircleCheck className="size-9" aria-hidden /></span>
        <h1 className="text-2xl font-extrabold">{tr({ ar: 'تم الدفع بنجاح!', fr: 'Paiement réussi !' })}</h1>
        <p className="flex items-center gap-2 font-semibold text-accent"><Crown className="size-5" aria-hidden />{tr({ ar: 'بريميوم مفعّل', fr: 'Premium activé' })}</p>
        {me?.premium.endsAt && <p className="text-sm text-muted">{tr({ ar: 'صالح حتى', fr: 'Valable jusqu’au' })} {formatDate(locale, me.premium.endsAt)}</p>}
        <p className="max-w-sm text-sm text-muted">{tr({ ar: 'أصبحت الأسئلة والامتحانات التجريبية غير محدودة. تجد تفاصيل الدفع في صفحة الاشتراك.', fr: 'Questions et examens blancs sont désormais illimités. Le détail du paiement figure sur la page abonnement.' })}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink href="/app">{tr({ ar: 'واصل التحضير', fr: 'Continuer ma préparation' })}</ButtonLink>
          <ButtonLink href="/app/mock" variant="secondary">{tr({ ar: 'امتحان تجريبي', fr: 'Examen blanc' })}</ButtonLink>
        </div>
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center" role="status" aria-live="polite">
        <span className="inline-flex size-16 items-center justify-center rounded-full bg-warning-soft text-warning"><Hourglass className="size-9" aria-hidden /></span>
        <h1 className="text-2xl font-extrabold">{tr({ ar: 'الدفع قيد التأكيد', fr: 'Paiement en cours de confirmation' })}</h1>
        <p className="max-w-sm text-sm text-muted">{tr({ ar: 'ننتظر تأكيد مزوّد الدفع. يمكنك مغادرة هذه الصفحة: سيُفعّل اشتراكك تلقائيًا وستصلك رسالة.', fr: 'Nous attendons la confirmation du prestataire. Vous pouvez quitter cette page : l’abonnement s’activera automatiquement et vous serez notifié.' })}</p>
        {paymentId && polls.current <= POLL_MAX && <Spinner />}
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink href="/app/billing" variant="secondary">{tr({ ar: 'صفحة الاشتراك', fr: 'Page abonnement' })}</ButtonLink>
          <ButtonLink href="/app">{tr({ ar: 'العودة إلى فضائي', fr: 'Retour à mon espace' })}</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center" role="alert">
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-danger-soft text-danger"><CircleX className="size-9" aria-hidden /></span>
      <h1 className="text-2xl font-extrabold">{tr({ ar: 'لم يتم الدفع', fr: 'Paiement non abouti' })}</h1>
      <p className="max-w-sm text-sm text-muted">{tr({ ar: 'لم يُقتطع أي مبلغ، أو سيُعاد آليًا من طرف البنك. يمكنك المحاولة من جديد أو اختيار طريقة أخرى (D17، تحويل).', fr: 'Aucun montant n’a été débité, ou il sera automatiquement restitué par la banque. Réessayez ou choisissez un autre moyen (D17, virement).' })}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href="/app/billing">{tr({ ar: 'إعادة المحاولة', fr: 'Réessayer' })}</ButtonLink>
        <ButtonLink href="/app" variant="secondary">{tr({ ar: 'العودة إلى فضائي', fr: 'Retour à mon espace' })}</ButtonLink>
      </div>
    </div>
  );
}

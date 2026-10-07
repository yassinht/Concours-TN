'use client';

import Link from 'next/link';
import { BellRing, Mail } from 'lucide-react';
import { useSession, useT } from '@/components/providers';
import { PushOptIn } from './push-optin';

/** Confirmation after alerts are switched on, with the next useful steps (phone push, e-mail via an account). */
export function AlertsActivated({ next }: { next: string }) {
  const tr = useT();
  const { me } = useSession();
  const guest = !me || me.isGuest;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-success/40 bg-success-soft p-4" role="status" aria-live="polite">
      <p className="flex items-center gap-2 font-bold text-success">
        <BellRing className="size-5" aria-hidden />
        {tr({ ar: 'تم! التنبيهات مفعّلة', fr: 'C’est fait ! Alertes activées' })}
      </p>
      <p className="text-sm">
        {tr({
          ar: 'عند نشر مناظرة تستوفي شروطها المعلنة، ستجد تنبيهًا في التطبيق، ثم تذكيرًا قبل آخر أجل للترشح. المعطيات تبقى قابلة للتعديل أو الحذف في أي وقت.',
          fr: 'Dès qu’un concours dont vous remplissez les conditions est publié, une alerte apparaît dans l’app, puis un rappel avant la clôture. Vos données restent modifiables ou supprimables à tout moment.',
        })}
      </p>
      <PushOptIn />
      {guest && (
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <Mail className="size-4" aria-hidden />
          {tr({ ar: 'أنشئ حسابًا مجانيًا لتصلك التنبيهات بالبريد ولا يضيع ملفك عند تغيير الهاتف', fr: 'Créez un compte gratuit pour recevoir les alertes par e-mail et garder votre profil sur tous vos appareils' })}
        </Link>
      )}
    </div>
  );
}

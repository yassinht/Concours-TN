'use client';

import { useEffect } from 'react';
import { Crown, Sparkles } from 'lucide-react';
import { ButtonLink, Button, Modal } from '@/components/ui';
import { useSession, useT } from '@/components/providers';
import { track } from '@/components/app/use-api';
import type { Bi } from '@/lib/i18n';

export type PaywallReason = 'limit' | 'mock' | 'tutor';

const TITLES: Record<PaywallReason, Bi> = {
  limit: { ar: 'بلغت حد الأسئلة المجانية لليوم', fr: 'Limite gratuite du jour atteinte' },
  mock: { ar: 'استعملت الامتحان التجريبي المجاني', fr: 'Examen blanc gratuit déjà utilisé' },
  tutor: { ar: 'استعملت شروحات المساعد المجانية لليوم', fr: 'Explications gratuites du tuteur épuisées' },
};

const LEADS: Record<PaywallReason, Bi> = {
  limit: { ar: 'إجاباتك محفوظة. عُد غدًا لأسئلة مجانية جديدة، أو واصل الآن دون حدود.', fr: 'Vos réponses sont enregistrées. Revenez demain pour de nouvelles questions gratuites, ou continuez sans limite dès maintenant.' },
  mock: { ar: 'الامتحانات التجريبية بنفس صيغة المناظرة وتوقيتها هي أفضل طريقة لقياس جاهزيتك.', fr: 'Les examens blancs au format et au chronométrage réels sont le meilleur moyen de mesurer votre préparation.' },
  tutor: { ar: 'التصحيح والشرح المكتوب يبقيان متاحين دائمًا. الشرح المفصّل غير محدود في بريميوم.', fr: 'Le corrigé et l’explication restent toujours disponibles. Les explications détaillées sont illimitées en Premium.' },
};

/** Upsell shown on 402 (LIMIT_REACHED / PREMIUM_REQUIRED). Never blocks what the user already did. */
export function PaywallModal({ reason, onClose, from }: { reason: PaywallReason | null; onClose: () => void; from: string }) {
  const tr = useT();
  const { me } = useSession();
  const guest = !!me?.isGuest;

  useEffect(() => {
    if (reason) track('paywall_view', { from, reason });
  }, [reason, from]);

  const href = guest ? '/register?next=/app/billing' : '/app/billing';
  return (
    <Modal open={!!reason} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Crown className="size-5 text-accent" aria-hidden />{reason ? tr(TITLES[reason]) : ''}</span>}>
      {reason && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{tr(LEADS[reason])}</p>
          <ul className="grid gap-2 text-sm">
            {[
              { ar: 'أسئلة غير محدودة كل يوم مع التصحيح والشرح', fr: 'Questions illimitées chaque jour, avec corrigés' },
              { ar: 'امتحانات تجريبية غير محدودة بنفس صيغة المناظرة', fr: 'Examens blancs illimités au format du concours' },
              { ar: 'شرح مفصل لكل خطأ ومؤشر جاهزية دقيق', fr: 'Explication détaillée de chaque erreur et indicateur de préparation' },
              { ar: 'التحضير دون اتصال بالإنترنت', fr: 'Révision hors ligne' },
            ].map((f) => (
              <li key={f.fr} className="flex items-start gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />{tr(f)}</li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ButtonLink href={href} variant="accent" size="lg" className="sm:flex-1">
              <Crown className="size-4" aria-hidden />
              {guest ? tr({ ar: 'أنشئ حسابًا ثم اشترك', fr: 'Créer un compte puis s’abonner' }) : tr({ ar: 'اكتشف العروض', fr: 'Voir les offres' })}
            </ButtonLink>
            <Button variant="secondary" size="lg" onClick={onClose}>{tr({ ar: 'لاحقًا', fr: 'Plus tard' })}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

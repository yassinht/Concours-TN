'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BadgePercent, Check, CircleCheck, Clock, Crown, CreditCard, FlaskConical, Landmark, Lock, Receipt, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import type { PaymentProvider, PaymentStatus, PlanDTO } from '@ctn/shared';
import { formatTnd } from '@ctn/shared/dist/pricing';
import { Alert, Badge, Button, Field, Input, ProgressBar } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { api, ApiError } from '@/lib/api';
import { formatDate, type Bi } from '@/lib/i18n';
import { ErrorState, PageHeader, Skeleton } from '../bits';
import { bi, countLabel, errorText } from '../format';
import { errorCode, track, useApi } from '../use-api';

interface BillingPayment {
  id: string; amountMillimes: number; provider: PaymentProvider; status: PaymentStatus; createdAt: string; planCode: string;
  planName_ar: string; planName_fr: string; paidAt: string | null; manualReference: string | null; instructions_ar?: string; instructions_fr?: string;
}
interface BillingMe {
  subscription: { planCode: string; planName_ar: string; planName_fr: string; status: string; startsAt: string; endsAt: string; daysLeft: number; source: string } | null;
  payments: BillingPayment[];
  entitlements: { premium: boolean; planCode: string | null; endsAt: string | null; limits: { questionsPerDay: number | null; tutorPerDay: number; mocksTotal: number | null; offline: boolean } };
  usageToday: { date: string; questions: number; tutor: number };
  providers: { code: PaymentProvider; available: boolean }[];
}
interface PromoResult { valid: boolean; percentOff: number; amountMillimes: number; priceMillimes?: number; reason?: string | null }
interface CheckoutResult {
  paymentId: string; provider: PaymentProvider; status?: PaymentStatus; redirectUrl: string | null; amountMillimes: number; reference?: string;
  instructions_ar?: string; instructions_fr?: string;
}

const SHOW_MOCK = process.env.NODE_ENV !== 'production';

const PROVIDERS: { code: PaymentProvider; label: Bi; hint: Bi; icon: typeof CreditCard }[] = [
  { code: 'KONNECT', label: { ar: 'بطاقة بنكية / e-Dinar / محفظة', fr: 'Carte bancaire / e-Dinar / wallet' }, hint: { ar: 'دفع آمن عبر Konnect — تفعيل فوري', fr: 'Paiement sécurisé via Konnect — activation immédiate' }, icon: CreditCard },
  { code: 'FLOUCI', label: { ar: 'Flouci', fr: 'Flouci' }, hint: { ar: 'الدفع بتطبيق Flouci — تفعيل فوري', fr: 'Paiement avec l’app Flouci — activation immédiate' }, icon: Wallet },
  { code: 'MANUAL', label: { ar: 'D17 أو تحويل بنكي', fr: 'D17 ou virement bancaire' }, hint: { ar: 'تفعيل بعد التحقق اليدوي (عادة خلال 24 ساعة)', fr: 'Activation après vérification manuelle (sous 24 h en général)' }, icon: Landmark },
  { code: 'MOCK', label: { ar: 'دفع تجريبي', fr: 'Paiement test' }, hint: { ar: 'بيئة التطوير فقط — لا يُقتطع أي مبلغ', fr: 'Environnement de développement uniquement — aucun débit' }, icon: FlaskConical },
];

const PAYMENT_STATUS: Record<PaymentStatus, Bi & { tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  PAID: { ar: 'مدفوع', fr: 'Payé', tone: 'success' },
  PENDING: { ar: 'في الانتظار', fr: 'En attente', tone: 'warning' },
  FAILED: { ar: 'فشل', fr: 'Échoué', tone: 'danger' },
  REFUNDED: { ar: 'مُسترجع', fr: 'Remboursé', tone: 'neutral' },
};

const PROMO_REASONS: Record<string, Bi> = {
  NOT_FOUND: { ar: 'رمز غير موجود.', fr: 'Code inconnu.' },
  INACTIVE: { ar: 'هذا الرمز غير مفعّل.', fr: 'Ce code n’est pas actif.' },
  EXPIRED: { ar: 'انتهت صلاحية الرمز.', fr: 'Ce code a expiré.' },
  EXHAUSTED: { ar: 'استُنفد عدد استعمالات الرمز.', fr: 'Ce code a atteint sa limite d’utilisation.' },
  ALREADY_USED: { ar: 'استعملت هذا الرمز من قبل.', fr: 'Vous avez déjà utilisé ce code.' },
  NOT_APPLICABLE: { ar: 'الرمز لا ينطبق على هذا العرض.', fr: 'Ce code ne s’applique pas à cette offre.' },
};

function durationLabel(days: number): Bi {
  if (days % 30 === 0 && days <= 360) {
    const m = days / 30;
    return { ar: m === 1 ? 'شهر واحد' : m === 2 ? 'شهران' : m <= 10 ? `${m} أشهر` : `${m} شهرًا`, fr: `${m} mois` };
  }
  return { ar: `${days} يومًا`, fr: `${days} jours` };
}

function featureLines(p: PlanDTO): Bi[] {
  const f = p.features as { questions_per_day?: number | null; tutor_per_day?: number; mocks_total?: number | null; offline?: boolean; analytics?: string };
  const out: Bi[] = [];
  out.push(f.questions_per_day == null ? { ar: 'أسئلة غير محدودة', fr: 'Questions illimitées' } : { ar: `${f.questions_per_day} سؤالًا يوميًا`, fr: `${f.questions_per_day} questions / jour` });
  out.push(f.mocks_total == null ? { ar: 'امتحانات تجريبية غير محدودة', fr: 'Examens blancs illimités' } : { ar: `${f.mocks_total} امتحان تجريبي`, fr: `${f.mocks_total} examen(s) blanc(s)` });
  if (f.tutor_per_day) out.push({ ar: `${f.tutor_per_day} شرحًا من المساعد يوميًا`, fr: `${f.tutor_per_day} explications du tuteur / jour` });
  if (f.analytics === 'full') out.push({ ar: 'تحليل مفصل للتقدم والجاهزية', fr: 'Analyses détaillées de progression' });
  if (f.offline) out.push({ ar: 'التحضير دون اتصال', fr: 'Révision hors ligne' });
  out.push({ ar: 'تنبيهات المناظرات (مجانية للجميع)', fr: 'Alertes concours (gratuites pour tous)' });
  return out;
}

export function BillingView() {
  const tr = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { me } = useSession();
  const registered = !!me && !me.isGuest;

  useEffect(() => {
    if (me?.isGuest) router.replace('/register?next=/app/billing');
  }, [me, router]);

  const billing = useApi<BillingMe>(registered ? '/billing/me' : null);
  const plans = useApi<PlanDTO[]>(registered ? '/billing/plans' : null);
  const providersApi = useApi<{ code: PaymentProvider; available: boolean }[]>(registered ? '/billing/providers' : null);
  const viewed = useRef(false);

  useEffect(() => {
    if (!registered || viewed.current) return;
    viewed.current = true;
    track('paywall_view', { from: 'billing_page', premium: !!me?.premium.active });
  }, [registered, me]);

  const paidPlans = useMemo(() => (plans.data ?? []).filter((p) => p.priceMillimes > 0), [plans.data]);
  const [planCode, setPlanCode] = useState<string | null>(null);
  useEffect(() => {
    if (!planCode && paidPlans.length) setPlanCode((paidPlans.find((p) => p.code === 'PREMIUM_QUARTER') ?? paidPlans[0]).code);
  }, [paidPlans, planCode]);
  const plan = paidPlans.find((p) => p.code === planCode) ?? null;

  const availability = providersApi.data ?? billing.data?.providers ?? null;
  const providerOptions = PROVIDERS.filter((p) => p.code !== 'MOCK' || SHOW_MOCK).map((p) => ({
    ...p,
    available: availability ? !!availability.find((a) => a.code === p.code)?.available : p.code !== 'MOCK',
  }));
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  useEffect(() => {
    if (provider && providerOptions.find((p) => p.code === provider)?.available) return;
    const first = providerOptions.find((p) => p.available);
    if (first) setProvider(first.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability]);

  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; planCode: string; result: PromoResult } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<Bi | null>(null);
  const [manual, setManual] = useState<CheckoutResult | null>(null);

  const activePromo = promo && plan && promo.planCode === plan.code && promo.result.valid ? promo : null;
  const total = plan ? (activePromo ? activePromo.result.amountMillimes : plan.priceMillimes) : 0;

  async function applyPromo(e: FormEvent) {
    e.preventDefault();
    const code = promoInput.trim().toUpperCase();
    if (!code || !plan) return;
    setPromoBusy(true);
    try {
      const r = await api<PromoResult>('/billing/promo/validate', { body: { code, planCode: plan.code } });
      setPromo({ code, planCode: plan.code, result: r });
    } catch (err) {
      setPromo({ code, planCode: plan.code, result: { valid: false, percentOff: 0, amountMillimes: plan.priceMillimes, reason: errorCode(err) } });
    } finally {
      setPromoBusy(false);
    }
  }

  async function checkout() {
    if (!plan || !provider) return;
    setPaying(true);
    setError(null);
    track('checkout_start', { planCode: plan.code, provider, promo: !!activePromo });
    try {
      const r = await api<CheckoutResult>('/billing/checkout', { body: { planCode: plan.code, provider, ...(activePromo ? { promoCode: activePromo.code } : {}) } });
      if (r.redirectUrl) {
        window.location.assign(r.redirectUrl);
        return;
      }
      if (r.provider === 'MANUAL') {
        setManual(r);
        void billing.reload();
      }
      setPaying(false);
    } catch (err) {
      const code = errorCode(err);
      const reason = err instanceof ApiError && err.body && typeof err.body === 'object' ? (err.body as { reason?: string }).reason : undefined;
      setError(code === 'PROMO_INVALID' && reason && PROMO_REASONS[reason] ? PROMO_REASONS[reason] : errorText(code));
      setPaying(false);
    }
  }

  if (!registered) return <div className="flex flex-col gap-4"><Skeleton className="h-24" /><Skeleton className="h-80" /></div>;

  const header = (
    <PageHeader
      title={tr({ ar: 'الاشتراك', fr: 'Abonnement' })}
      subtitle={tr({ ar: 'دفع لمرة واحدة، دون تجديد تلقائي. الأسعار بالدينار التونسي وتشمل كل الأداءات.', fr: 'Paiement unique, sans renouvellement automatique. Prix en dinars, toutes taxes comprises.' })}
    />
  );
  if (billing.loading || plans.loading) return <>{header}<div className="flex flex-col gap-4"><Skeleton className="h-28" /><Skeleton className="h-80" /></div></>;
  if (billing.error || plans.error) return <>{header}<ErrorState error={billing.error ?? plans.error} onRetry={() => { void billing.reload(); void plans.reload(); }} /></>;

  const b = billing.data!;
  const sub = b.subscription;
  const limits = b.entitlements.limits;
  const pendingManual = b.payments.filter((p) => p.provider === 'MANUAL' && p.status === 'PENDING');

  return (
    <div className="flex flex-col gap-5">
      {header}

      {sub && b.entitlements.premium ? (
        <section className="flex flex-col gap-2 rounded-2xl bg-accent-soft p-4" aria-labelledby="cur-h">
          <h2 id="cur-h" className="flex items-center gap-2 font-bold text-accent"><Crown className="size-5" aria-hidden />{bi(locale, sub.planName_ar, sub.planName_fr)}</h2>
          <p className="text-sm">{tr({ ar: 'صالح حتى', fr: 'Valable jusqu’au' })} <strong>{formatDate(locale, sub.endsAt)}</strong> · {tr({ ar: `بقي ${countLabel('ar', sub.daysLeft, 'day')}`, fr: `encore ${countLabel('fr', sub.daysLeft, 'day')}` })}</p>
          <p className="text-xs text-muted">{tr({ ar: 'يمكنك التمديد الآن: تُضاف المدة الجديدة بعد تاريخ الانتهاء الحالي.', fr: 'Vous pouvez prolonger dès maintenant : la nouvelle période s’ajoute après la date de fin actuelle.' })}</p>
        </section>
      ) : (
        <section className="card flex flex-col gap-3 p-4" aria-labelledby="cur-h">
          <h2 id="cur-h" className="font-bold">{tr({ ar: 'خطتك الحالية: مجانية', fr: 'Votre formule actuelle : Gratuite' })}</h2>
          {limits.questionsPerDay != null && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-sm"><span>{tr({ ar: 'أسئلة اليوم', fr: 'Questions du jour' })}</span><span className="font-semibold tabular-nums">{b.usageToday.questions}/{limits.questionsPerDay}</span></div>
              <ProgressBar value={(b.usageToday.questions / Math.max(1, limits.questionsPerDay)) * 100} tone={b.usageToday.questions >= limits.questionsPerDay ? 'danger' : 'primary'} label={tr({ ar: 'أسئلة اليوم', fr: 'Questions du jour' })} />
            </div>
          )}
          <div className="flex justify-between text-sm"><span>{tr({ ar: 'شروحات المساعد اليوم', fr: 'Explications du tuteur aujourd’hui' })}</span><span className="font-semibold tabular-nums">{b.usageToday.tutor}/{limits.tutorPerDay}</span></div>
        </section>
      )}

      {pendingManual.length > 0 && !manual && (
        <section className="flex flex-col gap-3" aria-labelledby="pending-h">
          <h2 id="pending-h" className="text-lg font-bold">{tr({ ar: 'دفعات في انتظار التأكيد', fr: 'Paiements en attente' })}</h2>
          {pendingManual.map((p) => <ManualPanel key={p.id} paymentId={p.id} amountMillimes={p.amountMillimes} instructions={locale === 'fr' ? p.instructions_fr : p.instructions_ar} existingRef={p.manualReference} onDone={billing.reload} />)}
        </section>
      )}

      {manual ? (
        <section className="flex flex-col gap-3" aria-labelledby="manual-h">
          <h2 id="manual-h" className="text-lg font-bold">{tr({ ar: 'أكمل الدفع عبر D17 أو التحويل', fr: 'Finalisez votre paiement par D17 ou virement' })}</h2>
          <ManualPanel paymentId={manual.paymentId} amountMillimes={manual.amountMillimes} instructions={locale === 'fr' ? manual.instructions_fr : manual.instructions_ar} existingRef={null} onDone={billing.reload} />
          <Button variant="ghost" onClick={() => setManual(null)} className="self-start">{tr({ ar: 'اختيار طريقة أخرى', fr: 'Choisir un autre moyen' })}</Button>
        </section>
      ) : (
        <>
          <section aria-labelledby="plans-h" className="flex flex-col gap-3">
            <h2 id="plans-h" className="text-lg font-bold">{tr({ ar: '1. اختر عرضك', fr: '1. Choisissez votre offre' })}</h2>
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-labelledby="plans-h">
              {paidPlans.map((p) => {
                const selected = p.code === planCode;
                const perMonth = p.durationDays >= 60 ? Math.round(p.priceMillimes / (p.durationDays / 30) / 100) * 100 : null;
                const best = p.code === 'PREMIUM_QUARTER';
                return (
                  <button key={p.code} type="button" role="radio" aria-checked={selected} onClick={() => setPlanCode(p.code)}
                    className={clsx('relative flex flex-col gap-2 rounded-2xl border-2 p-4 text-start transition', selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-primary/50')}>
                    {best && <Badge tone="accent" className="absolute -top-2.5 end-3">{tr({ ar: 'الأكثر اختيارًا', fr: 'Le plus choisi' })}</Badge>}
                    <span className="font-bold">{bi(locale, p.name_ar, p.name_fr)}</span>
                    <span className="text-2xl font-extrabold tabular-nums">{formatTnd(p.priceMillimes, locale)}</span>
                    <span className="text-xs text-muted">
                      {tr(durationLabel(p.durationDays))} · {tr({ ar: 'شامل الأداءات', fr: 'TTC' })}
                      {perMonth != null && <> · {tr({ ar: 'أي', fr: 'soit' })} {formatTnd(perMonth, locale)}{tr({ ar: '/شهر', fr: '/mois' })}</>}
                    </span>
                    <ul className="mt-1 flex flex-col gap-1 text-sm">
                      {featureLines(p).map((f) => <li key={f.fr} className="flex items-start gap-1.5"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{tr(f)}</li>)}
                    </ul>
                  </button>
                );
              })}
            </div>
            <form onSubmit={applyPromo} className="flex flex-col gap-1.5">
              <label htmlFor="promo" className="flex items-center gap-1.5 text-sm font-semibold"><BadgePercent className="size-4" aria-hidden />{tr({ ar: 'رمز تخفيض', fr: 'Code promo' })}</label>
              <div className="flex gap-2">
                <Input id="promo" value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} maxLength={40} autoComplete="off" dir="ltr" className="flex-1" />
                <Button type="submit" variant="secondary" loading={promoBusy} disabled={!promoInput.trim() || !plan}>{tr({ ar: 'تطبيق', fr: 'Appliquer' })}</Button>
              </div>
              {promo && plan && promo.planCode === plan.code && (
                promo.result.valid
                  ? <p className="text-sm font-semibold text-success" role="status">{tr({ ar: `تخفيض ${promo.result.percentOff}% مطبّق`, fr: `Réduction de ${promo.result.percentOff} % appliquée` })}</p>
                  : <p className="text-sm text-danger" role="alert">{tr(PROMO_REASONS[promo.result.reason ?? ''] ?? errorText(promo.result.reason ?? undefined))}</p>
              )}
            </form>
          </section>

          <section aria-labelledby="prov-h" className="flex flex-col gap-3">
            <h2 id="prov-h" className="text-lg font-bold">{tr({ ar: '2. طريقة الدفع', fr: '2. Moyen de paiement' })}</h2>
            <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="prov-h">
              {providerOptions.map((p) => {
                const Icon = p.icon;
                const selected = provider === p.code;
                return (
                  <button key={p.code} type="button" role="radio" aria-checked={selected} disabled={!p.available} onClick={() => setProvider(p.code)}
                    className={clsx('flex min-h-14 items-center gap-3 rounded-xl border-2 p-3 text-start transition disabled:cursor-not-allowed disabled:opacity-50', selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-primary/50')}>
                    <Icon className="size-6 shrink-0 text-primary" aria-hidden />
                    <span className="flex flex-1 flex-col">
                      <span className="font-semibold">{tr(p.label)}</span>
                      <span className="text-xs text-muted">{p.available ? tr(p.hint) : tr({ ar: 'غير متاح حاليًا', fr: 'Indisponible pour le moment' })}</span>
                    </span>
                    {p.code === 'MANUAL' ? <Smartphone className="size-4 text-muted" aria-hidden /> : <Lock className="size-4 text-muted" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </section>

          {plan && (
            <section aria-labelledby="sum-h" className="card flex flex-col gap-3 p-4">
              <h2 id="sum-h" className="text-lg font-bold">{tr({ ar: '3. الملخص', fr: '3. Récapitulatif' })}</h2>
              <dl className="flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between gap-2"><dt>{bi(locale, plan.name_ar, plan.name_fr)} · {tr(durationLabel(plan.durationDays))}</dt><dd className="tabular-nums">{formatTnd(plan.priceMillimes, locale)}</dd></div>
                {activePromo && (
                  <div className="flex justify-between gap-2 text-success"><dt>{tr({ ar: 'تخفيض', fr: 'Réduction' })} ({activePromo.code}, −{activePromo.result.percentOff}%)</dt><dd className="tabular-nums">−{formatTnd(plan.priceMillimes - total, locale)}</dd></div>
                )}
                <div className="flex justify-between gap-2 border-t border-border pt-2 text-base font-bold"><dt>{tr({ ar: 'المجموع (شامل الأداءات)', fr: 'Total TTC' })}</dt><dd className="tabular-nums">{formatTnd(total, locale)}</dd></div>
              </dl>
              {sub && b.entitlements.premium && (
                <p className="text-xs text-muted">{tr({ ar: `ستبدأ المدة الجديدة بعد ${formatDate(locale, sub.endsAt)}.`, fr: `La nouvelle période commencera après le ${formatDate(locale, sub.endsAt)}.` })}</p>
              )}
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  {tr({
                    ar: 'أطلب تفعيل الخدمة فورًا بعد الدفع، وأقرّ بأنني اطلعت على ',
                    fr: 'Je demande l’accès immédiat au service après paiement et reconnais avoir lu les ',
                  })}
                  <Link href="/legal/terms" target="_blank" className="font-semibold text-primary underline">{tr({ ar: 'شروط البيع والاستعمال', fr: 'conditions de vente et d’utilisation' })}</Link>
                  {tr({
                    ar: '، وأن حق التراجع (10 أيام عمل) لا ينطبق بعد بدء استعمال الخدمات الرقمية بموافقتي.',
                    fr: ', et que le droit de rétractation (10 jours ouvrables) ne s’applique plus une fois l’utilisation du service numérique commencée avec mon accord.',
                  })}
                </span>
              </label>
              {error && <Alert tone="danger">{tr(error)}</Alert>}
              <Button size="lg" block onClick={checkout} loading={paying} disabled={!consent || !provider}>
                <Lock className="size-4" aria-hidden />
                {provider === 'MANUAL' ? tr({ ar: 'احصل على تعليمات الدفع', fr: 'Obtenir les instructions de paiement' }) : tr({ ar: `ادفع ${formatTnd(total, locale)}`, fr: `Payer ${formatTnd(total, locale)}` })}
              </Button>
              <ul className="flex flex-col gap-1 text-xs text-muted">
                <li className="flex items-start gap-1.5"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{tr({ ar: 'لا نخزّن أي معطيات بطاقة: الدفع يتم على صفحة مزوّد الدفع المرخّص.', fr: 'Aucune donnée de carte n’est stockée chez nous : le paiement se fait sur la page du prestataire agréé.' })}</li>
                <li className="flex items-start gap-1.5"><Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />{tr({ ar: 'دون تجديد تلقائي: لن يُقتطع أي مبلغ آخر دون طلبك.', fr: 'Sans renouvellement automatique : aucun autre prélèvement sans votre demande.' })}</li>
                <li className="flex items-start gap-1.5"><Receipt className="mt-0.5 size-3.5 shrink-0" aria-hidden />{tr({ ar: 'سؤال أو مشكلة في الدفع؟ راسلنا من صفحة شروط البيع.', fr: 'Une question sur un paiement ? Contactez-nous via la page des conditions de vente.' })}</li>
              </ul>
            </section>
          )}
        </>
      )}

      {b.payments.length > 0 && (
        <section aria-labelledby="hist-h" className="flex flex-col gap-2">
          <h2 id="hist-h" className="text-lg font-bold">{tr({ ar: 'سجل الدفعات', fr: 'Historique des paiements' })}</h2>
          <ul className="card divide-y divide-border">
            {b.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-semibold">{bi(locale, p.planName_ar, p.planName_fr)}</span>
                  <span className="text-xs text-muted">{formatDate(locale, p.createdAt)} · {PROVIDERS.find((x) => x.code === p.provider) ? tr(PROVIDERS.find((x) => x.code === p.provider)!.label) : p.provider}</span>
                  <span className="text-xs text-muted" dir="ltr">#{p.id.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tabular-nums">{formatTnd(p.amountMillimes, locale)}</span>
                  <Badge tone={PAYMENT_STATUS[p.status].tone}>{tr(PAYMENT_STATUS[p.status])}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** D17 / bank transfer instructions + "I paid, here is the operation number" form. */
function ManualPanel({ paymentId, amountMillimes, instructions, existingRef, onDone }: { paymentId: string; amountMillimes: number; instructions?: string; existingRef: string | null; onDone: () => void }) {
  const tr = useT();
  const { locale } = useLocale();
  const [reference, setReference] = useState(existingRef ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(!!existingRef);
  const [error, setError] = useState<Bi | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ref = reference.trim();
    if (ref.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await api('/billing/manual-proof', { body: { paymentId, reference: ref } });
      setSent(true);
      onDone();
    } catch (err) {
      setError(errorText(errorCode(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold tabular-nums">{formatTnd(amountMillimes, locale)}</span>
        <Badge tone="warning">{tr({ ar: 'في الانتظار', fr: 'En attente' })}</Badge>
      </div>
      {instructions && <p className="whitespace-pre-line rounded-xl bg-surface-2 p-3 text-sm" dir="auto">{instructions}</p>}
      <p className="text-xs text-muted">{tr({ ar: 'مرجع الدفع:', fr: 'Référence de paiement :' })} <code dir="ltr" className="select-all font-semibold text-text">{paymentId}</code></p>
      {sent ? (
        <p className="flex items-start gap-2 rounded-xl bg-success-soft p-3 text-sm" role="status">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          {tr({ ar: 'تم استلام رقم العملية. سنفعّل اشتراكك بعد التحقق ونرسل لك إشعارًا.', fr: 'Numéro d’opération reçu. Votre abonnement sera activé après vérification ; vous recevrez une notification.' })}
        </p>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Field label={tr({ ar: 'رقم العملية أو مرجع التحويل', fr: 'Numéro d’opération ou référence du virement' })} htmlFor={`ref-${paymentId}`}>
          <Input id={`ref-${paymentId}`} value={reference} onChange={(e) => setReference(e.target.value)} minLength={3} maxLength={200} required autoComplete="off" dir="ltr" />
        </Field>
        {error && <Alert tone="danger">{tr(error)}</Alert>}
        <Button type="submit" variant={sent ? 'secondary' : 'primary'} loading={busy} className="self-start">
          {sent ? tr({ ar: 'تحديث الرقم', fr: 'Mettre à jour' }) : tr({ ar: 'أرسلت المبلغ — أكّد', fr: 'J’ai payé — confirmer' })}
        </Button>
      </form>
    </div>
  );
}

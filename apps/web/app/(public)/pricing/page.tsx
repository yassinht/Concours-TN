import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Check, CreditCard, Gift, Landmark, Minus, ShieldCheck, Smartphone } from 'lucide-react';
import { PLANS, REFERRAL_REWARD_DAYS, formatTnd, type Locale, type PlanDTO } from '@ctn/shared';
import { Badge } from '@/components/ui';
import { PlanCta } from '@/components/public/plan-cta';
import { Container, Disclosure, PageHeader, Section } from '@/components/public/sections';
import { countLabel } from '@/components/public/labels';
import { load, pageMetadata } from '@/components/public/server-data';
import { TrackEvent } from '@/components/public/track';
import { getLocale } from '@/lib/i18n-server';
import { t, type Bi } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata(locale, {
    title: { ar: 'الأسعار', fr: 'Tarifs' },
    description: {
      ar: 'ابدأ مجانًا: اختبار تشخيصي، تنبيهات و20 سؤالًا يوميًا. بريميوم ابتداءً من 19 د.ت بالدفع بالبطاقة، e-Dinar أو D17، دون تجديد تلقائي.',
      fr: 'Commencez gratuitement : diagnostic, alertes et 20 questions par jour. Premium dès 19 DT, par carte, e-Dinar ou D17, sans renouvellement automatique.',
    },
    path: '/pricing',
  });
}

type Provider = { code: 'KONNECT' | 'FLOUCI' | 'MANUAL' | 'MOCK'; available: boolean };

const FALLBACK_PLANS: PlanDTO[] = PLANS.map((p) => ({
  code: p.code, name_ar: p.name_ar, name_fr: p.name_fr, priceMillimes: p.price_millimes, period: p.period, durationDays: p.duration_days, features: { ...p.features },
}));

function periodLabel(p: PlanDTO): Bi {
  switch (p.period) {
    case 'MONTH': return { ar: 'لمدة شهر', fr: 'pour 1 mois' };
    case 'QUARTER': return { ar: 'لمدة 3 أشهر', fr: 'pour 3 mois' };
    case 'EXAM_PASS': return { ar: 'حتى يوم الامتحان (6 أشهر كحد أقصى)', fr: 'jusqu’à l’examen (6 mois max.)' };
    case 'NONE': return { ar: 'دون حد زمني', fr: 'sans limite de durée' };
    default: return { ar: `لمدة ${p.durationDays} يومًا`, fr: `pour ${p.durationDays} jours` };
  }
}

type FeatureValue = boolean | number | string | null | undefined;
const FEATURE_ROWS: { key: string; label: Bi; render: (v: FeatureValue) => Bi | boolean }[] = [
  { key: 'diagnostic', label: { ar: 'الاختبار التشخيصي', fr: 'Test diagnostique' }, render: (v) => !!v },
  { key: 'alerts', label: { ar: 'تنبيهات المناظرات المناسبة لك', fr: 'Alertes des concours qui vous correspondent' }, render: (v) => !!v },
  { key: 'questions_per_day', label: { ar: 'أسئلة التدريب', fr: 'Questions d’entraînement' }, render: (v) => (v == null ? { ar: 'دون حد', fr: 'Illimité' } : { ar: `${v} يوميًا`, fr: `${v} par jour` }) },
  { key: 'tutor_per_day', label: { ar: 'شروحات «اشرح لي» المفصلة', fr: 'Explications détaillées « Explique-moi »' }, render: (v) => (v == null ? { ar: 'دون حد', fr: 'Illimité' } : { ar: `${v} يوميًا`, fr: `${v} par jour` }) },
  { key: 'mocks_total', label: { ar: 'امتحانات تجريبية بنفس الصيغة', fr: 'Examens blancs au format réel' }, render: (v) => (v == null ? { ar: 'دون حد', fr: 'Illimités' } : { ar: v === 1 ? 'امتحان واحد' : `${v}`, fr: v === 1 ? '1 examen' : `${v}` }) },
  { key: 'analytics', label: { ar: 'تحليل التقدم ومؤشر الجاهزية', fr: 'Analyse de progression et préparation' }, render: (v) => (v === 'full' ? { ar: 'كامل', fr: 'Complet' } : { ar: 'أساسي', fr: 'Basique' }) },
  { key: 'offline', label: { ar: 'المراجعة دون اتصال', fr: 'Révision hors ligne' }, render: (v) => !!v },
];

function Cell({ locale, value }: { locale: Locale; value: Bi | boolean }) {
  if (value === true) return <span className="inline-flex items-center gap-1 text-success"><Check className="size-5" aria-hidden /><span className="sr-only">{t(locale, { ar: 'متاح', fr: 'Inclus' })}</span></span>;
  if (value === false) return <span className="inline-flex items-center gap-1 text-muted"><Minus className="size-5" aria-hidden /><span className="sr-only">{t(locale, { ar: 'غير متاح', fr: 'Non inclus' })}</span></span>;
  return <span className="font-semibold">{t(locale, value)}</span>;
}

export default async function PricingPage() {
  const locale = await getLocale();
  const [plansRes, providersRes] = await Promise.all([load<PlanDTO[]>('/billing/plans', 300), load<Provider[]>('/billing/providers', 300)]);
  const plans = plansRes.data?.length ? plansRes.data : FALLBACK_PLANS;
  const free = plans.find((p) => p.priceMillimes === 0);
  const paid = plans.filter((p) => p.priceMillimes > 0);
  const perDay = (p: PlanDTO) => p.priceMillimes / Math.max(1, p.durationDays);
  const monthly = paid.find((p) => p.period === 'MONTH') ?? paid[0];
  const best = [...paid].sort((a, b) => perDay(a) - perDay(b))[0];
  const premium = paid.find((p) => p.period === 'MONTH') ?? paid[0];
  const providers = providersRes.data;
  const available = (codes: Provider['code'][]) => (providers ? providers.some((p) => codes.includes(p.code) && p.available) : null);

  return (
    <>
      <TrackEvent name="pricing_view" />
      <PageHeader
        title={t(locale, { ar: 'أسعار واضحة، دون مفاجآت', fr: 'Des prix clairs, sans surprise' })}
        lead={t(locale, {
          ar: 'ابدأ مجانًا، واشترك فقط إن احتجت إلى تدريب غير محدود وامتحانات تجريبية. الدفع مرة واحدة، دون تجديد تلقائي.',
          fr: 'Commencez gratuitement et abonnez-vous seulement si vous avez besoin d’entraînement illimité et d’examens blancs. Paiement unique, sans renouvellement automatique.',
        })}
      />
      <Container className="flex flex-col gap-12 py-8">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...(free ? [free] : []), ...paid].map((p) => {
            const isBest = best && p.code === best.code && paid.length > 1;
            const monthsEq = p.durationDays > 31 ? p.durationDays / 30 : null;
            const saving = monthly && monthsEq && p.code !== monthly.code ? Math.round((1 - perDay(p) / perDay(monthly)) * 100) : null;
            return (
              <li key={p.code} className={`card relative flex flex-col gap-4 p-5 ${isBest ? 'border-2 border-accent' : ''}`}>
                {isBest && <Badge tone="accent" className="absolute -top-3 start-4">{t(locale, { ar: 'الأوفر', fr: 'Meilleur rapport' })}</Badge>}
                <div>
                  <h2 className="font-bold">{locale === 'fr' ? p.name_fr : p.name_ar}</h2>
                  <p className="mt-2 text-3xl font-extrabold tabular-nums">{formatTnd(p.priceMillimes, locale)}</p>
                  <p className="text-sm text-muted">{t(locale, periodLabel(p))}</p>
                  {monthsEq && p.priceMillimes > 0 && (
                    <p className="mt-1 text-xs text-muted">
                      ≈ {formatTnd(Math.round(p.priceMillimes / monthsEq / 100) * 100, locale)} {t(locale, { ar: 'شهريًا', fr: '/ mois' })}
                      {saving != null && saving > 0 && <span className="ms-1 font-semibold text-success">· {t(locale, { ar: `وفّر ${saving}%`, fr: `−${saving} %` })}</span>}
                    </p>
                  )}
                </div>
                <ul className="flex flex-1 flex-col gap-2 text-sm">
                  {FEATURE_ROWS.map((row) => {
                    const v = row.render(p.features[row.key] as FeatureValue);
                    if (v === false) return null;
                    return (
                      <li key={row.key} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                        <span>{t(locale, row.label)}{v !== true && <>: <span className="font-semibold">{t(locale, v)}</span></>}</span>
                      </li>
                    );
                  })}
                </ul>
                <PlanCta planCode={p.code} highlight={!!isBest} />
              </li>
            );
          })}
        </ul>

        {free && premium && (
          <Section id="compare" title={t(locale, { ar: 'مقارنة المجاني وبريميوم', fr: 'Gratuit vs Premium' })}>
            <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[480px] border-separate border-spacing-0 overflow-hidden rounded-2xl border border-border bg-surface text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border p-3 text-start">{t(locale, { ar: 'الميزة', fr: 'Fonctionnalité' })}</th>
                    <th scope="col" className="border-b border-border p-3 text-center">{t(locale, { ar: 'مجاني', fr: 'Gratuit' })}</th>
                    <th scope="col" className="border-b border-border bg-primary-soft p-3 text-center text-primary">{t(locale, { ar: 'بريميوم', fr: 'Premium' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="border-b border-border p-3 text-start font-normal">{t(locale, row.label)}</th>
                      <td className="border-b border-border p-3 text-center"><Cell locale={locale} value={row.render(free.features[row.key] as FeatureValue)} /></td>
                      <td className="border-b border-border bg-primary-soft/40 p-3 text-center"><Cell locale={locale} value={row.render(premium.features[row.key] as FeatureValue)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <Section id="payment" title={t(locale, { ar: 'طرق الدفع', fr: 'Moyens de paiement' })} lead={t(locale, { ar: 'لا نخزّن أي معطيات بنكية: الدفع بالبطاقة يتم لدى مزوّد الدفع مباشرة.', fr: 'Aucune donnée bancaire n’est stockée chez nous : le paiement par carte se fait directement chez le prestataire.' })}>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PaymentCard locale={locale} icon={<CreditCard className="size-6" aria-hidden />} title={{ ar: 'بطاقة بنكية أو e-Dinar', fr: 'Carte bancaire ou e-Dinar' }} body={{ ar: 'دفع آمن عبر Konnect أو Flouci، وتفعيل فوري للاشتراك.', fr: 'Paiement sécurisé via Konnect ou Flouci, activation immédiate.' }} available={available(['KONNECT', 'FLOUCI'])} />
            <PaymentCard locale={locale} icon={<Smartphone className="size-6" aria-hidden />} title={{ ar: 'D17', fr: 'D17' }} body={{ ar: 'حوّل المبلغ من تطبيق D17 ثم أدخل رقم العملية؛ يُفعّل الاشتراك بعد التثبت منه.', fr: 'Payez depuis l’app D17 puis saisissez la référence ; activation après vérification.' }} available={available(['MANUAL'])} />
            <PaymentCard locale={locale} icon={<Landmark className="size-6" aria-hidden />} title={{ ar: 'تحويل بنكي أو بريدي', fr: 'Virement bancaire ou postal' }} body={{ ar: 'تحويل إلى حسابنا مع ذكر المرجع؛ يُفعّل الاشتراك بعد التثبت منه.', fr: 'Virement avec la référence indiquée ; activation après vérification.' }} available={available(['MANUAL'])} />
          </ul>
        </Section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
            <ShieldCheck className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden />
            <div className="text-sm">
              <h2 className="font-bold">{t(locale, { ar: 'حق التراجع والاسترجاع', fr: 'Droit de rétractation et remboursement' })}</h2>
              <p className="mt-1 text-muted">
                {t(locale, {
                  ar: 'طبقًا للقانون عدد 83 لسنة 2000 المتعلق بالمبادلات والتجارة الإلكترونية، يمكنك التراجع عن الشراء في أجل 10 أيام عمل من تاريخ الاشتراك وطلب استرجاع المبلغ من صفحة الاشتراك في حسابك.',
                  fr: 'Conformément à la loi n° 2000-83 relative aux échanges et au commerce électroniques, vous pouvez vous rétracter dans un délai de 10 jours ouvrables à compter de l’abonnement et demander le remboursement depuis la page Abonnement de votre compte.',
                })}
              </p>
              <p className="mt-1 text-xs text-muted">{t(locale, { ar: 'صياغة أولية في انتظار المصادقة القانونية النهائية.', fr: 'Formulation provisoire, en attente de validation juridique.' })} <Link href="/legal/terms#payments" className="underline">{t(locale, { ar: 'الشروط', fr: 'Conditions' })}</Link></p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
            <Gift className="mt-0.5 size-6 shrink-0 text-accent" aria-hidden />
            <div className="text-sm">
              <h2 className="font-bold">{t(locale, { ar: 'ادعُ صديقًا', fr: 'Parrainez un ami' })}</h2>
              <p className="mt-1 text-muted">
                {t(locale, {
                  ar: `عندما يُتم صديقك الاختبار التشخيصي عبر رابطك، تحصلان كلاكما على ${countLabel('ar', REFERRAL_REWARD_DAYS, 'day')} بريميوم مجانًا.`,
                  fr: `Quand un ami termine le test diagnostique via votre lien, vous recevez tous les deux ${countLabel('fr', REFERRAL_REWARD_DAYS, 'day')} de Premium offerts.`,
                })}
              </p>
            </div>
          </div>
        </div>

        <Section id="faq" title={t(locale, { ar: 'أسئلة حول الدفع', fr: 'Questions sur le paiement' })}>
          <div className="flex max-w-3xl flex-col gap-2">
            <Disclosure name="pricing-faq" summary={t(locale, { ar: 'هل يتجدد الاشتراك تلقائيًا؟', fr: 'L’abonnement se renouvelle-t-il automatiquement ?' })}>
              <p>{t(locale, { ar: 'لا. كل اشتراك دفعة واحدة لمدة محددة. نذكّرك قبل انتهائه، وأنت من يقرر التجديد.', fr: 'Non. Chaque abonnement est un paiement unique pour une durée fixe. Nous vous prévenons avant l’échéance, vous décidez de renouveler.' })}</p>
            </Disclosure>
            <Disclosure name="pricing-faq" summary={t(locale, { ar: 'ليست لدي بطاقة بنكية، كيف أدفع؟', fr: 'Je n’ai pas de carte bancaire, comment payer ?' })}>
              <p>{t(locale, { ar: 'يمكنك الدفع عبر D17 أو بتحويل بنكي/بريدي. بعد الدفع تُدخل رقم العملية ويُفعّل اشتراكك بعد التثبت منه.', fr: 'Vous pouvez payer par D17 ou par virement. Saisissez ensuite la référence de l’opération : l’abonnement est activé après vérification.' })}</p>
            </Disclosure>
            <Disclosure name="pricing-faq" summary={t(locale, { ar: 'ما الفرق بين «باس المناظرة» والاشتراك الشهري؟', fr: 'Quelle différence entre le Pass concours et le mensuel ?' })}>
              <p>{t(locale, { ar: 'باس المناظرة يغطي كامل فترة تحضيرك حتى يوم الامتحان (6 أشهر كحد أقصى) بسعر أقل لليوم الواحد، مع حصة أكبر من الشروحات المفصلة.', fr: 'Le Pass couvre toute votre préparation jusqu’à l’examen (6 mois max.) pour un coût journalier plus bas, avec davantage d’explications détaillées.' })}</p>
            </Disclosure>
            <Disclosure name="pricing-faq" summary={t(locale, { ar: 'هل يضمن الاشتراك النجاح؟', fr: 'L’abonnement garantit-il la réussite ?' })}>
              <p>{t(locale, { ar: 'لا. نوفر تحضيرًا منظمًا ومعلومات موثقة، لكن النجاح يعتمد على عملك وعلى عدد المترشحين والمراحل الأخرى للمناظرة.', fr: 'Non. Nous offrons une préparation structurée et des informations sourcées, mais la réussite dépend de votre travail, du nombre de candidats et des autres épreuves.' })}</p>
            </Disclosure>
          </div>
        </Section>
      </Container>
    </>
  );
}

function PaymentCard({ locale, icon, title, body, available }: { locale: Locale; icon: ReactNode; title: Bi; body: Bi; available: boolean | null }) {
  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">{icon}</span>
        {available === true && <Badge tone="success">{t(locale, { ar: 'متاح', fr: 'Disponible' })}</Badge>}
        {available === false && <Badge tone="neutral">{t(locale, { ar: 'قريبًا', fr: 'Bientôt' })}</Badge>}
      </div>
      <h3 className="font-bold">{t(locale, title)}</h3>
      <p className="text-sm text-muted">{t(locale, body)}</p>
    </li>
  );
}

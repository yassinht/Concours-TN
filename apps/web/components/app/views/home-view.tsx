'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarClock, Check, CircleCheck, ClipboardCheck, Dumbbell, HardDriveDownload, MailCheck, MailWarning,
  PartyPopper, Radar, RotateCcw, Target, TrendingUp, TriangleAlert,
} from 'lucide-react';
import type { AttemptSessionDTO, NotificationDTO, ReadinessDTO, TodayPlanDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, ButtonLink, Modal, ProgressBar, scoreTone } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { formatDate, type Bi } from '@/lib/i18n';
import { AlertRowCompact, groupAlerts, isActiveEdition, officialUrl, type AlertRow } from '../alerts';
import { ErrorState, SectionTitle, Skeleton, UpsellCard } from '../bits';
import { bi, countLabel, daysFromToday, deadlineText, editionTitle, errorText, greeting, READINESS_TEXT, tunisToday } from '../format';
import { NotificationRow } from '../notifications';
import { useShell } from '../shell';
import { errorCode, track, useApi } from '../use-api';

interface EnrollmentRow {
  id: string; familySlug: string; familyName_ar: string; familyName_fr: string; positionSlug: string | null;
  positionTitle_ar: string | null; positionTitle_fr: string | null; targetExamDate: string | null; dailyMinutes: number; isPrimary: boolean;
}
type PlanItem = TodayPlanDTO['items'][number] & { title_ar?: string; title_fr?: string; topicKey?: string };
interface BillingMe {
  entitlements: { premium: boolean; limits: { questionsPerDay: number | null } };
  usageToday: { questions: number };
}
interface Pending { date: string; index: number; kind: PlanItem['kind']; attemptId?: string }

const PENDING_KEY = 'ctn_plan_pending';
type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
const KIND: Record<PlanItem['kind'], { icon: Icon; label: Bi; cls: string }> = {
  PRACTICE: { icon: Dumbbell, label: { ar: 'تمارين', fr: 'Entraînement' }, cls: 'bg-primary-soft text-primary' },
  REVIEW: { icon: RotateCcw, label: { ar: 'مراجعة متباعدة', fr: 'Révision espacée' }, cls: 'bg-info-soft text-info' },
  MISTAKES: { icon: TriangleAlert, label: { ar: 'تصحيح أخطائي', fr: 'Mes erreurs' }, cls: 'bg-warning-soft text-warning' },
  LESSON: { icon: BookOpen, label: { ar: 'درس', fr: 'Leçon' }, cls: 'bg-success-soft text-success' },
  MOCK: { icon: ClipboardCheck, label: { ar: 'امتحان تجريبي', fr: 'Examen blanc' }, cls: 'bg-accent-soft text-accent' },
};

function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}
function writePending(p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function HomeView({ emailVerified }: { emailVerified?: '0' | '1' }) {
  const tr = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { me, refresh } = useSession();
  const { setUnread } = useShell();
  const ready = !!me && me.onboarding.hasEnrollment;

  useEffect(() => {
    if (me && !me.onboarding.hasEnrollment) router.replace('/app/onboarding');
  }, [me, router]);

  const enrollments = useApi<EnrollmentRow[]>(ready ? '/me/enrollments' : null);
  const plan = useApi<TodayPlanDTO>(ready ? '/me/plan/today' : null);
  const setPlan = plan.setData;
  const primary = enrollments.data?.find((e) => e.isPrimary) ?? enrollments.data?.[0] ?? null;
  const familySlug = plan.data?.familySlug ?? primary?.familySlug ?? null;
  const readiness = useApi<ReadinessDTO>(ready && familySlug ? `/me/readiness/${encodeURIComponent(familySlug)}` : null);
  const alerts = useApi<AlertRow[]>(ready ? '/me/alerts?limit=40' : null);
  const notifications = useApi<{ items: NotificationDTO[]; unread: number }>(ready ? '/me/notifications?limit=3' : null);
  const billing = useApi<BillingMe>(ready && !me?.isGuest && !me?.premium.active ? '/billing/me' : null);

  const [busy, setBusy] = useState<number | 'diag' | null>(null);
  const [actionError, setActionError] = useState<Bi | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const pendingChecked = useRef(false);

  useEffect(() => {
    if (notifications.data) setUnread(notifications.data.unread);
  }, [notifications.data, setUnread]);

  const markDone = useCallback(async (index: number) => {
    try {
      const p = await api<TodayPlanDTO>(`/me/plan/today/${index}/done`, { method: 'POST', body: {} });
      setPlan(p);
      void refresh();
    } catch {
      /* the API also detects completed items by itself */
    }
  }, [setPlan, refresh]);

  // Back from an item started from the plan: mark it done when it was actually completed.
  useEffect(() => {
    const p = plan.data;
    if (!p || pendingChecked.current) return;
    pendingChecked.current = true;
    const pending = readPending();
    if (!pending) return;
    writePending(null);
    if (pending.date !== p.date || p.items[pending.index]?.done) return;
    if (pending.kind === 'LESSON') {
      void markDone(pending.index);
      return;
    }
    if (pending.attemptId) {
      api<Record<string, unknown>>(`/attempts/${pending.attemptId}`)
        .then((a) => {
          if ('result' in a) void markDone(pending.index);
        })
        .catch(() => {});
    }
  }, [plan.data, markDone]);

  async function runItem(item: PlanItem, index: number) {
    if (!plan.data) return;
    setActionError(null);
    const date = plan.data.date;
    const slug = plan.data.familySlug ?? familySlug ?? undefined;
    if (item.kind === 'MOCK') {
      writePending({ date, index, kind: 'MOCK' });
      router.push('/app/mock');
      return;
    }
    if (item.kind === 'LESSON') {
      if (!item.topicKey) return;
      writePending({ date, index, kind: 'LESSON' });
      router.push(`/app/lesson/${encodeURIComponent(item.topicKey)}`);
      return;
    }
    setBusy(index);
    const count = Math.min(50, Math.max(5, item.questions ?? 10));
    try {
      const body = item.kind === 'PRACTICE'
        ? { kind: 'PRACTICE', familySlug: slug, ...(item.topicKey ? { topicKey: item.topicKey } : item.domain ? { domain: item.domain } : {}), count }
        : { kind: 'REVIEW', familySlug: slug, count };
      const a = await api<AttemptSessionDTO>('/attempts', { body });
      writePending({ date, index, kind: item.kind, attemptId: a.id });
      router.push(`/app/session/${a.id}`);
    } catch (e) {
      const code = errorCode(e);
      if (code === 'LIMIT_REACHED') {
        setLimitOpen(true);
        track('paywall_view', { from: 'home_plan', reason: 'limit' });
      } else if (code === 'NOTHING_TO_REVIEW') {
        await markDone(index);
        setActionError(errorText(code));
      } else {
        setActionError(errorText(code));
      }
      setBusy(null);
    }
  }

  async function startDiagnostic() {
    if (!primary) return;
    setBusy('diag');
    setActionError(null);
    try {
      const a = await api<AttemptSessionDTO>('/attempts', { body: { kind: 'DIAGNOSTIC', familySlug: primary.familySlug, ...(primary.positionSlug ? { positionSlug: primary.positionSlug } : {}) } });
      track('diagnostic_start', { familySlug: primary.familySlug, from: 'home' });
      router.push(`/app/session/${a.id}`);
    } catch (e) {
      setActionError(errorText(errorCode(e)));
      setBusy(null);
    }
  }

  const activeAlerts = useMemo(() => groupAlerts(alerts.data ?? []).filter((g) => isActiveEdition(g.competition)), [alerts.data]);
  const alertGroups = activeAlerts.slice(0, 3);
  // Registration closing within 3 days for a concours that matches the profile: the most valuable reminder we can show.
  const urgent = activeAlerts.filter((g) => {
    const d = g.competition.status === 'OPEN' ? daysFromToday(g.competition.registrationDeadline) : null;
    return d != null && d >= 0 && d <= 3 && g.best !== 'NOT_ELIGIBLE';
  });

  if (!me || !me.onboarding.hasEnrollment) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const firstName = me.name?.split(/\s+/)[0];
  const daysToExam = plan.data?.daysToExam ?? daysFromToday(primary?.targetExamDate);
  const limit = billing.data?.entitlements.limits.questionsPerDay ?? null;
  const used = billing.data?.usageToday.questions ?? 0;
  const limitReached = limit != null && used >= limit;
  const items = (plan.data?.items ?? []) as PlanItem[];
  const doneCount = items.filter((i) => i.done).length;
  const NextIcon = locale === 'ar' ? ArrowLeft : ArrowRight;

  return (
    <div className="flex flex-col gap-5">
      {emailVerified === '1' && <Alert tone="success" title={tr({ ar: 'تم تأكيد بريدك الإلكتروني', fr: 'E-mail confirmé' })}><span className="inline-flex items-center gap-1"><MailCheck className="size-4" aria-hidden />{tr({ ar: 'ستصلك تنبيهات المناظرات بالبريد أيضًا.', fr: 'Vous recevrez aussi les alertes par e-mail.' })}</span></Alert>}
      {emailVerified === '0' && <Alert tone="warning" title={tr({ ar: 'رابط التأكيد غير صالح أو منتهي', fr: 'Lien de confirmation invalide ou expiré' })}><span className="inline-flex items-center gap-1"><MailWarning className="size-4" aria-hidden /><Link href="/app/profile#alerts" className="underline">{tr({ ar: 'أعد إرسال رابط التأكيد من حسابي', fr: 'Renvoyer le lien depuis mon compte' })}</Link></span></Alert>}

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold">{tr(greeting())}{firstName ? `${locale === 'ar' ? '، ' : ', '}${firstName}` : ''}</h1>
        {primary && (
          <p className="text-sm text-muted">
            {tr({ ar: 'تستعد لـ', fr: 'Vous préparez' })} <Link href={`/concours/${encodeURIComponent(primary.familySlug)}`} className="font-semibold text-text hover:underline">{bi(locale, primary.familyName_ar, primary.familyName_fr)}</Link>
            {primary.positionSlug && <> · {bi(locale, primary.positionTitle_ar, primary.positionTitle_fr)}</>}
          </p>
        )}
      </header>

      {actionError && <Alert tone="warning">{tr(actionError)}</Alert>}

      {urgent.map((g) => {
        const d = daysFromToday(g.competition.registrationDeadline) ?? 0;
        return (
          <div key={g.competition.id} className="flex flex-col gap-2 rounded-2xl border border-danger/40 bg-danger-soft p-4" role="status">
            <p className="flex items-center gap-2 font-bold text-danger">
              <CalendarClock className="size-5 shrink-0" aria-hidden />
              {deadlineText(locale, d)}
            </p>
            <p className="text-sm">
              {editionTitle(locale, g.competition)}
              {g.competition.needsVerification && <> · <span className="text-warning">{tr({ ar: 'تاريخ للتحقق', fr: 'date à vérifier' })}</span></>}
            </p>
            <div className="flex flex-wrap gap-2">
              {officialUrl(g.competition) && (
                <a href={officialUrl(g.competition)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-danger px-3 text-sm font-semibold text-white hover:opacity-90">
                  {tr({ ar: 'سجّل عبر البلاغ الرسمي', fr: 'S’inscrire via l’avis officiel' })}
                </a>
              )}
              <Link href="/app/alerts" className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2">
                {tr({ ar: 'الشروط والوثائق', fr: 'Conditions et pièces' })}
              </Link>
            </div>
          </div>
        );
      })}

      <CountdownCard days={daysToExam ?? null} date={primary?.targetExamDate ?? null} />

      {!me.onboarding.diagnosticDone && (
        <section className="flex flex-col gap-3 rounded-2xl border-2 border-primary bg-primary-soft p-4" aria-labelledby="diag-h">
          <h2 id="diag-h" className="flex items-center gap-2 text-lg font-bold"><Target className="size-5 text-primary" aria-hidden />{tr({ ar: 'ابدأ بالاختبار التشخيصي', fr: 'Commencez par le diagnostic' })}</h2>
          <p className="text-sm">{tr({ ar: 'حوالي 24 سؤالًا لنعرف مستواك في كل مادة ونبني خطة على مقاسك. مجاني.', fr: 'Environ 24 questions pour mesurer votre niveau par matière et bâtir un plan sur mesure. Gratuit.' })}</p>
          <Button onClick={startDiagnostic} loading={busy === 'diag'} className="self-start">{tr({ ar: 'ابدأ الآن', fr: 'Commencer' })}<NextIcon className="size-4" aria-hidden /></Button>
        </section>
      )}

      <section aria-labelledby="plan-h">
        <SectionTitle id="plan-h" action={items.length > 0 && <span className="text-sm font-semibold text-muted tabular-nums">{doneCount}/{items.length}</span>}>
          {tr({ ar: 'مهمة اليوم', fr: 'Mission du jour' })}
        </SectionTitle>
        {plan.loading ? (
          <Skeleton className="h-48" />
        ) : plan.error ? (
          <ErrorState error={plan.error} onRetry={plan.reload} />
        ) : items.length === 0 ? (
          <div className="card p-4 text-sm text-muted">
            {tr({ ar: 'لا توجد مهام لليوم بعد. أنجز الاختبار التشخيصي أو تدرّب بحرية.', fr: 'Pas encore de mission aujourd’hui. Faites le diagnostic ou entraînez-vous librement.' })}
            <div className="mt-3"><ButtonLink href="/app/practice" size="sm" variant="secondary">{tr({ ar: 'تدرّب', fr: 'S’entraîner' })}</ButtonLink></div>
          </div>
        ) : (
          <div className="card flex flex-col gap-3 p-3 sm:p-4">
            <ProgressBar value={(doneCount / items.length) * 100} tone={doneCount === items.length ? 'success' : 'primary'} label={tr({ ar: 'تقدم مهمة اليوم', fr: 'Progression de la mission' })} />
            {doneCount === items.length && (
              <p className="flex items-center gap-2 rounded-xl bg-success-soft p-3 text-sm font-semibold text-success" role="status">
                <PartyPopper className="size-5" aria-hidden />
                {tr({ ar: 'أنجزت مهمة اليوم! حافظ على سلسلتك غدًا.', fr: 'Mission du jour accomplie ! Revenez demain pour garder votre série.' })}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {items.map((item, i) => {
                const k = KIND[item.kind];
                const Icon = k.icon;
                const title = item.kind === 'PRACTICE' || item.kind === 'LESSON' ? bi(locale, item.title_ar ?? item.title, item.title_fr ?? item.title) : tr(k.label);
                const domain = item.domain ? tr(DOMAIN_LABELS[item.domain]) : null;
                return (
                  <li key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runItem(item, i)}
                      disabled={busy != null}
                      className={clsx('flex min-h-14 flex-1 items-center gap-3 rounded-xl p-2 text-start transition hover:bg-surface-2 disabled:opacity-60', item.done && 'opacity-70')}
                    >
                      <span className={clsx('inline-flex size-10 shrink-0 items-center justify-center rounded-full', item.done ? 'bg-success-soft text-success' : k.cls)}>
                        {item.done ? <CircleCheck className="size-5" aria-hidden /> : <Icon className="size-5" aria-hidden />}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={clsx('font-semibold leading-snug', item.done && 'line-through decoration-1')} dir="auto">{title}</span>
                        <span className="text-xs text-muted">
                          {[item.kind === 'PRACTICE' || item.kind === 'LESSON' ? tr(k.label) : domain, item.questions ? countLabel(locale, item.questions, 'question') : null, countLabel(locale, item.minutes, 'minute')].filter(Boolean).join(' · ')}
                        </span>
                        {item.done && <span className="sr-only">{tr({ ar: 'مُنجز', fr: 'Terminé' })}</span>}
                      </span>
                      {busy === i ? <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden /> : <NextIcon className="size-4 shrink-0 text-muted" aria-hidden />}
                    </button>
                    {!item.done && (
                      <button
                        type="button"
                        onClick={() => markDone(i)}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted hover:bg-surface-2 hover:text-success"
                        aria-label={tr({ ar: `تعليم «${title}» كمنجز`, fr: `Marquer « ${title} » comme fait` })}
                      >
                        <Check className="size-5" aria-hidden />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {limitReached && <UpsellCard reason="limit" />}

      <ReadinessCard data={readiness.data} loading={readiness.loading} error={readiness.error} onRetry={readiness.reload} />

      <section aria-labelledby="alerts-h">
        <SectionTitle id="alerts-h" action={<Link href="/app/alerts" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">{tr({ ar: 'الكل', fr: 'Tout voir' })}</Link>}>
          <span className="inline-flex items-center gap-2"><Radar className="size-5 text-primary" aria-hidden />{tr({ ar: 'مناظرات تناسب ملفك', fr: 'Concours pour votre profil' })}</span>
        </SectionTitle>
        {alerts.loading ? (
          <Skeleton className="h-28" />
        ) : alertGroups.length === 0 ? (
          <div className="card flex flex-col gap-2 p-4 text-sm">
            <p className="text-muted">{tr({ ar: 'لا توجد مناظرة مفتوحة تناسب ملفك الآن. سننبهك فور نشر واحدة.', fr: 'Aucun concours ouvert ne correspond à votre profil pour l’instant. Vous serez alerté dès qu’il y en aura un.' })}</p>
            {!me.onboarding.hasProfile && (
              <Link href="/app/profile#eligibility" className="font-semibold text-primary hover:underline">{tr({ ar: 'أكمل ملفك لتنبيهات أدق', fr: 'Complétez votre profil pour des alertes précises' })}</Link>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">{alertGroups.map((g) => <AlertRowCompact key={g.competition.id} group={g} />)}</ul>
        )}
      </section>

      {notifications.data && notifications.data.items.length > 0 && (
        <section aria-labelledby="notif-h">
          <SectionTitle id="notif-h" action={<Link href="/app/notifications" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">{tr({ ar: 'الكل', fr: 'Tout voir' })}</Link>}>
            {tr({ ar: 'آخر الإشعارات', fr: 'Dernières notifications' })}
          </SectionTitle>
          <ul className="card divide-y divide-border p-1">
            {notifications.data.items.map((n) => (
              <li key={n.id}>
                <NotificationRow
                  n={n}
                  compact
                  onOpen={(x) => {
                    if (x.readAt) return;
                    setUnread((u) => u - 1);
                    api(`/me/notifications/${x.id}/read`, { method: 'POST', body: {} }).catch(() => {});
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav aria-label={tr({ ar: 'روابط سريعة', fr: 'Accès rapides' })} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QuickLink href="/app/practice" icon={Dumbbell} label={{ ar: 'تدرّب', fr: 'S’entraîner' }} />
        <QuickLink href="/app/mock" icon={ClipboardCheck} label={{ ar: 'امتحان تجريبي', fr: 'Examen blanc' }} />
        <QuickLink href="/app/progress" icon={TrendingUp} label={{ ar: 'تقدمي', fr: 'Mes progrès' }} />
        <QuickLink href="/app/offline" icon={HardDriveDownload} label={{ ar: 'دون اتصال', fr: 'Hors ligne' }} />
      </nav>

      {!me.premium.active && !me.isGuest && !limitReached && billing.data && <UpsellCard />}

      <Modal open={limitOpen} onClose={() => setLimitOpen(false)} title={tr({ ar: 'الحد اليومي المجاني', fr: 'Limite gratuite du jour' })}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{tr({ ar: 'عُد غدًا لمواصلة التدرب مجانًا، أو اشترك لمواصلة الآن دون حدود. المراجعة والدروس تبقى متاحة.', fr: 'Revenez demain pour continuer gratuitement, ou passez Premium pour continuer maintenant sans limite. Les leçons restent accessibles.' })}</p>
          <UpsellCard reason="limit" guest={me.isGuest} />
        </div>
      </Modal>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: Icon; label: Bi }) {
  const tr = useT();
  return (
    <Link href={href} className="card flex min-h-20 flex-col items-center justify-center gap-1.5 p-3 text-center text-sm font-semibold hover:bg-surface-2">
      <Icon className="size-6 text-primary" aria-hidden />
      {tr(label)}
    </Link>
  );
}

function CountdownCard({ days, date }: { days: number | null; date: string | null }) {
  const tr = useT();
  const { locale } = useLocale();
  if (days == null || days < 0) {
    return (
      <div className="card flex items-center gap-3 p-4">
        <CalendarClock className="size-8 shrink-0 text-muted" aria-hidden />
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="font-semibold">{tr({ ar: 'تاريخ الامتحان لم يُحدد بعد', fr: 'Date d’examen pas encore fixée' })}</p>
          <p className="text-muted">{tr({ ar: 'سننبهك عند الإعلان عنه. يمكنك تحديد تاريخ مستهدف من حسابي.', fr: 'Nous vous préviendrons dès l’annonce. Vous pouvez fixer une date cible dans votre compte.' })}</p>
        </div>
      </div>
    );
  }
  const urgent = days <= 21;
  // The plan's countdown may come from the next announced edition when no target date was set.
  const shownDate = date ?? (() => {
    const d = new Date(`${tunisToday()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  })();
  return (
    <div className={clsx('flex items-center gap-4 rounded-2xl p-4', urgent ? 'bg-accent-soft' : 'bg-primary-soft')}>
      <div className={clsx('flex size-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-surface', urgent ? 'text-accent' : 'text-primary')}>
        <span className="text-3xl font-extrabold leading-none tabular-nums">{days}</span>
        <span className="text-xs font-semibold">{locale === 'ar' ? (days === 1 ? 'يوم' : days === 2 ? 'يومان' : days % 100 >= 3 && days % 100 <= 10 ? 'أيام' : 'يومًا') : days === 1 ? 'jour' : 'jours'}</span>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-bold">{days === 0 ? tr({ ar: 'الامتحان اليوم — بالتوفيق!', fr: 'C’est le jour J — bonne chance !' }) : tr({ ar: 'قبل الامتحان', fr: 'avant l’examen' })}</p>
        <p className="text-muted">{formatDate(locale, shownDate)}</p>
        {urgent && days > 0 && <p className="text-muted">{tr({ ar: 'المرحلة الأخيرة: امتحانات تجريبية ومراجعة الأخطاء.', fr: 'Dernière ligne droite : examens blancs et révision des erreurs.' })}</p>}
      </div>
    </div>
  );
}

function ReadinessCard({ data, loading, error, onRetry }: { data?: ReadinessDTO; loading: boolean; error: unknown; onRetry: () => void }) {
  const tr = useT();
  const { locale } = useLocale();
  if (loading) return <Skeleton className="h-40" />;
  // No blueprint / syllabus yet for this concours: nothing meaningful to show.
  if (error && errorCode(error) === 'NOT_FOUND') return null;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!data) return null;
  const label = READINESS_TEXT[data.label];
  const titles = data.topicTitles as Record<string, { ar: string; fr: string; key?: string }>;
  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby="ready-h">
      <div className="flex items-start justify-between gap-2">
        <h2 id="ready-h" className="text-lg font-bold">{tr({ ar: 'مستوى تحضيرك', fr: 'Votre préparation' })}</h2>
        <Badge tone={label.tone}>{tr(label)}</Badge>
      </div>
      <div className="flex items-end gap-3">
        <span className="text-4xl font-extrabold tabular-nums">{data.preparation}%</span>
        <span className="pb-1 text-sm text-muted">{tr({ ar: `تغطية البرنامج ${data.coverage}%`, fr: `Couverture du programme ${data.coverage} %` })}</span>
      </div>
      <ProgressBar value={data.preparation} tone={scoreTone(data.preparation)} label={tr({ ar: 'مستوى التحضير', fr: 'Niveau de préparation' })} />
      {data.priorities.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold">{tr({ ar: 'أولوياتك الآن', fr: 'Vos priorités' })}</p>
          <ol className="flex flex-col gap-1">
            {data.priorities.slice(0, 3).map((p, i) => {
              const t = p.topicId ? titles[p.topicId] : undefined;
              const name = t ? bi(locale, t.ar, t.fr) : tr(DOMAIN_LABELS[p.domain]);
              const href = t?.key ? `/app/lesson/${encodeURIComponent(t.key)}` : '/app/practice';
              return (
                <li key={`${p.domain}-${p.topicId ?? i}`}>
                  <Link href={href} className="flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm hover:bg-surface-2">
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span>
                    <span className="flex-1" dir="auto">{name}</span>
                    <span className="text-xs text-muted">{tr(DOMAIN_LABELS[p.domain])}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="text-xs text-muted">{locale === 'fr' ? data.disclaimer.fr : data.disclaimer.ar}</p>
      <Link href="/app/progress" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-primary hover:underline">
        <TrendingUp className="size-4" aria-hidden />
        {tr({ ar: 'تفاصيل تقدمي', fr: 'Détail de mes progrès' })}
      </Link>
    </section>
  );
}

'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlarmClock, BatteryCharging, ClipboardCheck, Crown, EyeOff, History, Info, PlayCircle, Send, Timer, VolumeX } from 'lucide-react';
import type { FamilyDetailDTO, PositionDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, Modal, Select, scoreTone } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { ErrorState, PageHeader, SectionTitle, Skeleton } from '@/components/app/bits';
import { bi } from '@/components/app/format';
import { formatDate } from '@/lib/i18n';
import { Sparkline } from '../charts';
import { useEnrollments, useSessionApi, useStartAttempt } from '../hooks';
import { biCount, clock, FIDELITY_TEXT, nOf } from '../labels';
import { PaywallModal } from '../paywall';
import type { AttemptHistoryItem } from '../types';

/** Synthesised mocks (no published blueprint) are ~1 question per minute over the family's domains. */
const SYNTH_SIZE = 40;

export function MockScreen() {
  const tr = useT();
  const { locale } = useLocale();
  const { me } = useSession();
  const enr = useEnrollments();
  const [picked, setPicked] = useState<string | null>(null);
  const slug = picked ?? enr.primary?.familySlug ?? null;
  const enrollment = enr.list?.find((e) => e.familySlug === slug) ?? null;
  const family = useSessionApi<FamilyDetailDTO>(slug ? `/catalog/families/${encodeURIComponent(slug)}` : null);
  const history = useSessionApi<AttemptHistoryItem[]>('/attempts?kind=MOCK&limit=30');
  const start = useStartAttempt('mock');
  const [rulesFor, setRulesFor] = useState<PositionDTO | null>(null);

  const now = Date.now();
  const inProgress = (history.data ?? []).find((h) => !h.submittedAt && h.familySlug === slug && (!h.expiresAt || Date.parse(h.expiresAt) > now));
  const done = useMemo(() => (history.data ?? []).filter((h) => h.submittedAt), [history.data]);
  const usedFree = !me?.premium.active && done.length > 0;
  const positions = useMemo(() => {
    const list = family.data?.positions ?? [];
    // The candidate's own position first.
    return [...list].sort((a, b) => Number(b.slug === enrollment?.positionSlug) - Number(a.slug === enrollment?.positionSlug));
  }, [family.data, enrollment?.positionSlug]);

  if (enr.data && !enr.primary) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={tr({ ar: 'الامتحانات التجريبية', fr: 'Examens blancs' })} />
        <EmptyState
          icon={<ClipboardCheck className="size-8" aria-hidden />}
          title={tr({ ar: 'اختر مناظرتك أولًا', fr: 'Choisissez d’abord votre concours' })}
          body={tr({ ar: 'نبني الامتحان التجريبي على صيغة المناظرة التي تستعد لها.', fr: 'L’examen blanc reprend le format du concours que vous préparez.' })}
          action={<ButtonLink href="/app/onboarding">{tr({ ar: 'اختيار المناظرة', fr: 'Choisir le concours' })}</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tr({ ar: 'الامتحانات التجريبية', fr: 'Examens blancs' })}
        subtitle={tr({ ar: 'محاكاة حقيقية: نفس عدد الأسئلة ونفس التوقيت، دون تصحيح حتى النهاية.', fr: 'Simulation réelle : même nombre de questions, même durée, corrigé à la fin.' })}
      />

      {enr.list && enr.list.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mock-family" className="text-sm font-semibold">{tr({ ar: 'المناظرة', fr: 'Concours' })}</label>
          <Select id="mock-family" value={slug ?? ''} onChange={(e) => setPicked(e.target.value)}>
            {enr.list.map((e) => <option key={e.id} value={e.familySlug}>{bi(locale, e.familyName_ar, e.familyName_fr)}</option>)}
          </Select>
        </div>
      )}

      {inProgress && (
        <Card className="flex flex-col gap-2 border-warning/50 bg-warning-soft">
          <p className="flex items-center gap-2 font-bold text-warning"><AlarmClock className="size-5" aria-hidden />{tr({ ar: 'لديك امتحان تجريبي جارٍ', fr: 'Un examen blanc est en cours' })}</p>
          {inProgress.expiresAt && (
            <p className="text-sm">{tr({ ar: `الوقت يمرّ: ينتهي بعد ${clock(Math.max(0, (Date.parse(inProgress.expiresAt) - now) / 1000))}.`, fr: `Le chrono tourne : fin dans ${clock(Math.max(0, (Date.parse(inProgress.expiresAt) - now) / 1000))}.` })}</p>
          )}
          <ButtonLink href={`/app/session/${inProgress.id}`} className="self-start"><PlayCircle className="size-4" aria-hidden />{tr({ ar: 'واصل الامتحان', fr: 'Reprendre' })}</ButtonLink>
        </Card>
      )}

      {usedFree && (
        <Alert tone="info" title={tr({ ar: 'استعملت امتحانك التجريبي المجاني', fr: 'Examen blanc gratuit utilisé' })}>
          <span className="flex flex-wrap items-center gap-2">
            {tr({ ar: 'مع بريميوم: امتحانات تجريبية غير محدودة لقياس تقدمك قبل يوم المناظرة.', fr: 'Avec Premium : examens blancs illimités pour mesurer vos progrès avant le jour J.' })}
            <Link href={me?.isGuest ? '/register?next=/app/billing' : '/app/billing'} className="inline-flex items-center gap-1 font-semibold underline"><Crown className="size-4" aria-hidden />{tr({ ar: 'العروض', fr: 'Les offres' })}</Link>
          </span>
        </Alert>
      )}
      {!me?.premium.active && !usedFree && (
        <p className="text-sm text-muted">{tr({ ar: 'الحساب المجاني يشمل امتحانًا تجريبيًا واحدًا كاملًا.', fr: 'Le compte gratuit inclut un examen blanc complet.' })}</p>
      )}

      <section aria-labelledby="positions" className="flex flex-col gap-3">
        <SectionTitle id="positions">{tr({ ar: 'اختر الرتبة', fr: 'Choisissez le grade' })}</SectionTitle>
        {family.error ? (
          <ErrorState error={family.error} onRetry={() => void family.reload()} />
        ) : !family.data ? (
          <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        ) : positions.length === 0 ? (
          <EmptyState title={tr({ ar: 'لا توجد رتب منشورة لهذه المناظرة بعد', fr: 'Aucun grade publié pour ce concours' })} />
        ) : (
          <ul className="flex flex-col gap-3">
            {positions.map((p) => {
              const bp = p.blueprint;
              const fidelity = bp?.fidelity ?? 'APPROXIMATED';
              const total = bp ? bp.sections.reduce((a, s) => a + s.count, 0) : SYNTH_SIZE;
              const mine = p.slug === enrollment?.positionSlug;
              return (
                <li key={p.slug}>
                  <Card className={clsx('flex flex-col gap-3', mine && 'border-primary')}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <h3 className="font-bold">{bi(locale, p.title_ar, p.title_fr)}</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {mine && <Badge tone="primary">{tr({ ar: 'رتبتي', fr: 'Mon grade' })}</Badge>}
                          <Badge tone={FIDELITY_TEXT[fidelity].tone} title={tr(FIDELITY_TEXT[fidelity].hint)}>{tr(FIDELITY_TEXT[fidelity])}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-3 text-sm tabular-nums">
                        <span className="flex items-center gap-1"><ClipboardCheck className="size-4 text-muted" aria-hidden />{tr(biCount(total, 'question'))}</span>
                        <span className="flex items-center gap-1"><Timer className="size-4 text-muted" aria-hidden />{bp ? tr(biCount(bp.totalMinutes, 'minute')) : tr({ ar: '≈ 40 دقيقة', fr: '≈ 40 min' })}</span>
                      </div>
                    </div>
                    {bp && bp.sections.length > 0 ? (
                      <ol className="flex flex-col gap-1 rounded-xl bg-surface-2 p-3 text-sm">
                        {bp.sections.map((s, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span>{i + 1}. {tr(DOMAIN_LABELS[s.domain])}</span>
                            <span className="text-muted tabular-nums">{tr(biCount(s.count, 'question'))}{s.minutes ? ` · ${tr(biCount(s.minutes, 'minute'))}` : ''}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="flex items-start gap-2 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{tr({ ar: 'الصيغة الرسمية غير منشورة: نبني امتحانًا تقريبيًا من مواد المناظرة.', fr: 'Format officiel non publié : examen approximatif construit sur les matières du concours.' })}</p>
                    )}
                    {fidelity === 'APPROXIMATED' && bp && <p className="text-xs text-muted">{tr(FIDELITY_TEXT.APPROXIMATED.hint)}</p>}
                    <Button onClick={() => setRulesFor(p)} variant={mine ? 'primary' : 'secondary'} className="self-start" disabled={!!inProgress}>
                      <PlayCircle className="size-4" aria-hidden />{tr({ ar: 'ابدأ الامتحان التجريبي', fr: 'Commencer l’examen blanc' })}
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
        {start.error && <Alert tone="danger">{tr(start.error)}</Alert>}
      </section>

      <section aria-labelledby="mock-history" className="flex flex-col gap-3">
        <SectionTitle id="mock-history">{tr({ ar: 'امتحاناتي السابقة', fr: 'Mes examens passés' })}</SectionTitle>
        {history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.reload()} />
        ) : !history.data ? (
          <Skeleton className="h-24" />
        ) : done.length === 0 ? (
          <EmptyState icon={<History className="size-8" aria-hidden />} title={tr({ ar: 'لم تُجرِ أي امتحان تجريبي بعد', fr: 'Aucun examen blanc pour l’instant' })} body={tr({ ar: 'امتحانان تجريبيان على الأقل ضروريان لتقدير جاهزيتك بدقة.', fr: 'Au moins deux examens blancs sont nécessaires pour estimer votre préparation.' })} />
        ) : (
          <Card className="flex flex-col gap-3">
            {done.length > 1 && (
              <Sparkline values={[...done].reverse().map((h) => h.score ?? 0)} min={0} max={100} label={tr({ ar: 'تطور نتائج الامتحانات التجريبية', fr: 'Évolution des scores aux examens blancs' })} />
            )}
            <ul className="flex flex-col divide-y divide-border">
              {done.map((h) => {
                const s = h.score ?? 0;
                const tone = scoreTone(s);
                return (
                  <li key={h.id}>
                    <Link href={`/app/results/${h.id}${h.familySlug ? `?family=${encodeURIComponent(h.familySlug)}` : ''}`} className="flex min-h-14 items-center gap-3 py-2 hover:bg-surface-2">
                      <span className={clsx('inline-flex h-10 w-14 items-center justify-center rounded-xl text-sm font-extrabold tabular-nums', tone === 'success' ? 'bg-success-soft text-success' : tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')} dir="ltr">{s}%</span>
                      <span className="flex flex-1 flex-col">
                        <span className="text-sm font-semibold">{formatDate(locale, h.submittedAt, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                        <span className="text-xs text-muted tabular-nums">{h.correctCount != null ? tr({ ar: `${h.correctCount} صحيحة من ${h.total}`, fr: `${h.correctCount} justes sur ${h.total}` }) : tr(biCount(h.total, 'question'))}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      <Modal open={!!rulesFor} onClose={() => setRulesFor(null)} title={tr({ ar: 'محاكاة حقيقية', fr: 'Simulation réelle' })}>
        {rulesFor && (
          <div className="flex flex-col gap-4">
            <p className="font-semibold">{bi(locale, rulesFor.title_ar, rulesFor.title_fr)}</p>
            <ul className="flex flex-col gap-2.5 text-sm">
              <li className="flex items-start gap-2"><ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{tr({ ar: `نفس عدد الأسئلة وتوزيعها على المواد (${nOf('ar', rulesFor.blueprint ? rulesFor.blueprint.sections.reduce((a, s) => a + s.count, 0) : SYNTH_SIZE, 'question')}).`, fr: `Même nombre de questions et même répartition (${rulesFor.blueprint ? rulesFor.blueprint.sections.reduce((a, s) => a + s.count, 0) : SYNTH_SIZE} questions).` })}</li>
              <li className="flex items-start gap-2"><Timer className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{tr({ ar: `نفس التوقيت: ${nOf('ar', rulesFor.blueprint?.totalMinutes ?? SYNTH_SIZE, 'minute')}، ويستمر العدّاد حتى لو أغلقت الصفحة.`, fr: `Même durée : ${rulesFor.blueprint?.totalMinutes ?? SYNTH_SIZE} min ; le chrono continue même si vous fermez la page.` })}</li>
              <li className="flex items-start gap-2"><EyeOff className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{tr({ ar: 'لا تصحيح ولا شرح حتى النهاية.', fr: 'Aucun corrigé ni explication avant la fin.' })}</li>
              <li className="flex items-start gap-2"><Send className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{tr({ ar: 'تُسلَّم إجاباتك تلقائيًا عند انتهاء الوقت.', fr: 'Vos réponses sont rendues automatiquement à la fin du temps.' })}</li>
              <li className="flex items-start gap-2"><VolumeX className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{tr({ ar: 'اختر مكانًا هادئًا وجهّز ورقة وقلمًا للحساب.', fr: 'Installez-vous au calme avec papier et crayon.' })}</li>
              <li className="flex items-start gap-2"><BatteryCharging className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{tr({ ar: 'تأكد من شحن هاتفك. إن انقطع الاتصال تُحفظ إجاباتك وتُرسل لاحقًا.', fr: 'Vérifiez votre batterie. En cas de coupure, vos réponses sont gardées et envoyées ensuite.' })}</li>
            </ul>
            {!me?.premium.active && !usedFree && <Alert tone="info">{tr({ ar: 'هذا امتحانك التجريبي المجاني.', fr: 'Ceci est votre examen blanc gratuit.' })}</Alert>}
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                size="lg"
                className="sm:flex-1"
                loading={start.busy === rulesFor.slug}
                onClick={() => slug && void start.start({ kind: 'MOCK', familySlug: slug, positionSlug: rulesFor.slug }, rulesFor.slug).then((ok) => { if (!ok) setRulesFor(null); })}
              >
                <PlayCircle className="size-5" aria-hidden />{tr({ ar: 'أنا جاهز، ابدأ', fr: 'Je suis prêt, commencer' })}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => setRulesFor(null)}>{tr({ ar: 'ليس الآن', fr: 'Pas maintenant' })}</Button>
            </div>
          </div>
        )}
      </Modal>

      <PaywallModal reason={start.paywall} onClose={start.closePaywall} from="mock" />
    </div>
  );
}

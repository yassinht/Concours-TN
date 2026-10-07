'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { Award, BookOpen, CalendarDays, Dumbbell, Flame, Lock, ShieldCheck, Star, Target, Trophy, Zap } from 'lucide-react';
import type { GamificationDTO, ReadinessDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { BADGES } from '@ctn/shared/dist/learning';
import { Badge, Button, ButtonLink, Card, EmptyState, ProgressBar, Stat } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { ErrorState, PageHeader, SectionTitle, Skeleton } from '@/components/app/bits';
import { bi } from '@/components/app/format';
import { formatDate, type Bi } from '@/lib/i18n';
import { ActivityBars, DomainBars, MasteryMeter, ScoreRing, Sparkline } from '../charts';
import { useEnrollments, useSessionApi, useStartAttempt } from '../hooks';
import { biCount, nOf, pct, readinessText } from '../labels';
import { PaywallModal } from '../paywall';
import type { EnrollmentRow, ProgressView } from '../types';

const BADGE_HINTS: Record<string, Bi> = {
  FIRST_STEP: { ar: 'أكمل الاختبار التشخيصي', fr: 'Terminer le test diagnostique' },
  STREAK_7: { ar: '7 أيام تدرب متتالية', fr: '7 jours d’affilée' },
  STREAK_30: { ar: '30 يومًا متتالية', fr: '30 jours d’affilée' },
  Q_100: { ar: 'أجب عن 100 سؤال', fr: 'Répondre à 100 questions' },
  Q_1000: { ar: 'أجب عن 1000 سؤال', fr: 'Répondre à 1000 questions' },
  FIRST_MOCK: { ar: 'أنهِ امتحانًا تجريبيًا', fr: 'Terminer un examen blanc' },
  MOCK_80: { ar: '80% أو أكثر في امتحان تجريبي', fr: '80 % ou plus à un examen blanc' },
  MISTAKE_HUNTER: { ar: 'صحّح 50 خطأ سابقًا', fr: 'Corriger 50 erreurs passées' },
};

/** /app/progress: readiness per concours, practice statistics and gamification. */
export function ProgressScreen() {
  const tr = useT();
  const enr = useEnrollments();
  const progress = useSessionApi<ProgressView>('/me/progress');
  const game = useSessionApi<GamificationDTO>('/me/gamification');
  const start = useStartAttempt('progress');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr({ ar: 'تقدمي', fr: 'Ma progression' })}
        actions={<ButtonLink href="/app/leaderboard" variant="secondary" size="sm" className="min-h-11"><Trophy className="size-4" aria-hidden />{tr({ ar: 'الترتيب', fr: 'Classement' })}</ButtonLink>}
      />

      <section aria-labelledby="readiness" className="flex flex-col gap-3">
        <SectionTitle id="readiness">{tr({ ar: 'مستوى التحضير', fr: 'Niveau de préparation' })}</SectionTitle>
        {enr.error ? <ErrorState error={enr.error} onRetry={() => void enr.reload()} />
          : !enr.list ? <Skeleton className="h-64" />
            : enr.list.length === 0 ? (
              <EmptyState
                icon={<Target className="size-8" aria-hidden />}
                title={tr({ ar: 'اختر مناظرتك لنقيس جاهزيتك', fr: 'Choisissez votre concours pour mesurer votre préparation' })}
                action={<ButtonLink href="/app/onboarding">{tr({ ar: 'اختيار المناظرة', fr: 'Choisir le concours' })}</ButtonLink>}
              />
            ) : enr.list.map((e) => (
              <ReadinessCard key={e.id} e={e} onPractice={(input, key) => void start.start(input, key)} busy={start.busy} />
            ))}
        {start.error && <p className="text-sm text-danger" role="alert">{tr(start.error)}</p>}
      </section>

      <section aria-labelledby="stats" className="flex flex-col gap-3">
        <SectionTitle id="stats">{tr({ ar: 'نشاطي', fr: 'Mon activité' })}</SectionTitle>
        {progress.error ? <ErrorState error={progress.error} onRetry={() => void progress.reload()} />
          : !progress.data ? <Skeleton className="h-48" />
            : <Activity p={progress.data} onPractice={(topicKey) => void start.start({ kind: 'PRACTICE', topicKey, count: 10, ...(enr.primary ? { familySlug: enr.primary.familySlug } : {}) }, topicKey)} busy={start.busy} />}
      </section>

      <section aria-labelledby="game" className="flex flex-col gap-3">
        <SectionTitle id="game">{tr({ ar: 'المستوى والشارات', fr: 'Niveau et badges' })}</SectionTitle>
        {game.error ? <ErrorState error={game.error} onRetry={() => void game.reload()} />
          : !game.data ? <Skeleton className="h-48" />
            : <Gamification g={game.data} />}
      </section>

      <PaywallModal reason={start.paywall} onClose={start.closePaywall} from="progress" />
    </div>
  );
}

type StartFn = (input: Parameters<ReturnType<typeof useStartAttempt>['start']>[0], key: string) => void;

function ReadinessCard({ e, onPractice, busy }: { e: EnrollmentRow; onPractice: StartFn; busy: string | null }) {
  const tr = useT();
  const { locale } = useLocale();
  const r = useSessionApi<ReadinessDTO>(`/me/readiness/${encodeURIComponent(e.familySlug)}`);
  const name = bi(locale, e.familyName_ar, e.familyName_fr);
  if (r.error) return <ErrorState error={r.error} onRetry={() => void r.reload()} />;
  if (!r.data) return <Skeleton className="h-64" />;
  const d = r.data;
  const label = readinessText(d.label);
  const titles = d.topicTitles as Record<string, { ar: string; fr: string; key?: string }>;
  return (
    <Card as="article" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="me-auto text-lg font-bold">{name}</h3>
        {e.isPrimary && <Badge tone="primary">{tr({ ar: 'المناظرة الرئيسية', fr: 'Concours principal' })}</Badge>}
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <ScoreRing value={d.preparation} size={120} label={tr({ ar: 'التحضير', fr: 'Préparation' })} tone={label.tone} sub={tr({ ar: 'التحضير', fr: 'Préparation' })} />
        <div className="flex w-full flex-1 flex-col gap-2">
          <Badge tone={label.tone} className="self-center text-sm sm:self-start">{tr(label)}</Badge>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={tr({ ar: 'المستوى العام', fr: 'Niveau global' })} value={<span dir="ltr">{d.overall}%</span>} />
            <Stat label={tr({ ar: 'تغطية البرنامج', fr: 'Couverture' })} value={<span dir="ltr">{d.coverage}%</span>} />
          </div>
          {d.history.length >= 2 && (
            <div>
              <p className="text-xs text-muted">{tr({ ar: 'تطور التحضير (آخر 30 يومًا)', fr: 'Évolution (30 derniers jours)' })}</p>
              <Sparkline values={d.history.map((h) => h.preparation)} min={0} max={100} label={tr({ ar: `تطور التحضير من ${d.history[0].preparation}% إلى ${d.history[d.history.length - 1].preparation}%`, fr: `Préparation passée de ${d.history[0].preparation} % à ${d.history[d.history.length - 1].preparation} %` })} />
            </div>
          )}
        </div>
      </div>

      {d.byDomain.length > 0 && (
        <DomainBars rows={d.byDomain.map((x) => ({ domain: x.domain, score: x.score, detail: <span>{tr({ ar: `تغطية ${x.coverage}% ·`, fr: `couv. ${x.coverage} % ·` })}</span> }))} />
      )}

      {d.priorities.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl bg-primary-soft/60 p-3">
          <h4 className="font-bold">{tr({ ar: 'أهم ما تراجعه خلال الأيام القادمة', fr: 'À réviser en priorité ces prochains jours' })}</h4>
          <ol className="flex flex-col gap-2">
            {d.priorities.map((p, i) => {
              const t = p.topicId ? titles[p.topicId] : undefined;
              const key = `${e.familySlug}:${p.topicId ?? p.domain}`;
              return (
                <li key={key} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-2.5">
                  <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-contrast" aria-hidden>{i + 1}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{t ? bi(locale, t.ar, t.fr) : tr(DOMAIN_LABELS[p.domain])}</span>
                    <span className="text-xs text-muted">{tr(DOMAIN_LABELS[p.domain])} · {tr({ ar: `مكسب محتمل +${Math.max(1, Math.round(p.gain * 100))} نقطة`, fr: `gain potentiel +${Math.max(1, Math.round(p.gain * 100))} pts` })}</span>
                  </span>
                  {t?.key && (
                    <Link href={`/app/lesson/${encodeURIComponent(t.key)}`} className="inline-flex size-11 items-center justify-center rounded-xl text-primary hover:bg-primary-soft" aria-label={tr({ ar: 'الدرس', fr: 'Leçon' })}>
                      <BookOpen className="size-5" aria-hidden />
                    </Link>
                  )}
                  <Button
                    size="sm"
                    className="min-h-11"
                    loading={busy === key}
                    onClick={() => onPractice({ kind: 'PRACTICE', familySlug: e.familySlug, count: 10, ...(t?.key ? { topicKey: t.key } : { domain: p.domain }) }, key)}
                  >
                    <Dumbbell className="size-4" aria-hidden />{tr({ ar: 'تدرّب', fr: 'S’entraîner' })}
                  </Button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {d.reasons.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
          {d.reasons.map((x, i) => <li key={i}>{tr(x)}</li>)}
        </ul>
      )}
      <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />{tr(d.disclaimer)}</p>
    </Card>
  );
}

function Activity({ p, onPractice, busy }: { p: ProgressView; onPractice: (topicKey: string) => void; busy: string | null }) {
  const tr = useT();
  const { locale } = useLocale();
  const [all, setAll] = useState(false);
  const active = p.last30d.filter((d) => d.answered > 0).length;
  const answered30 = p.last30d.reduce((a, d) => a + d.answered, 0);
  const mastery = all ? p.mastery : p.mastery.slice(0, 8);
  if (p.totals.answered === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="size-8" aria-hidden />}
        title={tr({ ar: 'لا نشاط بعد', fr: 'Pas encore d’activité' })}
        body={tr({ ar: 'أجب عن بعض الأسئلة لتظهر إحصائياتك هنا.', fr: 'Répondez à quelques questions pour voir vos statistiques.' })}
        action={<ButtonLink href="/app/practice">{tr({ ar: 'ابدأ التدرب', fr: 'Commencer' })}</ButtonLink>}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={tr({ ar: 'أسئلة مُجابة', fr: 'Questions' })} value={p.totals.answered.toLocaleString(locale === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-FR')} />
        <Stat label={tr({ ar: 'إجابات صحيحة', fr: 'Bonnes réponses' })} value={p.totals.correct.toLocaleString(locale === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-FR')} />
        <Stat label={tr({ ar: 'الدقة', fr: 'Précision' })} value={<span dir="ltr">{pct(p.totals.accuracy)}%</span>} />
        <Stat label={tr({ ar: 'أيام التدرب', fr: 'Jours d’étude' })} value={p.totals.studyDays} />
      </div>
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold">{tr({ ar: 'آخر 30 يومًا', fr: '30 derniers jours' })}</h3>
          <span className="text-xs text-muted">{tr({ ar: `${nOf('ar', answered30, 'question')} في ${nOf('ar', active, 'day')} نشاط`, fr: `${nOf('fr', answered30, 'question')} sur ${nOf('fr', active, 'day')} d’activité` })}</span>
        </div>
        <ActivityBars days={p.last30d} label={tr({ ar: `نشاط آخر 30 يومًا: ${nOf('ar', answered30, 'question')}`, fr: `Activité des 30 derniers jours : ${nOf('fr', answered30, 'question')}` })} />
        <p className="flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm bg-primary" aria-hidden />{tr({ ar: 'صحيحة', fr: 'Correctes' })}</span>
          <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm bg-primary-soft" aria-hidden />{tr({ ar: 'خاطئة', fr: 'Fausses' })}</span>
        </p>
      </Card>
      {p.byDomain.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">{tr({ ar: 'الدقة حسب المادة', fr: 'Précision par matière' })}</h3>
          <DomainBars rows={p.byDomain.map((d) => ({ domain: d.domain, score: pct(d.accuracy), detail: <span>{tr(biCount(d.answered, 'question'))} ·</span> }))} />
        </Card>
      )}
      {p.mastery.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">{tr({ ar: 'التمكن حسب المحور (الأضعف أولًا)', fr: 'Maîtrise par thème (les plus fragiles d’abord)' })}</h3>
          <ul className="flex flex-col divide-y divide-border">
            {mastery.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-2 py-2">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold">{bi(locale, m.title_ar, m.title_fr)}</span>
                  <span className="text-xs text-muted">{tr(DOMAIN_LABELS[m.domain])} · {tr(biCount(m.attempts, 'attempt'))}</span>
                  <MasteryMeter mastery={m.mastery} />
                </span>
                <Button size="sm" variant="secondary" className="min-h-11" loading={busy === m.key} onClick={() => onPractice(m.key)}>
                  <Dumbbell className="size-4" aria-hidden />{tr({ ar: 'تدرّب', fr: 'S’entraîner' })}
                </Button>
              </li>
            ))}
          </ul>
          {p.mastery.length > 8 && (
            <Button variant="ghost" onClick={() => setAll(!all)} className="self-start">
              {all ? tr({ ar: 'عرض أقل', fr: 'Voir moins' }) : tr({ ar: `عرض الكل (${p.mastery.length})`, fr: `Tout voir (${p.mastery.length})` })}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

function Gamification({ g }: { g: GamificationDTO }) {
  const tr = useT();
  const { locale } = useLocale();
  const earned = new Map(g.badges.map((b) => [b.code, b.awardedAt]));
  const goalPct = Math.min(100, (g.todayXp / Math.max(1, g.dailyGoalXp)) * 100);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-sm text-muted"><Star className="size-4 text-warning" aria-hidden />{tr({ ar: 'المستوى', fr: 'Niveau' })}</span>
          <span className="text-3xl font-extrabold tabular-nums">{g.level}</span>
          <ProgressBar value={(g.levelProgress.current / Math.max(1, g.levelProgress.next)) * 100} tone="accent" label={tr({ ar: 'التقدم نحو المستوى التالي', fr: 'Vers le niveau suivant' })} />
          <span className="text-xs text-muted tabular-nums" dir="ltr">{g.levelProgress.current}/{g.levelProgress.next} XP · {g.xp} XP</span>
        </Card>
        <Card className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-sm text-muted"><Flame className={clsx('size-4', g.streak.current > 0 ? 'text-accent' : 'text-muted')} aria-hidden />{tr({ ar: 'السلسلة', fr: 'Série' })}</span>
          <span className="text-3xl font-extrabold tabular-nums">{g.streak.current} <span className="text-base font-semibold text-muted">{tr({ ar: 'يوم', fr: 'j' })}</span></span>
          <span className="text-xs text-muted">{tr({ ar: `أطول سلسلة: ${nOf('ar', g.streak.longest, 'day')}`, fr: `Record : ${nOf('fr', g.streak.longest, 'day')}` })}</span>
          {g.streak.freezes > 0 && <span className="text-xs text-info">{tr({ ar: `حماية السلسلة: ${nOf('ar', g.streak.freezes, 'day')}`, fr: `Protection de série : ${nOf('fr', g.streak.freezes, 'day')}` })}</span>}
        </Card>
        <Card className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-sm text-muted"><Zap className="size-4 text-warning" aria-hidden />{tr({ ar: 'هدف اليوم', fr: 'Objectif du jour' })}</span>
          <span className="text-3xl font-extrabold tabular-nums" dir="ltr">{g.todayXp}<span className="text-base font-semibold text-muted">/{g.dailyGoalXp} XP</span></span>
          <ProgressBar value={goalPct} tone={goalPct >= 100 ? 'success' : 'primary'} label={tr({ ar: 'هدف اليوم', fr: 'Objectif du jour' })} />
          {goalPct >= 100 && <span className="text-xs font-semibold text-success">{tr({ ar: 'أحسنت! حققت هدف اليوم.', fr: 'Bravo, objectif atteint !' })}</span>}
        </Card>
      </div>
      <Card>
        <h3 className="mb-3 font-bold">{tr({ ar: `الشارات (${g.badges.length}/${BADGES.length})`, fr: `Badges (${g.badges.length}/${BADGES.length})` })}</h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BADGES.map((b) => {
            const at = earned.get(b.code);
            return (
              <li key={b.code} className={clsx('flex flex-col items-center gap-1 rounded-2xl border p-3 text-center', at ? 'border-warning/40 bg-warning-soft' : 'border-border bg-surface-2 opacity-70')}>
                {at ? <Award className="size-8 text-warning" aria-hidden /> : <Lock className="size-8 text-muted" aria-hidden />}
                <span className="text-sm font-bold">{tr({ ar: b.ar, fr: b.fr })}</span>
                <span className="text-xs text-muted">{at ? formatDate(locale, at, { day: 'numeric', month: 'short', year: 'numeric' }) : tr(BADGE_HINTS[b.code] ?? { ar: b.rule, fr: b.rule })}</span>
                <span className="sr-only">{at ? tr({ ar: 'محصّلة', fr: 'obtenu' }) : tr({ ar: 'غير محصّلة بعد', fr: 'pas encore obtenu' })}</span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

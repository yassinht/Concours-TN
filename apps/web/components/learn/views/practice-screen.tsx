'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import {
  BookMarked, BookOpen, CalendarCheck, ChevronDown, ClipboardCheck, ClipboardList, Dumbbell, Flame, ListTree, PlayCircle, RotateCcw, Sparkles, Trophy, Wand2, Zap,
} from 'lucide-react';
import type { Domain, GamificationDTO, SyllabusNodeDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Alert, Button, Card, ProgressBar } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { ErrorState, PageHeader, SectionTitle, Skeleton, UpsellCard } from '@/components/app/bits';
import { bi, relativeTime } from '@/components/app/format';
import { MasteryMeter } from '../charts';
import { readLocal, useEnrollments, useSessionApi, useStartAttempt, writeLocal } from '../hooks';
import { PaywallModal } from '../paywall';
import { biCount, KIND_LABELS, nOf } from '../labels';
import { byDomain } from '../syllabus';
import type { AttemptHistoryItem, BillingUsage } from '../types';

const COUNTS = [5, 10, 20, 30] as const;
const COUNT_KEY = 'ctn_practice_count';

/** /app/practice: choose what to practise (adaptive, mistakes, today's plan, by domain or topic). */
export function PracticeScreen() {
  const tr = useT();
  const { locale } = useLocale();
  const { me } = useSession();
  const enr = useEnrollments();
  const slug = enr.primary?.familySlug ?? null;
  const syllabus = useSessionApi<SyllabusNodeDTO[]>(slug ? `/catalog/syllabus/${encodeURIComponent(slug)}` : null);
  const billing = useSessionApi<BillingUsage>(me && !me.isGuest && !me.premium.active ? '/billing/me' : null);
  const start = useStartAttempt('practice');
  const game = useSessionApi<GamificationDTO>('/me/gamification');
  const recent = useSessionApi<AttemptHistoryItem[]>('/attempts?limit=15');
  const [count, setCount] = useState<number>(() => {
    const v = readLocal<number>(COUNT_KEY, 10);
    return (COUNTS as readonly number[]).includes(v) ? v : 10;
  });
  const [open, setOpen] = useState<Domain | null>(null);

  const pickCount = (n: number) => {
    setCount(n);
    writeLocal(COUNT_KEY, n);
  };
  const scope = slug ? { familySlug: slug } : {};
  const limit = billing.data?.entitlements.limits.questionsPerDay ?? null;
  const used = billing.data?.usageToday.questions ?? 0;
  const left = limit != null ? Math.max(0, limit - used) : null;
  const groups = syllabus.data ? byDomain(syllabus.data) : [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tr({ ar: 'تدرّب', fr: 'S’entraîner' })}
        subtitle={enr.primary ? bi(locale, enr.primary.familyName_ar, enr.primary.familyName_fr) : tr({ ar: 'اختر ما تريد التدرب عليه', fr: 'Choisissez quoi travailler' })}
      />

      {enr.data && !enr.primary && (
        <Alert tone="info" title={tr({ ar: 'اختر مناظرتك لتدرّب مخصص', fr: 'Choisissez votre concours pour un entraînement ciblé' })}>
          <span className="flex flex-wrap items-center gap-2">
            {tr({ ar: 'يمكنك التدرب على الأسئلة العامة الآن، لكن الأسئلة والخطة تصبح أدق عندما تحدد مناظرتك.', fr: 'Vous pouvez déjà travailler les questions générales ; tout devient plus précis une fois votre concours choisi.' })}
            <Link href="/app/onboarding" className="font-semibold underline">{tr({ ar: 'اختيار المناظرة', fr: 'Choisir le concours' })}</Link>
          </span>
        </Alert>
      )}

      {game.data && (
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
          <span className="inline-flex items-center gap-1 font-bold tabular-nums" title={tr({ ar: 'السلسلة', fr: 'Série' })}>
            <Flame className={clsx('size-5', game.data.streak.current > 0 ? 'text-accent' : 'text-muted')} aria-hidden />
            {tr(biCount(game.data.streak.current, 'day'))}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold"><Zap className="size-3.5 text-warning" aria-hidden />{tr({ ar: 'هدف اليوم', fr: 'Objectif du jour' })}</span>
              <span className="tabular-nums" dir="ltr">{game.data.todayXp}/{game.data.dailyGoalXp} XP</span>
            </span>
            <ProgressBar value={(game.data.todayXp / Math.max(1, game.data.dailyGoalXp)) * 100} tone={game.data.todayXp >= game.data.dailyGoalXp ? 'success' : 'accent'} label={tr({ ar: 'هدف اليوم', fr: 'Objectif du jour' })} />
          </span>
        </div>
      )}

      <Unfinished items={recent.data ?? []} />

      {left != null && (
        left === 0 ? <UpsellCard reason="limit" /> : (
          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{tr({ ar: 'الأسئلة المجانية المتبقية اليوم', fr: 'Questions gratuites restantes aujourd’hui' })}</span>
              <span className="font-bold tabular-nums" dir="ltr">{left}/{limit}</span>
            </div>
            <ProgressBar value={(left / Math.max(1, limit!)) * 100} tone={left <= 3 ? 'warning' : 'primary'} label={tr({ ar: 'الأسئلة المتبقية', fr: 'Questions restantes' })} />
            <p className="text-xs text-muted">{tr({ ar: 'يتجدد الرصيد كل يوم على الساعة 00:00 بتوقيت تونس. الاختبار التشخيصي والامتحان التجريبي لا يُحتسبان.', fr: 'Le quota se renouvelle chaque jour à minuit (heure de Tunis). Le diagnostic et l’examen blanc ne sont pas décomptés.' })}</p>
          </Card>
        )
      )}

      <section aria-labelledby="quick" className="flex flex-col gap-3">
        <SectionTitle id="quick">{tr({ ar: 'ابدأ بسرعة', fr: 'Démarrage rapide' })}</SectionTitle>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="mb-1.5 text-sm text-muted">{tr({ ar: 'عدد الأسئلة', fr: 'Nombre de questions' })}</legend>
          {COUNTS.map((n) => (
            <label key={n} className={clsx('inline-flex min-h-11 min-w-14 cursor-pointer items-center justify-center rounded-full border px-4 text-sm font-bold tabular-nums transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary', count === n ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted hover:text-text')}>
              <input type="radio" name="count" value={n} checked={count === n} onChange={() => pickCount(n)} className="sr-only" />
              {n}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          <QuickAction
            icon={Wand2}
            tone="primary"
            title={tr({ ar: `${nOf('ar', count, 'question')} على مقاسك`, fr: `${count} questions adaptées` })}
            body={tr({ ar: 'أسئلة على مقاس مستواك، مع تركيز على نقاط ضعفك.', fr: 'Des questions à votre niveau, centrées sur vos points faibles.' })}
            loading={start.busy === 'adaptive'}
            onClick={() => void start.start({ kind: 'PRACTICE', count, ...scope }, 'adaptive')}
          />
          <QuickAction
            icon={RotateCcw}
            tone="warning"
            title={tr({ ar: 'راجع أخطائي', fr: 'Revoir mes erreurs' })}
            body={tr({ ar: 'الأسئلة التي أخطأت فيها وحان موعد مراجعتها.', fr: 'Les questions ratées dont la révision est due.' })}
            loading={start.busy === 'review'}
            onClick={() => void start.start({ kind: 'REVIEW', count, ...scope }, 'review')}
          />
          <QuickAction
            icon={CalendarCheck}
            tone="success"
            title={tr({ ar: 'تمارين اليوم', fr: 'Entraînement du jour' })}
            body={tr({ ar: 'الأسئلة المقترحة في خطة اليوم.', fr: 'Les questions prévues par votre plan du jour.' })}
            loading={start.busy === 'daily'}
            onClick={() => void start.start({ kind: 'DAILY', ...scope }, 'daily')}
          />
          <Link href="/app/mock" className="card flex min-h-20 items-start gap-3 p-4 transition hover:border-accent">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><ClipboardCheck className="size-5" aria-hidden /></span>
            <span className="flex flex-col gap-0.5">
              <span className="font-bold">{tr({ ar: 'امتحان تجريبي', fr: 'Examen blanc' })}</span>
              <span className="text-sm text-muted">{tr({ ar: 'نفس العدد والتوقيت، دون تصحيح حتى النهاية.', fr: 'Même nombre de questions et même durée, corrigé à la fin.' })}</span>
            </span>
          </Link>
        </div>
        {start.error && <Alert tone="warning">{tr(start.error)}</Alert>}
      </section>

      <section aria-labelledby="by-domain" className="flex flex-col gap-3">
        <SectionTitle id="by-domain" action={slug ? <Link href={`/app/syllabus/${encodeURIComponent(slug)}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"><ListTree className="size-4" aria-hidden />{tr({ ar: 'البرنامج الكامل', fr: 'Programme complet' })}</Link> : undefined}>
          {tr({ ar: 'حسب المادة والمحور', fr: 'Par matière et par thème' })}
        </SectionTitle>
        {!slug && enr.data ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(['CULTURE_GENERALE', 'ARABIC', 'FRENCH', 'LOGIC', 'NUMERICAL', 'ENGLISH'] as Domain[]).map((d) => (
              <Button key={d} variant="secondary" size="lg" loading={start.busy === d} onClick={() => void start.start({ kind: 'PRACTICE', domain: d, count }, d)}>
                <Dumbbell className="size-4" aria-hidden />{tr(DOMAIN_LABELS[d])}
              </Button>
            ))}
          </div>
        ) : syllabus.error ? (
          <ErrorState error={syllabus.error} onRetry={() => void syllabus.reload()} />
        ) : !syllabus.data || enr.loading ? (
          <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted">{tr({ ar: 'برنامج هذه المناظرة قيد الإعداد.', fr: 'Le programme de ce concours est en préparation.' })}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.map((g) => {
              const expanded = open === g.domain;
              return (
                <li key={g.domain} className="card overflow-hidden">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <h3>
                        <button type="button" onClick={() => setOpen(expanded ? null : g.domain)} aria-expanded={expanded} aria-controls={`dom-${g.domain}`} className="flex min-h-11 w-full items-center gap-2 text-start font-bold">
                          <ChevronDown className={clsx('size-5 shrink-0 text-muted transition', expanded && 'rotate-180')} aria-hidden />
                          {tr(DOMAIN_LABELS[g.domain])}
                        </button>
                      </h3>
                      <span className="ps-7 text-xs text-muted">{tr(biCount(g.topics.length, 'topic'))} · {tr(biCount(g.questions, 'question'))}</span>
                      <div className="ps-7"><MasteryMeter mastery={g.mastery} /></div>
                    </div>
                    <Button size="sm" className="min-h-11" loading={start.busy === g.domain} disabled={g.questions === 0} onClick={() => void start.start({ kind: 'PRACTICE', domain: g.domain, count, ...scope }, g.domain)}>
                      <Dumbbell className="size-4" aria-hidden />{tr({ ar: 'تدرّب', fr: 'S’entraîner' })}
                    </Button>
                  </div>
                  {expanded && (
                    <ul id={`dom-${g.domain}`} className="flex flex-col divide-y divide-border border-t border-border">
                      {g.topics.map((t) => (
                        <li key={t.key} className="flex flex-wrap items-center gap-2 px-4 py-3">
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-sm font-semibold">{bi(locale, t.title_ar, t.title_fr)}</span>
                            <MasteryMeter mastery={t.mastery} />
                          </span>
                          {t.hasLesson && (
                            <Link href={`/app/lesson/${encodeURIComponent(t.key)}`} className="inline-flex size-11 items-center justify-center rounded-xl text-primary hover:bg-primary-soft" aria-label={`${tr({ ar: 'الدرس', fr: 'Leçon' })} — ${bi(locale, t.title_ar, t.title_fr)}`}>
                              <BookOpen className="size-5" aria-hidden />
                            </Link>
                          )}
                          <Button size="sm" variant="secondary" className="min-h-11" disabled={t.questionCount === 0} loading={start.busy === t.key} onClick={() => void start.start({ kind: 'PRACTICE', topicKey: t.key, count, ...scope }, t.key)}>
                            {t.questionCount === 0 ? tr({ ar: 'قريبًا', fr: 'Bientôt' }) : tr({ ar: 'تدرّب', fr: 'S’entraîner' })}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav aria-label={tr({ ar: 'أدوات أخرى', fr: 'Autres outils' })} className="grid gap-2 sm:grid-cols-2">
        <ToolLink href="/app/mistakes" icon={BookMarked} label={tr({ ar: 'دفتر الأخطاء والمفضلة', fr: 'Carnet d’erreurs et favoris' })} />
        <ToolLink href="/app/leaderboard" icon={Trophy} label={tr({ ar: 'الترتيب الأسبوعي', fr: 'Classement de la semaine' })} />
        {slug && <ToolLink href={`/app/checklist/${encodeURIComponent(slug)}`} icon={ClipboardList} label={tr({ ar: 'الوثائق والاختبارات البدنية', fr: 'Dossier et épreuves sportives' })} />}
        <ToolLink href="/app/progress" icon={Sparkles} label={tr({ ar: 'تقدمي ومستوى التحضير', fr: 'Progrès et préparation' })} />
      </nav>

      <PaywallModal reason={start.paywall} onClose={start.closePaywall} from="practice" />
    </div>
  );
}

function QuickAction({ icon: Icon, title, body, onClick, loading, tone }: {
  icon: typeof Wand2; title: string; body: string; onClick: () => void; loading?: boolean; tone: 'primary' | 'warning' | 'success';
}) {
  const cls = { primary: 'bg-primary-soft text-primary', warning: 'bg-warning-soft text-warning', success: 'bg-success-soft text-success' }[tone];
  return (
    <button type="button" onClick={onClick} disabled={loading} aria-busy={loading || undefined} className="card flex min-h-20 items-start gap-3 p-4 text-start transition hover:border-primary disabled:opacity-60">
      <span className={clsx('inline-flex size-10 shrink-0 items-center justify-center rounded-xl', cls)}>
        <Icon className={clsx('size-5', loading && 'animate-pulse')} aria-hidden />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-bold">{title}</span>
        <span className="text-sm text-muted">{body}</span>
      </span>
    </button>
  );
}

function ToolLink({ href, icon: Icon, label }: { href: string; icon: typeof Wand2; label: string }) {
  return (
    <Link href={href} className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2">
      <Icon className="size-4 text-primary" aria-hidden />{label}
    </Link>
  );
}

/** Sessions started but not finished (answers are saved server-side): one tap to resume. Expired mocks are left out. */
function Unfinished({ items }: { items: AttemptHistoryItem[] }) {
  const tr = useT();
  const { locale } = useLocale();
  const now = Date.now();
  const open = items.filter((a) => !a.submittedAt && (!a.expiresAt || Date.parse(a.expiresAt) > now)).slice(0, 3);
  if (!open.length) return null;
  return (
    <section aria-labelledby="unfinished" className="flex flex-col gap-2">
      <h2 id="unfinished" className="text-sm font-bold text-muted">{tr({ ar: 'جلسات لم تكتمل', fr: 'Sessions à terminer' })}</h2>
      <ul className="flex flex-col gap-2">
        {open.map((a) => (
          <li key={a.id}>
            <Link href={`/app/session/${a.id}`} className="card flex min-h-14 items-center gap-3 p-3 hover:border-primary">
              <PlayCircle className="size-6 shrink-0 text-primary" aria-hidden />
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{tr(KIND_LABELS[a.kind])}</span>
                <span className="text-xs text-muted">
                  {tr(biCount(a.total, 'question'))}
                  {a.startedAt && <> · {relativeTime(locale, a.startedAt)}</>}
                </span>
              </span>
              <span className="text-sm font-semibold text-primary">{tr({ ar: 'واصل', fr: 'Reprendre' })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

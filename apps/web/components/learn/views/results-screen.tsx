'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Award, BellRing, BookOpen, CalendarCheck, CircleCheck, CircleX, Clock, Dumbbell, Lock, RotateCcw, Sparkles, Target, Trophy, TrendingUp, UserPlus, Zap,
} from 'lucide-react';
import type { QuestionDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { BADGES } from '@ctn/shared/dist/learning';
import { Alert, Badge, ButtonLink, Button, Card, EmptyState, Stat, Tabs, scoreTone } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { ErrorState, PageHeader, SectionTitle, Skeleton } from '@/components/app/bits';
import { bi } from '@/components/app/format';
import { track } from '@/components/app/use-api';
import { FollowButton } from '@/components/public/follow-button';
import { FollowsProvider } from '@/components/public/follows';
import { ShareButtons } from '@/components/public/share-buttons';
import { DomainBars, ScoreRing } from '../charts';
import { useSessionApi, useStartAttempt } from '../hooks';
import { biCount, durationText, KIND_LABELS, readinessText } from '../labels';
import { PaywallModal } from '../paywall';
import { AnswerReview } from '../question-inputs';
import { BookmarkButton, ReportButton } from '../question-tools';
import { isResult, type AttemptGet, type AttemptHistoryItem, type ResultView } from '../types';

type ReviewFilter = 'all' | 'wrong' | 'correct';

export function ResultsScreen({ id, familyHint }: { id: string; familyHint?: string }) {
  const tr = useT();
  const router = useRouter();
  const state = useSessionApi<AttemptGet>(`/attempts/${encodeURIComponent(id)}`);
  // Results carry no family slug: the attempt history does (needed for sharing, alerts and scoped practice).
  const kind = state.data && isResult(state.data) ? state.data.result.kind : null;
  const history = useSessionApi<AttemptHistoryItem[]>(kind && !familyHint ? `/attempts?kind=${kind}&limit=100` : null);
  const familySlug = familyHint ?? history.data?.find((h) => h.id === id)?.familySlug ?? null;

  useEffect(() => {
    if (state.data && !isResult(state.data)) router.replace(`/app/session/${id}`);
  }, [state.data, id, router]);

  if (state.error) return <ErrorState error={state.error} onRetry={() => void state.reload()} />;
  if (!state.data || !isResult(state.data)) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={tr({ ar: 'جارٍ التحميل', fr: 'Chargement' })}>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-56" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  return <Results r={state.data.result} familySlug={familySlug} />;
}

function Results({ r, familySlug }: { r: ResultView; familySlug: string | null }) {
  const tr = useT();
  const { locale } = useLocale();
  const { me } = useSession();
  const practice = useStartAttempt('results');
  const guestDiagnostic = r.kind === 'DIAGNOSTIC' && !!me?.isGuest;

  useEffect(() => {
    if (r.kind !== 'DIAGNOSTIC') return;
    const key = `ctn_diag_done_${r.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* tracking is best effort */
    }
    track('diagnostic_done', { score: r.score, total: r.total, guest: !!me?.isGuest });
  }, [r.id, r.kind, r.score, r.total, me?.isGuest]);

  const wrongCount = r.review.filter((x) => !x.isCorrect).length;
  const answered = r.answeredCount ?? r.review.filter((x) => x.answer != null).length;
  const tone = scoreTone(r.score);
  const verdict = r.score >= 75
    ? { ar: 'نتيجة ممتازة! واصل على هذا النسق.', fr: 'Excellent résultat ! Continuez ainsi.' }
    : r.score >= 50
      ? { ar: 'بداية جيدة. ركّز على المحاور الضعيفة أدناه.', fr: 'Bon début. Concentrez-vous sur les points faibles ci-dessous.' }
      : { ar: 'لا بأس، هذا هو الهدف من التدرب: معرفة أين تركّز جهدك.', fr: 'Pas de panique : c’est exactement à ça que sert l’entraînement — savoir où travailler.' };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back="/app"
        title={r.kind === 'DIAGNOSTIC' ? tr({ ar: 'نتيجة الاختبار التشخيصي', fr: 'Résultat du diagnostic' }) : tr({ ar: 'نتيجتك', fr: 'Votre résultat' })}
        subtitle={tr(KIND_LABELS[r.kind])}
      />

      {/* ── Score ── */}
      <Card className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <ScoreRing value={r.score} label={tr({ ar: 'النتيجة', fr: 'Score' })} sub={`${r.correctCount}/${r.total}`} />
        <div className="flex w-full flex-1 flex-col gap-3">
          <p className={clsx('text-center text-lg font-bold sm:text-start', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger')}>{tr(verdict)}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label={<span className="inline-flex items-center gap-1"><CircleCheck className="size-3.5" aria-hidden />{tr({ ar: 'إجابات صحيحة', fr: 'Bonnes réponses' })}</span>} value={<span dir="ltr">{r.correctCount}/{r.total}</span>} />
            <Stat label={<span className="inline-flex items-center gap-1"><Target className="size-3.5" aria-hidden />{tr({ ar: 'الدقة', fr: 'Précision' })}</span>} value={<span dir="ltr">{r.accuracy}%</span>} sub={tr({ ar: `الأسئلة المُجابة: ${answered}`, fr: `sur ${answered} répondue(s)` })} />
            <Stat label={<span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />{tr({ ar: 'المدة', fr: 'Durée' })}</span>} value={durationText(locale, r.durationS)} sub={r.avgTimeS ? tr({ ar: `${r.avgTimeS} ث لكل سؤال`, fr: `${r.avgTimeS} s / question` }) : undefined} />
          </div>
          {r.kind === 'MOCK' && (
            <p className="flex items-center gap-2 text-sm">
              <TrendingUp className="size-4 text-primary" aria-hidden />
              {r.percentile != null
                ? tr({ ar: `نتيجتك أفضل من ${r.percentile}% من الامتحانات التجريبية المماثلة على المنصة.`, fr: `Meilleur que ${r.percentile} % des examens blancs identiques sur la plateforme.` })
                : tr({ ar: 'سيظهر ترتيبك بين المترشحين عندما يجتاز عدد كافٍ منهم هذا الامتحان.', fr: 'Votre rang apparaîtra quand assez de candidats auront passé cet examen.' })}
            </p>
          )}
        </div>
      </Card>

      {/* ── Rewards ── */}
      {(r.xpGained > 0 || r.newBadges.length > 0) && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          {r.xpGained > 0 && <Badge tone="warning" className="text-sm"><Zap className="size-4" aria-hidden />+{r.xpGained} XP</Badge>}
          {r.newBadges.map((code) => {
            const b = BADGES.find((x) => x.code === code);
            return <Badge key={code} tone="accent" className="text-sm"><Award className="size-4" aria-hidden />{b ? tr({ ar: b.ar, fr: b.fr }) : code}</Badge>;
          })}
        </div>
      )}

      {guestDiagnostic ? (
        <GuestGate r={r} familySlug={familySlug} />
      ) : (
        <Analysis r={r} onPractice={(topicKey) => void practice.start({ kind: 'PRACTICE', topicKey, count: 10, ...(familySlug ? { familySlug } : {}) }, topicKey)} busy={practice.busy} />
      )}

      {practice.error && <Alert tone="danger">{tr(practice.error)}</Alert>}

      {/* ── Next steps ── */}
      {!guestDiagnostic && (
        <section aria-labelledby="next-steps" className="flex flex-col gap-2">
          <SectionTitle id="next-steps">{tr({ ar: 'الخطوة التالية', fr: 'Et maintenant ?' })}</SectionTitle>
          {r.kind === 'DIAGNOSTIC' && me && !me.onboarding.hasEnrollment && (
            <Card className="flex flex-col gap-2 border-primary/40 bg-primary-soft">
              <p className="flex items-center gap-2 font-bold text-primary"><CalendarCheck className="size-5" aria-hidden />{tr({ ar: 'حوّل هذه النتيجة إلى خطة دراسة يومية', fr: 'Transformez ce résultat en plan de révision quotidien' })}</p>
              <p className="text-sm">{tr({ ar: 'حدّد المناظرة وتاريخها لنقترح عليك كل يوم ما تراجعه، ونعلمك عند فتح المناظرات التي تناسب ملفك.', fr: 'Indiquez le concours et sa date : nous vous proposerons chaque jour quoi réviser et vous alerterons à l’ouverture des concours adaptés à votre profil.' })}</p>
              <ButtonLink href={`/app/onboarding${familySlug ? `?family=${encodeURIComponent(familySlug)}` : ''}`} className="self-start">{tr({ ar: 'ابدأ خطتي', fr: 'Démarrer mon plan' })}</ButtonLink>
            </Card>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {wrongCount > 0 && (
              <Button variant="primary" size="lg" loading={practice.busy === 'review'} onClick={() => void practice.start({ kind: 'REVIEW', count: Math.min(30, Math.max(5, wrongCount)), ...(familySlug ? { familySlug } : {}) }, 'review')}>
                <RotateCcw className="size-4" aria-hidden />{tr({ ar: 'راجع أخطائي', fr: 'Revoir mes erreurs' })}
              </Button>
            )}
            <Button variant="secondary" size="lg" loading={practice.busy === 'adaptive'} onClick={() => void practice.start({ kind: 'PRACTICE', count: 10, ...(familySlug ? { familySlug } : {}) }, 'adaptive')}>
              <Dumbbell className="size-4" aria-hidden />{tr({ ar: '10 أسئلة متكيفة', fr: '10 questions adaptées' })}
            </Button>
            {r.kind === 'MOCK' && (
              <ButtonLink href="/app/mock" variant="secondary" size="lg"><Trophy className="size-4" aria-hidden />{tr({ ar: 'امتحاناتي التجريبية', fr: 'Mes examens blancs' })}</ButtonLink>
            )}
            <ButtonLink href="/app/progress" variant="ghost" size="lg"><TrendingUp className="size-4" aria-hidden />{tr({ ar: 'تقدمي', fr: 'Ma progression' })}</ButtonLink>
          </div>
        </section>
      )}

      {r.kind === 'DIAGNOSTIC' && familySlug && (
        <section aria-labelledby="share" className="flex flex-col gap-2">
          <SectionTitle id="share">{tr({ ar: 'تحدَّ أصدقاءك', fr: 'Défiez vos amis' })}</SectionTitle>
          <p className="text-sm text-muted">{tr({ ar: 'شارك الاختبار التشخيصي المجاني مع من يستعد لنفس المناظرة.', fr: 'Partagez le diagnostic gratuit avec ceux qui préparent le même concours.' })}</p>
          <ShareButtons path={`/diagnostic/${encodeURIComponent(familySlug)}`} title={tr({ ar: `حصلت على ${r.score}% في الاختبار التشخيصي — جرّب أنت أيضًا`, fr: `J’ai obtenu ${r.score} % au diagnostic — à vous de jouer` })} />
        </section>
      )}

      {/* ── Answer review ── */}
      {guestDiagnostic ? null : <ReviewList review={r.review} />}

      <PaywallModal reason={practice.paywall} onClose={practice.closePaywall} from="results" />
    </div>
  );
}

function Analysis({ r, onPractice, busy }: { r: ResultView; onPractice: (topicKey: string) => void; busy: string | null }) {
  const tr = useT();
  const { locale } = useLocale();
  const readiness = r.readiness;
  const rt = readiness ? readinessText(readiness.label) : null;
  return (
    <>
      {r.byDomain.length > 0 && (
        <Card as="section">
          <SectionTitle>{tr({ ar: 'النتيجة حسب المادة', fr: 'Résultat par matière' })}</SectionTitle>
          <DomainBars rows={r.byDomain.map((d) => ({ domain: d.domain, score: d.score, detail: <span dir="ltr">{d.correct}/{d.total} ·</span> }))} />
        </Card>
      )}

      {(r.weakTopics.length > 0 || r.strongTopics.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {r.weakTopics.length > 0 && (
            <Card as="section" className="flex flex-col gap-2">
              <SectionTitle>{tr({ ar: 'محاور تحتاج إلى عمل', fr: 'Points à travailler' })}</SectionTitle>
              <ul className="flex flex-col gap-2">
                {r.weakTopics.map((t) => (
                  <li key={t.key} className="flex flex-col gap-2 rounded-xl bg-danger-soft/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{bi(locale, t.title_ar, t.title_fr)}</span>
                      <span className="text-sm font-bold text-danger" dir="ltr">{t.score}%</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" className="min-h-11" loading={busy === t.key} onClick={() => onPractice(t.key)}>
                        <Dumbbell className="size-4" aria-hidden />{tr({ ar: 'تدرّب على هذا المحور', fr: 'S’entraîner' })}
                      </Button>
                      <ButtonLink href={`/app/lesson/${encodeURIComponent(t.key)}`} size="sm" variant="secondary" className="min-h-11">
                        <BookOpen className="size-4" aria-hidden />{tr({ ar: 'الدرس', fr: 'Leçon' })}
                      </ButtonLink>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {r.strongTopics.length > 0 && (
            <Card as="section" className="flex flex-col gap-2">
              <SectionTitle>{tr({ ar: 'نقاط قوتك', fr: 'Vos points forts' })}</SectionTitle>
              <ul className="flex flex-col gap-2">
                {r.strongTopics.map((t) => (
                  <li key={t.key} className="flex items-center justify-between gap-2 rounded-xl bg-success-soft/60 p-3">
                    <span className="flex items-center gap-2 font-semibold"><CircleCheck className="size-4 text-success" aria-hidden />{bi(locale, t.title_ar, t.title_fr)}</span>
                    <span className="text-sm font-bold text-success" dir="ltr">{t.score}%</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {readiness && rt && (
        <Card as="section" className="flex flex-col gap-3">
          <SectionTitle>{tr({ ar: 'مستوى التحضير', fr: 'Niveau de préparation' })}</SectionTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={rt.tone} className="text-sm">{tr(rt)}</Badge>
            <span className="text-sm text-muted">
              {tr({ ar: 'التحضير', fr: 'Préparation' })} <b className="text-text" dir="ltr">{readiness.preparation}%</b>
              {' · '}{tr({ ar: 'التغطية', fr: 'Couverture' })} <b className="text-text" dir="ltr">{readiness.coverage}%</b>
            </span>
          </div>
          {readiness.reasons.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
              {readiness.reasons.map((x, i) => <li key={i}>{tr(x)}</li>)}
            </ul>
          )}
          <p className="rounded-xl bg-surface-2 p-3 text-xs text-muted">{tr(readiness.disclaimer)}</p>
        </Card>
      )}

      {r.sections && r.sections.length > 1 && (
        <Card as="section">
          <SectionTitle>{tr({ ar: 'أقسام الامتحان', fr: 'Sections de l’examen' })}</SectionTitle>
          <ul className="flex flex-col gap-1 text-sm">
            {r.sections.map((s, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{tr({ ar: `القسم ${i + 1}`, fr: `Section ${i + 1}` })} · {tr(DOMAIN_LABELS[s.domain])}</span>
                <span className="text-muted tabular-nums">{tr(biCount(s.count, 'question'))}{s.minutes ? ` · ${tr(biCount(s.minutes, 'minute'))}` : ''}</span>
              </li>
            ))}
          </ul>
          {!!r.shortfall && <p className="mt-2 text-xs text-muted">{tr({ ar: 'بعض الأقسام اكتملت بأسئلة من مواد قريبة لأن بنك الأسئلة لا يزال يتوسع.', fr: 'Certaines sections ont été complétées par des questions de matières proches.' })}</p>}
        </Card>
      )}
    </>
  );
}

/** Guest after a diagnostic: global score visible, the detailed analysis blurred behind a free sign-up. */
function GuestGate({ r, familySlug }: { r: ResultView; familySlug: string | null }) {
  const tr = useT();
  const next = `/app/results/${r.id}`;
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border" aria-labelledby="gate-title">
      <div className="pointer-events-none select-none blur-sm" aria-hidden inert>
        <div className="flex flex-col gap-3 p-4">
          <DomainBars rows={(r.byDomain.length ? r.byDomain : [{ domain: 'LOGIC' as const, score: 40 }, { domain: 'ARABIC' as const, score: 70 }]).map((d) => ({ domain: d.domain, score: d.score }))} />
          <div className="h-24 rounded-xl bg-danger-soft" />
          <div className="h-20 rounded-xl bg-surface-2" />
        </div>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/70 p-5 text-center">
        <Lock className="size-7 text-primary" aria-hidden />
        <h2 id="gate-title" className="max-w-sm text-lg font-extrabold">{tr({ ar: 'سجّل مجانًا لرؤية التحليل الكامل وخطة دراستك', fr: 'Inscrivez-vous gratuitement pour voir l’analyse complète et votre plan d’étude' })}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li className="flex items-center gap-1.5"><Sparkles className="size-4 text-accent" aria-hidden />{tr({ ar: 'نتيجتك في كل مادة ونقاط ضعفك', fr: 'Vos résultats par matière et vos points faibles' })}</li>
          <li className="flex items-center gap-1.5"><Sparkles className="size-4 text-accent" aria-hidden />{tr({ ar: 'تصحيح كل الأسئلة مع الشرح', fr: 'Le corrigé expliqué de chaque question' })}</li>
          <li className="flex items-center gap-1.5"><BellRing className="size-4 text-accent" aria-hidden />{tr({ ar: 'تنبيه عند فتح المناظرات التي تناسب ملفك', fr: 'Une alerte à l’ouverture des concours adaptés à votre profil' })}</li>
        </ul>
        <ButtonLink href={`/register?next=${encodeURIComponent(next)}`} variant="accent" size="lg">
          <UserPlus className="size-5" aria-hidden />{tr({ ar: 'أنشئ حسابي المجاني', fr: 'Créer mon compte gratuit' })}
        </ButtonLink>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">{tr({ ar: 'لديّ حساب: تسجيل الدخول', fr: 'J’ai déjà un compte : connexion' })}</Link>
        {familySlug && (
          <FollowsProvider>
            <div className="pt-1"><FollowButton slug={familySlug} variant="compact" /></div>
          </FollowsProvider>
        )}
      </div>
    </section>
  );
}

function ReviewList({ review }: { review: ResultView['review'] }) {
  const tr = useT();
  const [filter, setFilter] = useState<ReviewFilter>(() => (review.some((x) => !x.isCorrect) ? 'wrong' : 'all'));
  const items = useMemo(() => review.map((x, i) => ({ ...x, n: i + 1 })).filter((x) => (filter === 'all' ? true : filter === 'wrong' ? !x.isCorrect : x.isCorrect)), [review, filter]);
  const wrong = review.filter((x) => !x.isCorrect).length;
  if (!review.length) return null;
  return (
    <section aria-labelledby="review" className="flex flex-col gap-3">
      <SectionTitle id="review">{tr({ ar: 'مراجعة الإجابات', fr: 'Corrigé détaillé' })}</SectionTitle>
      <Tabs<ReviewFilter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'wrong', label: `${tr({ ar: 'الأخطاء فقط', fr: 'Erreurs' })} (${wrong})` },
          { value: 'correct', label: `${tr({ ar: 'الصحيحة', fr: 'Correctes' })} (${review.length - wrong})` },
          { value: 'all', label: `${tr({ ar: 'الكل', fr: 'Tout' })} (${review.length})` },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState icon={<Trophy className="size-8" aria-hidden />} title={filter === 'wrong' ? tr({ ar: 'لا أخطاء! أحسنت.', fr: 'Aucune erreur, bravo !' }) : tr({ ar: 'لا توجد عناصر', fr: 'Rien à afficher' })} />
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((x) => <ReviewItem key={x.question.id} n={x.n} q={x.question} answer={x.answer} isCorrect={x.isCorrect} />)}
        </ol>
      )}
    </section>
  );
}

function ReviewItem({ n, q, answer, isCorrect }: { n: number; q: QuestionDTO; answer: unknown; isCorrect: boolean }) {
  const tr = useT();
  return (
    <li className="card overflow-hidden">
      <details className="group">
        <summary className="flex min-h-14 cursor-pointer list-none items-start gap-3 p-3 [&::-webkit-details-marker]:hidden">
          <span className={clsx('mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold', isCorrect ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
            {isCorrect ? <CircleCheck className="size-4" aria-label={tr({ ar: 'صحيح', fr: 'Correct' })} /> : <CircleX className="size-4" aria-label={answer == null ? tr({ ar: 'دون إجابة', fr: 'Sans réponse' }) : tr({ ar: 'خطأ', fr: 'Faux' })} />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-muted tabular-nums">{tr({ ar: 'السؤال', fr: 'Question' })} {n} · {tr(DOMAIN_LABELS[q.domain])}</span>
            <span className="line-clamp-2 font-semibold group-open:line-clamp-none" lang={q.language} dir="auto">{q.stem}</span>
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <AnswerReview q={q} answer={answer} />
          {q.explanation && (
            <div className="rounded-xl bg-surface-2 p-3">
              <h3 className="mb-1 text-sm font-bold">{tr({ ar: 'الشرح', fr: 'Explication' })}</h3>
              <p className="whitespace-pre-line text-sm leading-relaxed" lang={q.language} dir="auto">{q.explanation}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/app/lesson/${encodeURIComponent(q.topicKey)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary hover:bg-primary-soft">
              <BookOpen className="size-4" aria-hidden />{tr({ ar: 'درس المحور', fr: 'Leçon du thème' })}
            </Link>
            <span className="flex items-center">
              <BookmarkButton questionId={q.id} initial={!!q.bookmarked} compact />
              <ReportButton questionId={q.id} />
            </span>
          </div>
        </div>
      </details>
    </li>
  );
}

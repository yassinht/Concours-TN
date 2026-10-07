'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Award, CircleCheck, CircleX, CloudOff, Eraser, Flag, FlagOff, Grid3x3, Keyboard, Minus, Plus, Send, Timer, TriangleAlert, X, Zap,
} from 'lucide-react';
import type { QuestionDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { BADGES } from '@ctn/shared/dist/learning';
import { Alert, Badge, Button, ButtonLink, EmptyState, Modal, ProgressBar } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { errorCode, track } from '@/components/app/use-api';
import { errorText } from '@/components/app/format';
import { api } from '@/lib/api';
import type { Bi } from '@/lib/i18n';
import { useAnswerSync } from './answer-sync';
import { readLocal, useOnline, useStartAttempt, writeLocal } from './hooks';
import { clock, DIFFICULTY_TEXT, FIDELITY_TEXT, KIND_LABELS, nOf } from './labels';
import { PaywallModal, type PaywallReason } from './paywall';
import { draftFrom, isComplete, QuestionInput, QuestionStem, toAnswer, type Answer, type Draft } from './question-inputs';
import { BookmarkButton, ReportButton, TutorPanel } from './question-tools';
import type { FeedbackView, SessionView } from './types';

type Fb = { state: 'graded'; isCorrect: boolean } | { state: 'queued' };
type Scale = 0 | 1 | 2;

const SCALE_KEY = 'ctn_q_scale';
const flagsKey = (id: string) => `ctn_flags_${id}`;
/** Single-choice answers are saved as soon as they are tapped; composed answers after a short pause. */
const SAVE_DEBOUNCE_MS = 700;
const WARN_AT_S = 5 * 60;
const LAST_MINUTE_S = 60;

/** "Ancien concours 2019" out of the API's bilingual "ar · fr" source label. */
function localSourceLabel(label: string | null, locale: 'ar' | 'fr'): string | null {
  if (!label) return null;
  const parts = label.split(' · ');
  return parts.length === 2 ? (locale === 'fr' ? parts[1] : parts[0]) : label;
}

function initialFeedback(s: SessionView): Record<string, Fb> {
  if (s.mode !== 'instant') return {};
  const out: Record<string, Fb> = {};
  for (const q of s.questions) {
    if (!(q.id in s.answered)) continue;
    const known = s.results?.[q.id];
    out[q.id] = typeof known === 'boolean' ? { state: 'graded', isCorrect: known } : { state: 'queued' };
  }
  return out;
}

/**
 * The core learning experience: one question at a time.
 * - instant mode (PRACTICE / DAILY / REVIEW): check → correct/wrong + explanation + tutor.
 * - exam mode (DIAGNOSTIC / MOCK): answers saved silently, navigator grid, flags, countdown with auto-submit.
 * Failed answer saves are queued offline and retried (see answer-sync.ts).
 */
export function QuestionPlayer({ session }: { session: SessionView }) {
  const tr = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { refresh, me } = useSession();
  const online = useOnline();
  const exam = session.mode === 'exam';
  const attemptId = session.id;

  const [qs, setQs] = useState<QuestionDTO[]>(session.questions);
  const N = qs.length;
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => ({ ...session.answered }));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(session.questions.map((q) => [q.id, draftFrom(q, session.answered[q.id])])));
  const [feedback, setFeedback] = useState<Record<string, Fb>>(() => initialFeedback(session));
  const [index, setIndex] = useState(() => {
    const i = session.questions.findIndex((q) => !(q.id in session.answered));
    return i < 0 ? Math.max(0, session.questions.length - 1) : i;
  });
  const [flags, setFlags] = useState<Set<string>>(() => new Set(readLocal<string[]>(flagsKey(attemptId), [])));
  const [scale, setScale] = useState<Scale>(() => {
    const v = readLocal<number>(SCALE_KEY, 1);
    return v === 0 || v === 2 ? v : 1;
  });
  const [checking, setChecking] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [notice, setNotice] = useState<Bi | null>(null);
  const [toast, setToast] = useState<{ text: string; icon: 'xp' | 'badge' } | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ code?: string; pending?: number } | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const [announce, setAnnounce] = useState('');
  const practice = useStartAttempt('tutor');

  const q = qs[Math.min(index, Math.max(0, N - 1))];
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const submittedRef = useRef(false);
  const submitInFlight = useRef(false);
  /** Last answer JSON sent per question (exam mode), so unchanged answers are not re-sent. */
  const lastSaved = useRef<Record<string, string>>(Object.fromEntries(Object.entries(session.answered).map(([k, v]) => [k, JSON.stringify(v)])));

  // ───────── Time spent per question (sent as timeMs) ─────────
  const shownAt = useRef(Date.now());
  const spent = useRef<Record<string, number>>({});
  const currentId = q?.id;
  useEffect(() => {
    shownAt.current = Date.now();
    return () => {
      if (currentId) spent.current[currentId] = (spent.current[currentId] ?? 0) + (Date.now() - shownAt.current);
    };
  }, [currentId]);
  const timeFor = useCallback((qid: string) => (spent.current[qid] ?? 0) + (qid === currentId ? Date.now() - shownAt.current : 0), [currentId]);

  // ───────── Feedback & errors ─────────
  const showToast = useCallback((text: string, icon: 'xp' | 'badge') => {
    setToast({ text, icon });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 2600);
  }, []);

  const applyFeedback = useCallback((qid: string, data: FeedbackView) => {
    setFeedback((f) => ({ ...f, [qid]: { state: 'graded', isCorrect: !!data.isCorrect } }));
    if (data.correct !== undefined || data.explanation !== undefined) {
      setQs((list) => list.map((x) => (x.id === qid ? { ...x, correct: data.correct, explanation: data.explanation } : x)));
    }
    if (data.limitReached) setLimitHit(true);
    if (data.newBadges?.length) {
      const b = BADGES.find((x) => x.code === data.newBadges![0]);
      showToast(`${tr({ ar: 'شارة جديدة', fr: 'Nouveau badge' })} : ${b ? tr({ ar: b.ar, fr: b.fr }) : data.newBadges[0]}`, 'badge');
    } else if (data.xpGained) {
      showToast(`+${data.xpGained} XP`, 'xp');
    }
  }, [showToast, tr]);

  const resultsHref = `/app/results/${attemptId}${session.familySlug ? `?family=${encodeURIComponent(session.familySlug)}` : ''}`;
  const goToResults = useCallback(() => {
    submittedRef.current = true;
    router.replace(resultsHref);
  }, [router, resultsHref]);

  const forgetAnswer = useCallback((qid: string) => {
    setAnswers((a) => {
      const n = { ...a };
      delete n[qid];
      return n;
    });
    setFeedback((f) => {
      const n = { ...f };
      delete n[qid];
      return n;
    });
  }, []);

  const handleRefusal = useCallback((qid: string, code: string) => {
    if (code === 'ATTEMPT_CLOSED') {
      goToResults();
      return;
    }
    forgetAnswer(qid);
    // The refused answer never reached the server: picking it again must send it again.
    delete lastSaved.current[qid];
    if (code === 'LIMIT_REACHED') {
      setLimitHit(true);
      setPaywall('limit');
    } else {
      setNotice(errorText(code));
    }
  }, [forgetAnswer, goToResults]);

  const sync = useAnswerSync(attemptId, {
    onSynced: (qid, data) => {
      if (!exam) applyFeedback(qid, data);
    },
    onRejected: (qid, code) => handleRefusal(qid, code),
  });

  // ───────── Exam-mode silent saves ─────────
  const saveTimers = useRef<Record<string, number>>({});

  const persist = useCallback((qid: string, d: Draft) => {
    const question = qs.find((x) => x.id === qid);
    if (!question) return;
    const ans: Answer = isComplete(question, d) ? toAnswer(question, d) : null;
    const json = JSON.stringify(ans);
    if (lastSaved.current[qid] === json || (ans === null && lastSaved.current[qid] === undefined)) return;
    if (ans === null) delete lastSaved.current[qid];
    else lastSaved.current[qid] = json;
    setAnswers((a) => {
      const n = { ...a };
      if (ans === null) delete n[qid];
      else n[qid] = ans;
      return n;
    });
    void sync.send(qid, ans, timeFor(qid)).then((r) => {
      if (r.status === 'error') handleRefusal(qid, r.code);
    });
  }, [qs, sync, timeFor, handleRefusal]);

  const flushSaves = useCallback(() => {
    for (const [qid, t] of Object.entries(saveTimers.current)) {
      window.clearTimeout(t);
      delete saveTimers.current[qid];
      const d = draftsRef.current[qid];
      if (d) persist(qid, d);
    }
  }, [persist]);

  const onDraft = useCallback((qid: string, d: Draft) => {
    setDrafts((all) => ({ ...all, [qid]: d }));
    setNotice(null);
    if (!exam) return;
    const question = qs.find((x) => x.id === qid);
    const immediate = question && (question.type === 'MCQ_SINGLE' || question.type === 'TRUE_FALSE');
    window.clearTimeout(saveTimers.current[qid]);
    if (immediate) {
      delete saveTimers.current[qid];
      persist(qid, d);
    } else {
      saveTimers.current[qid] = window.setTimeout(() => {
        delete saveTimers.current[qid];
        persist(qid, draftsRef.current[qid] ?? d);
      }, SAVE_DEBOUNCE_MS);
    }
  }, [exam, qs, persist]);

  // ───────── Instant-mode check ─────────
  const check = useCallback(async () => {
    if (!q || exam || checking || feedback[q.id]) return;
    const d = drafts[q.id];
    if (!d || !isComplete(q, d)) return;
    const ans = toAnswer(q, d);
    setChecking(true);
    setNotice(null);
    const r = await sync.send(q.id, ans, timeFor(q.id));
    setChecking(false);
    if (r.status === 'ok') {
      setAnswers((a) => ({ ...a, [q.id]: ans }));
      applyFeedback(q.id, r.data);
      setAnnounce(r.data.isCorrect ? tr({ ar: 'إجابة صحيحة', fr: 'Bonne réponse' }) : tr({ ar: 'إجابة خاطئة', fr: 'Mauvaise réponse' }));
    } else if (r.status === 'queued') {
      setAnswers((a) => ({ ...a, [q.id]: ans }));
      setFeedback((f) => ({ ...f, [q.id]: { state: 'queued' } }));
      setAnnounce(tr({ ar: 'تم حفظ الإجابة دون اتصال', fr: 'Réponse enregistrée hors ligne' }));
    } else {
      handleRefusal(q.id, r.code);
    }
  }, [q, exam, checking, feedback, drafts, sync, timeFor, applyFeedback, handleRefusal, tr]);

  // ───────── Navigation ─────────
  const stemRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stemRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [index]);

  const goTo = useCallback((i: number) => {
    if (exam) flushSaves();
    setIndex(Math.max(0, Math.min(N - 1, i)));
    setGridOpen(false);
    setConfirmOpen(false);
  }, [exam, flushSaves, N]);

  const answeredCount = qs.filter((x) => x.id in answers).length;
  const unanswered = qs.map((x, i) => ({ x, i })).filter(({ x }) => !(x.id in answers));
  const flaggedList = qs.map((x, i) => ({ x, i })).filter(({ x }) => flags.has(x.id));

  // ───────── Submit ─────────
  const submit = useCallback(async (opts: { auto?: boolean; force?: boolean } = {}) => {
    if (submittedRef.current || submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    flushSaves();
    const left = await sync.settle();
    if (left > 0 && !opts.auto && !opts.force) {
      setSubmitError({ pending: left });
      setSubmitting(false);
      submitInFlight.current = false;
      return;
    }
    try {
      await api(`/attempts/${attemptId}/submit`, { method: 'POST', body: {} });
      submittedRef.current = true;
      sync.clear();
      writeLocal(flagsKey(attemptId), null);
      track('attempt_submit', { kind: session.kind, auto: !!opts.auto, answered: answeredCount, total: N });
      void refresh();
      router.replace(resultsHref);
    } catch (e) {
      const code = errorCode(e);
      submitInFlight.current = false;
      if (code === 'NETWORK' && opts.auto) {
        // Time is up but we are offline: keep trying, the server also closes expired attempts on its own.
        window.setTimeout(() => void submitRef.current({ auto: true }), 5000);
        setSubmitError({ code });
        return;
      }
      setSubmitError({ code });
      setSubmitting(false);
    }
  }, [flushSaves, sync, attemptId, session.kind, answeredCount, N, refresh, router, resultsHref]);
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const requestSubmit = useCallback(() => {
    if (exam || unanswered.length > 0) setConfirmOpen(true);
    else void submit();
  }, [exam, unanswered.length, submit]);

  // ───────── Timer ─────────
  const offset = useMemo(() => (session.serverTime ? Date.parse(session.serverTime) - Date.now() : 0), [session.serverTime]);
  const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Instant sessions show no clock: no need to re-render every second.
    if (!exam) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [exam]);
  const remaining = expiresAt != null ? Math.max(0, Math.floor((expiresAt - (now + offset)) / 1000)) : null;
  const elapsed = Math.max(0, Math.floor((now + offset - Date.parse(session.startedAt)) / 1000));
  const warned = useRef<{ five: boolean; one: boolean }>({ five: false, one: false });
  useEffect(() => {
    if (remaining == null || submittedRef.current) return;
    if (remaining <= WARN_AT_S && remaining > LAST_MINUTE_S && !warned.current.five) {
      warned.current.five = true;
      setAnnounce(tr({ ar: 'تبقّت 5 دقائق', fr: 'Il reste 5 minutes' }));
    }
    if (remaining <= LAST_MINUTE_S && remaining > 0 && !warned.current.one) {
      warned.current.one = true;
      setAnnounce(tr({ ar: 'تبقّت دقيقة واحدة', fr: 'Il reste une minute' }));
    }
    if (remaining === 0 && !timeUp) {
      setTimeUp(true);
      setConfirmOpen(false);
      setAnnounce(tr({ ar: 'انتهى الوقت، يتم تسليم إجاباتك', fr: 'Temps écoulé, envoi de vos réponses' }));
      void submitRef.current({ auto: true });
    }
  }, [remaining, timeUp, tr]);

  // Keep the screen on during a timed exam (progressive enhancement).
  useEffect(() => {
    if (!exam || expiresAt == null) return;
    type WakeLock = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } };
    let lock: WakeLock | null = null;
    const acquire = () => {
      if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      lock?.release().catch(() => {});
    };
  }, [exam, expiresAt]);

  // Warn before closing the tab while answers are still unsynced.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (submittedRef.current) return;
      if (sync.pending > 0 || Object.keys(saveTimers.current).length > 0) {
        flushSaves();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [sync.pending, flushSaves]);

  // Flush pending debounced saves when the page is hidden (app switch on mobile).
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flushSaves();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flushSaves]);

  // ───────── Flags & text size ─────────
  const toggleFlag = useCallback(() => {
    if (!q) return;
    setFlags((prev) => {
      const n = new Set(prev);
      if (n.has(q.id)) n.delete(q.id);
      else n.add(q.id);
      writeLocal(flagsKey(attemptId), [...n]);
      return n;
    });
  }, [q, attemptId]);

  const changeScale = (delta: -1 | 1) => {
    setScale((s) => {
      const v = Math.max(0, Math.min(2, s + delta)) as Scale;
      writeLocal(SCALE_KEY, v);
      return v;
    });
  };

  // ───────── Primary action ─────────
  const fb = q ? feedback[q.id] : undefined;
  const isLast = index >= N - 1;
  const allDone = answeredCount >= N;
  const primary = useCallback(() => {
    if (!q || submitting) return;
    if (exam) {
      if (isLast) requestSubmit();
      else goTo(index + 1);
      return;
    }
    if (!feedback[q.id]) {
      if (limitHit) {
        requestSubmit();
        return;
      }
      void check();
      return;
    }
    if (isLast || limitHit) {
      if (allDone || limitHit) requestSubmit();
      else goTo(unanswered[0]?.i ?? index);
    } else {
      goTo(index + 1);
    }
  }, [q, submitting, exam, isLast, requestSubmit, goTo, index, feedback, limitHit, check, allDone, unanswered]);

  // ───────── Keyboard shortcuts (desktop) ─────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('dialog[open]')) return;
      const typing = !!t?.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Enter') {
        if (t?.closest('button, a')) return; // native activation already handles it
        if (typing && !(t instanceof HTMLInputElement && q.type === 'NUMERIC')) return;
        e.preventDefault();
        primary();
        return;
      }
      if (typing) return;
      if (/^[1-9]$/.test(e.key) && (q.type === 'MCQ_SINGLE' || q.type === 'TRUE_FALSE' || q.type === 'MCQ_MULTI')) {
        const opt = q.options[Number(e.key) - 1];
        if (!opt || (!exam && feedback[q.id])) return;
        e.preventDefault();
        const cur = drafts[q.id];
        const ids = cur?.kind === 'ids' ? cur.ids : [];
        const next: Draft = q.type === 'MCQ_MULTI'
          ? { kind: 'ids', ids: ids.includes(opt.id) ? ids.filter((x) => x !== opt.id) : [...ids, opt.id] }
          : { kind: 'ids', ids: [opt.id] };
        onDraft(q.id, next);
      } else if (exam && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        toggleFlag();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, exam, feedback, drafts, onDraft, primary, toggleFlag]);

  if (!q) {
    return (
      <EmptyState
        title={tr({ ar: 'لا توجد أسئلة في هذه الجلسة', fr: 'Aucune question dans cette session' })}
        body={tr({ ar: 'بنك الأسئلة لهذا الموضوع لا يزال قيد الإعداد.', fr: 'La banque de questions de ce thème est en cours de préparation.' })}
        action={<ButtonLink href="/app/practice">{tr({ ar: 'اختر تمرينًا آخر', fr: 'Choisir un autre entraînement' })}</ButtonLink>}
      />
    );
  }

  const section = session.sections?.find((s) => index >= s.start && index < s.end) ?? null;
  const sectionNo = section ? session.sections!.indexOf(section) + 1 : 0;
  const draft = drafts[q.id] ?? draftFrom(q, null);
  const complete = isComplete(q, draft);
  const revealed = !exam && fb?.state === 'graded' && q.correct !== undefined ? { correct: q.correct } : null;
  const locked = submitting || timeUp || (!exam && !!fb);
  const NextIcon = locale === 'ar' ? ArrowLeft : ArrowRight;
  const PrevIcon = locale === 'ar' ? ArrowRight : ArrowLeft;
  const lowTime = remaining != null && remaining <= WARN_AT_S;
  // A guest who came from a public concours page goes back there; everyone else to their space.
  const exitHref = me?.isGuest && !me.onboarding.hasEnrollment && session.familySlug ? `/concours/${encodeURIComponent(session.familySlug)}` : '/app';

  let primaryLabel: string;
  if (exam) primaryLabel = isLast ? tr({ ar: 'إنهاء وتسليم', fr: 'Terminer et rendre' }) : tr({ ar: 'التالي', fr: 'Suivant' });
  else if (!fb) primaryLabel = limitHit ? tr({ ar: 'إنهاء الجلسة', fr: 'Terminer la session' }) : tr({ ar: 'تحقّق', fr: 'Valider' });
  else if ((isLast && allDone) || limitHit) primaryLabel = tr({ ar: 'عرض النتيجة', fr: 'Voir le résultat' });
  else if (isLast) primaryLabel = tr({ ar: 'الأسئلة المتبقية', fr: 'Questions restantes' });
  else primaryLabel = tr({ ar: 'السؤال التالي', fr: 'Question suivante' });
  const primaryDisabled = !exam && !fb && !limitHit && !complete;

  return (
    <div className="flex flex-col gap-4">
      {/* Screen-reader announcements: answer feedback and timer warnings. */}
      <p className="sr-only" aria-live="assertive" role="status">{announce}</p>

      {/* ── Header ── */}
      <div className="sticky top-14 z-20 -mx-4 flex flex-col gap-2 border-b border-border bg-bg/95 px-4 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setExitOpen(true)} className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-surface-2" aria-label={tr({ ar: 'خروج', fr: 'Quitter' })}>
            <X className="size-5" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-sm font-bold">{tr(KIND_LABELS[session.kind])}</h1>
            <span className="text-xs text-muted tabular-nums">
              {tr({ ar: `السؤال ${index + 1} من ${N}`, fr: `Question ${index + 1} sur ${N}` })}
              {section && <> · {tr({ ar: `القسم ${sectionNo}`, fr: `Section ${sectionNo}` })}: {tr(DOMAIN_LABELS[section.domain])}</>}
            </span>
          </div>
          {remaining != null ? (
            <span
              className={clsx('inline-flex min-h-9 items-center gap-1 rounded-xl px-2.5 text-sm font-bold tabular-nums', lowTime ? 'bg-danger-soft text-danger' : 'bg-surface-2')}
              role="timer"
              aria-label={tr({ ar: `الوقت المتبقي ${clock(remaining)}`, fr: `Temps restant ${clock(remaining)}` })}
              dir="ltr"
            >
              <Timer className="size-4" aria-hidden />{clock(remaining)}
            </span>
          ) : exam ? (
            <span className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-surface-2 px-2.5 text-sm font-semibold tabular-nums text-muted" dir="ltr" aria-label={tr({ ar: 'الوقت المنقضي', fr: 'Temps écoulé' })}>
              <Timer className="size-4" aria-hidden />{clock(elapsed)}
            </span>
          ) : null}
          <button type="button" onClick={() => setGridOpen(true)} className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-surface-2" aria-label={tr({ ar: 'كل الأسئلة', fr: 'Toutes les questions' })}>
            <Grid3x3 className="size-5" aria-hidden />
          </button>
        </div>
        <ProgressBar value={(answeredCount / Math.max(1, N)) * 100} label={tr({ ar: `أجبت عن ${answeredCount} من ${N}`, fr: `${answeredCount} réponse(s) sur ${N}` })} />
      </div>

      {(sync.pending > 0 || !online) && (
        <div className="inline-flex items-center gap-2 self-center rounded-full bg-warning-soft px-3 py-1.5 text-xs font-semibold text-warning" role="status">
          <CloudOff className="size-4" aria-hidden />
          {sync.pending > 0
            ? tr({ ar: `غير متصل — ستتم مزامنة ${nOf('ar', sync.pending, 'answer')} لاحقًا`, fr: `Hors ligne — ${nOf('fr', sync.pending, 'answer')} à synchroniser` })
            : tr({ ar: 'غير متصل — ستتم مزامنة الإجابات عند عودة الاتصال', fr: 'Hors ligne — les réponses seront synchronisées' })}
        </div>
      )}

      {lowTime && !timeUp && remaining! > 0 && (
        <Alert tone="danger" title={remaining! <= LAST_MINUTE_S ? tr({ ar: 'أقل من دقيقة!', fr: 'Moins d’une minute !' }) : tr({ ar: 'تبقّت أقل من 5 دقائق', fr: 'Moins de 5 minutes restantes' })}>
          {tr({ ar: 'سيتم تسليم إجاباتك تلقائيًا عند انتهاء الوقت. راجع الأسئلة المعلّمة وغير المجابة.', fr: 'Vos réponses seront rendues automatiquement à la fin du temps. Vérifiez les questions marquées et sans réponse.' })}
        </Alert>
      )}
      {timeUp && (
        <Alert tone="warning" title={tr({ ar: 'انتهى الوقت', fr: 'Temps écoulé' })}>
          {submitError?.code === 'NETWORK'
            ? tr({ ar: 'لا يوجد اتصال. سنعيد المحاولة تلقائيًا — لا تغلق الصفحة.', fr: 'Pas de connexion. Nouvel essai automatique — ne fermez pas la page.' })
            : tr({ ar: 'جارٍ تسليم إجاباتك…', fr: 'Envoi de vos réponses…' })}
        </Alert>
      )}
      {index === 0 && exam && answeredCount === 0 && (
        <Alert tone="info">
          {tr({ ar: 'وضع الامتحان: لن تظهر الإجابات الصحيحة إلا بعد التسليم. يمكنك التنقل بين الأسئلة وتعليم ما تريد مراجعته.', fr: 'Mode examen : les corrigés s’affichent après la remise. Vous pouvez naviguer entre les questions et marquer celles à revoir.' })}
        </Alert>
      )}
      {!!session.shortfall && index === 0 && (
        <p className="text-xs text-muted">{tr({ ar: 'ملاحظة: بعض الأقسام اكتملت بأسئلة من مواد قريبة لأن بنك الأسئلة لا يزال يتوسع.', fr: 'Note : certaines sections sont complétées par des questions de matières proches, la banque de questions grandit encore.' })}</p>
      )}

      {/* ── Question ── */}
      <article className="card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby={`stem-${q.id}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="primary">{tr(DOMAIN_LABELS[q.domain])}</Badge>
          <Badge>{tr(DIFFICULTY_TEXT[q.difficulty])}</Badge>
          {q.unreviewed && (
            <Badge tone="warning" title={tr({ ar: 'هذا السؤال لم يراجعه محرر بشري بعد. إن وجدت خطأ أبلغ عنه.', fr: 'Question pas encore relue par un éditeur. Signalez toute erreur.' })}>
              <TriangleAlert className="size-3.5" aria-hidden />{tr({ ar: 'محتوى قيد المراجعة', fr: 'Contenu en cours de relecture' })}
            </Badge>
          )}
          {session.blueprintFidelity && index === 0 && (
            <Badge tone={FIDELITY_TEXT[session.blueprintFidelity].tone}>{tr(FIDELITY_TEXT[session.blueprintFidelity])}</Badge>
          )}
          <span className="ms-auto flex items-center">
            {exam && (
              <button
                type="button"
                onClick={toggleFlag}
                aria-pressed={flags.has(q.id)}
                className={clsx('inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold hover:bg-surface-2', flags.has(q.id) ? 'text-warning' : 'text-muted')}
              >
                {flags.has(q.id) ? <FlagOff className="size-4" aria-hidden /> : <Flag className="size-4" aria-hidden />}
                <span className="hidden sm:inline">{flags.has(q.id) ? tr({ ar: 'إلغاء التعليم', fr: 'Retirer la marque' }) : tr({ ar: 'علّم للمراجعة', fr: 'À revoir' })}</span>
                <span className="sr-only sm:hidden">{tr({ ar: 'علّم للمراجعة', fr: 'Marquer à revoir' })}</span>
              </button>
            )}
            <BookmarkButton key={q.id} questionId={q.id} initial={!!q.bookmarked} compact onChange={(v) => setQs((l) => l.map((x) => (x.id === q.id ? { ...x, bookmarked: v } : x)))} />
          </span>
        </div>

        <div ref={stemRef} tabIndex={-1} className="outline-none">
          <QuestionStem q={q} id={`stem-${q.id}`} scale={scale} as="h2" />
        </div>

        <QuestionInput q={q} draft={draft} onChange={(d) => onDraft(q.id, d)} reveal={revealed} disabled={locked} labelledBy={`stem-${q.id}`} scale={scale} />

        {exam && q.id in answers && !locked && (
          <button type="button" onClick={() => onDraft(q.id, draftFrom(q, null))} className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-xl px-2 text-sm text-muted hover:bg-surface-2 hover:text-text">
            <Eraser className="size-4" aria-hidden />{tr({ ar: 'مسح الإجابة', fr: 'Effacer la réponse' })}
          </button>
        )}

        {/* Instant feedback */}
        <div aria-live="polite">
          {!exam && fb?.state === 'graded' && (
            <div className={clsx('flex flex-col gap-3 rounded-2xl p-4', fb.isCorrect ? 'bg-success-soft' : 'bg-danger-soft')}>
              <p className={clsx('flex items-center gap-2 text-lg font-extrabold', fb.isCorrect ? 'text-success' : 'text-danger')}>
                {fb.isCorrect ? <CircleCheck className="size-6" aria-hidden /> : <CircleX className="size-6" aria-hidden />}
                {fb.isCorrect ? tr({ ar: 'إجابة صحيحة!', fr: 'Bonne réponse !' }) : tr({ ar: 'إجابة خاطئة', fr: 'Mauvaise réponse' })}
              </p>
              {q.explanation && (
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-bold">{tr({ ar: 'الشرح', fr: 'Explication' })}</h3>
                  <p className="whitespace-pre-line text-[15px] leading-relaxed" lang={q.language} dir="auto">{q.explanation}</p>
                </div>
              )}
              <TutorPanel
                key={q.id}
                q={q}
                answer={answers[q.id] ?? null}
                onPaywall={() => setPaywall('tutor')}
                practiceBusy={practice.busy === 'similar'}
                onPractice={(topicKey) => void practice.start({ kind: 'PRACTICE', topicKey, count: 5, ...(session.familySlug ? { familySlug: session.familySlug } : {}) }, 'similar')}
              />
              {practice.error && <p className="text-sm text-danger" role="alert">{tr(practice.error)}</p>}
            </div>
          )}
          {!exam && fb?.state === 'queued' && (
            <div className="flex items-center gap-2 rounded-2xl bg-warning-soft p-4 text-sm text-warning">
              <CloudOff className="size-5 shrink-0" aria-hidden />
              {tr({ ar: 'تم حفظ إجابتك على الجهاز. سيظهر التصحيح عند عودة الاتصال.', fr: 'Réponse enregistrée sur l’appareil. La correction s’affichera au retour de la connexion.' })}
            </div>
          )}
        </div>

        {limitHit && !exam && (
          <Alert tone="warning" title={tr({ ar: 'بلغت حد الأسئلة المجانية لليوم', fr: 'Limite gratuite du jour atteinte' })}>
            <span className="flex flex-wrap items-center gap-2">
              {tr({ ar: 'أنهِ الجلسة لرؤية نتيجتك، وعد غدًا أو اشترك لمواصلة التدرب.', fr: 'Terminez la session pour voir votre résultat ; revenez demain ou passez Premium pour continuer.' })}
              <button type="button" onClick={() => setPaywall('limit')} className="font-semibold underline">{tr({ ar: 'العروض', fr: 'Les offres' })}</button>
            </span>
          </Alert>
        )}
        {notice && <Alert tone="danger">{tr(notice)}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted">
          <span dir="auto">
            {tr({ ar: 'الموضوع:', fr: 'Thème :' })} {locale === 'fr' ? q.topicTitle_fr || q.topicTitle_ar : q.topicTitle_ar || q.topicTitle_fr}
            {localSourceLabel(q.sourceLabel, locale) && <> · {localSourceLabel(q.sourceLabel, locale)}</>}
          </span>
          <ReportButton questionId={q.id} />
        </div>
      </article>

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => changeScale(-1)} disabled={scale === 0} className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-surface-2 disabled:opacity-40" aria-label={tr({ ar: 'تصغير النص', fr: 'Réduire le texte' })}>
            <Minus className="size-4" aria-hidden />
          </button>
          <span aria-hidden className="font-bold">A</span>
          <button type="button" onClick={() => changeScale(1)} disabled={scale === 2} className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-surface-2 disabled:opacity-40" aria-label={tr({ ar: 'تكبير النص', fr: 'Agrandir le texte' })}>
            <Plus className="size-4" aria-hidden />
          </button>
        </span>
        <span className="hidden items-center gap-1.5 md:inline-flex">
          <Keyboard className="size-4" aria-hidden />
          {exam
            ? tr({ ar: '1-4 للاختيار · Enter للتالي · F للتعليم', fr: '1-4 pour choisir · Entrée : suivant · F : marquer' })
            : tr({ ar: '1-4 للاختيار · Enter للتحقق ثم للتالي', fr: '1-4 pour choisir · Entrée : valider puis suivant' })}
        </span>
      </div>

      {/* ── Action bar ── */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="lg" onClick={() => goTo(index - 1)} disabled={index === 0 || submitting} aria-label={tr({ ar: 'السؤال السابق', fr: 'Question précédente' })} className="px-4">
            <PrevIcon className="size-5" aria-hidden />
          </Button>
          {exam && !isLast && (
            <Button variant="ghost" size="lg" onClick={requestSubmit} disabled={submitting || timeUp} className="hidden sm:inline-flex">
              <Send className="size-4" aria-hidden />{tr({ ar: 'تسليم', fr: 'Rendre' })}
            </Button>
          )}
          <Button size="lg" block onClick={primary} disabled={primaryDisabled || timeUp} loading={checking || submitting}>
            {primaryLabel}
            {!(exam && isLast) && !(fb && (isLast || limitHit)) && <NextIcon className="size-5" aria-hidden />}
          </Button>
        </div>
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4" role="status">
          <span className="inline-flex items-center gap-2 rounded-full bg-text px-4 py-2 text-sm font-bold text-bg shadow-lg">
            {toast.icon === 'xp' ? <Zap className="size-4 text-warning" aria-hidden /> : <Award className="size-4 text-warning" aria-hidden />}
            <span dir="auto">{toast.text}</span>
          </span>
        </div>
      )}

      {/* ── Navigator grid ── */}
      <Modal open={gridOpen} onClose={() => setGridOpen(false)} title={tr({ ar: 'كل الأسئلة', fr: 'Toutes les questions' })}>
        <div className="flex flex-col gap-4">
          <ul className="flex flex-wrap gap-3 text-xs text-muted">
            {exam ? (
              <>
                <li className="flex items-center gap-1"><span className="size-3 rounded bg-primary" aria-hidden />{tr({ ar: 'مُجاب', fr: 'Répondue' })}</li>
                <li className="flex items-center gap-1"><span className="size-3 rounded border border-border bg-surface" aria-hidden />{tr({ ar: 'دون إجابة', fr: 'Sans réponse' })}</li>
                <li className="flex items-center gap-1"><Flag className="size-3 text-warning" aria-hidden />{tr({ ar: 'معلّم للمراجعة', fr: 'À revoir' })}</li>
              </>
            ) : (
              <>
                <li className="flex items-center gap-1"><CircleCheck className="size-3 text-success" aria-hidden />{tr({ ar: 'صحيح', fr: 'Correct' })}</li>
                <li className="flex items-center gap-1"><CircleX className="size-3 text-danger" aria-hidden />{tr({ ar: 'خطأ', fr: 'Faux' })}</li>
                <li className="flex items-center gap-1"><span className="size-3 rounded border border-border bg-surface" aria-hidden />{tr({ ar: 'دون إجابة', fr: 'Sans réponse' })}</li>
              </>
            )}
          </ul>
          {(session.sections?.length ? session.sections.map((s, k) => ({ title: `${tr({ ar: `القسم ${k + 1}`, fr: `Section ${k + 1}` })} · ${tr(DOMAIN_LABELS[s.domain])}`, from: s.start, to: s.end })) : [{ title: '', from: 0, to: N }]).map((grp) => (
            <div key={`${grp.from}-${grp.to}`} className="flex flex-col gap-2">
              {grp.title && <h3 className="text-sm font-bold">{grp.title}</h3>}
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                {qs.slice(grp.from, grp.to).map((x, k) => {
                  const i = grp.from + k;
                  const done = x.id in answers;
                  const f = feedback[x.id];
                  const flagged = flags.has(x.id);
                  const state = exam
                    ? `${done ? tr({ ar: 'مُجاب', fr: 'répondue' }) : tr({ ar: 'دون إجابة', fr: 'sans réponse' })}${flagged ? `، ${tr({ ar: 'معلّم', fr: 'marquée' })}` : ''}`
                    : f?.state === 'graded' ? (f.isCorrect ? tr({ ar: 'صحيح', fr: 'correct' }) : tr({ ar: 'خطأ', fr: 'faux' })) : done ? tr({ ar: 'محفوظ', fr: 'enregistrée' }) : tr({ ar: 'دون إجابة', fr: 'sans réponse' });
                  return (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => goTo(i)}
                      aria-current={i === index ? 'step' : undefined}
                      aria-label={`${tr({ ar: 'السؤال', fr: 'Question' })} ${i + 1} — ${state}`}
                      className={clsx(
                        'relative inline-flex h-11 items-center justify-center rounded-xl border text-sm font-bold tabular-nums',
                        exam && done && 'border-primary bg-primary text-primary-contrast',
                        !exam && f?.state === 'graded' && (f.isCorrect ? 'border-success bg-success-soft text-success' : 'border-danger bg-danger-soft text-danger'),
                        !exam && f?.state === 'queued' && 'border-warning bg-warning-soft text-warning',
                        !done && 'border-border bg-surface',
                        i === index && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
                      )}
                    >
                      {i + 1}
                      {flagged && <Flag className="absolute -end-1 -top-1 size-3.5 fill-warning text-warning" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-sm text-muted tabular-nums">{tr({ ar: `أجبت عن ${answeredCount} من ${N}`, fr: `${answeredCount} réponse(s) sur ${N}` })}</p>
          {(exam || allDone || answeredCount > 0) && (
            <Button onClick={() => { setGridOpen(false); requestSubmit(); }} disabled={submitting || timeUp}>
              <Send className="size-4" aria-hidden />{exam ? tr({ ar: 'إنهاء وتسليم', fr: 'Terminer et rendre' }) : tr({ ar: 'إنهاء الجلسة', fr: 'Terminer la session' })}
            </Button>
          )}
        </div>
      </Modal>

      {/* ── Submit confirmation ── */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={exam ? tr({ ar: 'تسليم الامتحان؟', fr: 'Rendre la copie ?' }) : tr({ ar: 'إنهاء الجلسة؟', fr: 'Terminer la session ?' })}>
        <div className="flex flex-col gap-4">
          <p className="tabular-nums">{tr({ ar: `أجبت عن ${answeredCount} من ${nOf('ar', N, 'question')}.`, fr: `Vous avez répondu à ${answeredCount} question(s) sur ${N}.` })}</p>
          {unanswered.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-warning">
                {tr({ ar: `${unanswered.length} دون إجابة (تُحتسب خاطئة):`, fr: `${unanswered.length} sans réponse (comptées fausses) :` })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unanswered.slice(0, 40).map(({ x, i }) => (
                  <button key={x.id} type="button" onClick={() => goTo(i)} className="inline-flex size-11 items-center justify-center rounded-xl border border-border text-sm font-bold tabular-nums hover:bg-surface-2" aria-label={`${tr({ ar: 'السؤال', fr: 'Question' })} ${i + 1}`}>
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
          {flaggedList.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-1 text-sm font-semibold"><Flag className="size-4 text-warning" aria-hidden />{tr({ ar: 'معلّمة للمراجعة:', fr: 'Marquées à revoir :' })}</p>
              <div className="flex flex-wrap gap-1.5">
                {flaggedList.map(({ x, i }) => (
                  <button key={x.id} type="button" onClick={() => goTo(i)} className="inline-flex size-11 items-center justify-center rounded-xl border border-warning/50 bg-warning-soft text-sm font-bold tabular-nums" aria-label={`${tr({ ar: 'السؤال', fr: 'Question' })} ${i + 1}`}>
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
          {submitError?.pending ? (
            <Alert tone="warning" title={tr({ ar: 'إجابات غير مُزامنة', fr: 'Réponses non synchronisées' })}>
              <span className="flex flex-col gap-2">
                {tr({ ar: `${nOf('ar', submitError.pending, 'answer')} لم تصل بعد إلى الخادم. تحقق من الاتصال ثم أعد المحاولة، وإلا فستُحتسب دون إجابة.`, fr: `${nOf('fr', submitError.pending, 'answer')} pas encore parvenue(s) au serveur. Vérifiez la connexion et réessayez, sinon elles compteront comme sans réponse.` })}
                <span className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void submit()} loading={submitting}>{tr({ ar: 'أعد المحاولة', fr: 'Réessayer' })}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void submit({ force: true })} disabled={submitting}>{tr({ ar: 'سلّم رغم ذلك', fr: 'Rendre quand même' })}</Button>
                </span>
              </span>
            </Alert>
          ) : submitError?.code ? (
            <Alert tone="danger">{tr(errorText(submitError.code))}</Alert>
          ) : null}
          {exam && session.expiresAt && remaining != null && remaining > 0 && (
            <p className="text-sm text-muted">{tr({ ar: `لا يزال لديك ${clock(remaining)} — استغلّها لمراجعة إجاباتك.`, fr: `Il vous reste ${clock(remaining)} — profitez-en pour relire.` })}</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button size="lg" onClick={() => void submit()} loading={submitting} className="sm:flex-1">
              <Send className="size-4" aria-hidden />{exam ? tr({ ar: 'تسليم نهائي', fr: 'Rendre définitivement' }) : tr({ ar: 'إنهاء وعرض النتيجة', fr: 'Terminer et voir le résultat' })}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setConfirmOpen(false)}>{tr({ ar: 'مواصلة', fr: 'Continuer' })}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Exit ── */}
      <Modal open={exitOpen} onClose={() => setExitOpen(false)} title={tr({ ar: 'الخروج من الجلسة؟', fr: 'Quitter la session ?' })}>
        <div className="flex flex-col gap-4">
          <p>{tr({ ar: 'إجاباتك محفوظة ويمكنك استئناف الجلسة لاحقًا من الصفحة الرئيسية.', fr: 'Vos réponses sont enregistrées : vous pourrez reprendre la session plus tard depuis l’accueil.' })}</p>
          {session.expiresAt && <Alert tone="warning">{tr({ ar: 'تنبيه: توقيت الامتحان التجريبي يستمر حتى لو خرجت.', fr: 'Attention : le chrono de l’examen blanc continue même si vous quittez.' })}</Alert>}
          {sync.pending > 0 && <Alert tone="warning">{tr({ ar: 'بعض الإجابات لم تتم مزامنتها بعد؛ ستُرسل عند عودتك إلى هذه الجلسة متصلًا.', fr: 'Certaines réponses ne sont pas encore synchronisées ; elles partiront quand vous rouvrirez la session en ligne.' })}</Alert>}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <ButtonLink href={exitHref} variant="secondary" size="lg" className="sm:flex-1">{tr({ ar: 'خروج', fr: 'Quitter' })}</ButtonLink>
            <Button size="lg" onClick={() => setExitOpen(false)} className="sm:flex-1">{tr({ ar: 'مواصلة', fr: 'Continuer' })}</Button>
          </div>
        </div>
      </Modal>

      <PaywallModal reason={paywall ?? practice.paywall} onClose={() => { setPaywall(null); practice.closePaywall(); }} from={`session_${session.kind.toLowerCase()}`} />
    </div>
  );
}

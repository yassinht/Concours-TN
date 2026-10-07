'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { Bookmark, BookmarkCheck, BookOpen, Bot, CircleCheck, Dumbbell, ExternalLink, Flag, Sparkles } from 'lucide-react';
import type { QuestionDTO, TutorResponseDTO } from '@ctn/shared';
import { Alert, Badge, Button, Field, Modal, Select, Textarea } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { errorCode } from '@/components/app/use-api';
import { bi, errorText } from '@/components/app/format';
import { api } from '@/lib/api';
import { nOf, REPORT_REASONS } from './labels';

// ───────── Bookmark ─────────

export function BookmarkButton({ questionId, initial, onChange, compact }: { questionId: string; initial: boolean; onChange?: (v: boolean) => void; compact?: boolean }) {
  const tr = useT();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      await api(`/me/bookmarks/${questionId}`, { method: next ? 'POST' : 'DELETE', body: next ? {} : undefined });
      onChange?.(next);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }
  const Icon = on ? BookmarkCheck : Bookmark;
  const label = on ? tr({ ar: 'محفوظ في المفضلة', fr: 'Dans mes favoris' }) : tr({ ar: 'احفظ السؤال', fr: 'Enregistrer la question' });
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={compact ? label : undefined}
      title={label}
      className={clsx('inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition hover:bg-surface-2', on ? 'text-primary' : 'text-muted')}
    >
      <Icon className={clsx('size-5', on && 'fill-current')} aria-hidden />
      {!compact && <span>{label}</span>}
    </button>
  );
}

// ───────── Report ─────────

export function ReportButton({ questionId }: { questionId: string }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]['value']>('WRONG_ANSWER');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState('sending');
    setError(null);
    try {
      await api(`/questions/${questionId}/report`, { body: { reason, ...(comment.trim() ? { comment: comment.trim().slice(0, 1000) } : {}) } });
      setState('sent');
    } catch (e) {
      setError(errorCode(e));
      setState('idle');
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setState('idle'); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm text-muted hover:bg-surface-2 hover:text-text">
        <Flag className="size-4" aria-hidden />
        {tr({ ar: 'أبلغ عن مشكلة', fr: 'Signaler un problème' })}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={tr({ ar: 'الإبلاغ عن مشكلة في السؤال', fr: 'Signaler un problème' })}>
        {state === 'sent' ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <CircleCheck className="size-10 text-success" aria-hidden />
            <p className="font-semibold" role="status">{tr({ ar: 'شكرًا! سيراجع فريق التحرير هذا السؤال.', fr: 'Merci ! L’équipe éditoriale va vérifier cette question.' })}</p>
            <p className="text-sm text-muted">{tr({ ar: 'ملاحظاتك تساعد كل المترشحين على التدرب بمحتوى دقيق.', fr: 'Vos retours aident tous les candidats à réviser avec un contenu exact.' })}</p>
            <Button variant="secondary" onClick={() => setOpen(false)}>{tr({ ar: 'إغلاق', fr: 'Fermer' })}</Button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <Field label={tr({ ar: 'نوع المشكلة', fr: 'Type de problème' })} htmlFor={`rr-${questionId}`}>
              <Select id={`rr-${questionId}`} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                {REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{tr(r.label)}</option>)}
              </Select>
            </Field>
            <Field label={tr({ ar: 'تفاصيل (اختياري)', fr: 'Détails (facultatif)' })} htmlFor={`rc-${questionId}`} hint={tr({ ar: 'إن أمكن، اذكر المصدر الذي يثبت الإجابة الصحيحة.', fr: 'Si possible, citez la source qui justifie la bonne réponse.' })}>
              <Textarea id={`rc-${questionId}`} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} dir="auto" />
            </Field>
            {error && <Alert tone="danger">{tr(errorText(error))}</Alert>}
            <Button type="submit" loading={state === 'sending'}>{tr({ ar: 'إرسال', fr: 'Envoyer' })}</Button>
          </form>
        )}
      </Modal>
    </>
  );
}

// ───────── Tutor ─────────

function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * "Explain more" for an answered question: POST /tutor/explain. Shows why the answer was wrong, the concept, an example,
 * a way to practise similar questions, the lesson to review and the sources. 402 → paywall (handled by the caller).
 */
export function TutorPanel({ q, answer, onPaywall, onPractice, practiceBusy }: {
  q: QuestionDTO;
  answer: unknown;
  onPaywall: () => void;
  onPractice: (topicKey: string) => void;
  practiceBusy?: boolean;
}) {
  const tr = useT();
  const { locale } = useLocale();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [data, setData] = useState<TutorResponseDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function explain() {
    setState('loading');
    setError(null);
    try {
      const r = await api<TutorResponseDTO>('/tutor/explain', { body: { questionId: q.id, answer: answer ?? null, locale } });
      setData(r);
      setState('done');
    } catch (e) {
      const code = errorCode(e);
      setState('idle');
      if (code === 'LIMIT_REACHED') onPaywall();
      else setError(code);
    }
  }

  if (state !== 'done' || !data) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={explain} loading={state === 'loading'} className="self-start">
          <Bot className="size-4" aria-hidden />
          {tr({ ar: 'اشرح لي أكثر', fr: 'Expliquez-moi plus' })} <span aria-hidden>🤖</span>
        </Button>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error === 'NOT_ANSWERED'
              ? tr({ ar: 'أجب عن السؤال أولًا.', fr: 'Répondez d’abord à la question.' })
              : error === 'EXAM_IN_PROGRESS'
                ? tr({ ar: 'الشرح متاح بعد إنهاء الامتحان.', fr: 'Disponible après la fin de l’examen.' })
                : tr(errorText(error))}
          </p>
        )}
      </div>
    );
  }

  const topicKey = data.review_topic?.key ?? q.topicKey;
  const blocks = [
    { title: { ar: 'لماذا؟', fr: 'Pourquoi ?' }, body: data.why_wrong },
    { title: { ar: 'المفهوم', fr: 'La notion' }, body: data.concept },
    { title: { ar: 'مثال', fr: 'Exemple' }, body: data.example },
  ].filter((b) => b.body && b.body.trim());

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-info/30 bg-info-soft/60 p-4" aria-label={tr({ ar: 'شرح المساعد', fr: 'Explication du tuteur' })}>
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-5 text-info" aria-hidden />
        <h3 className="font-bold">{tr({ ar: 'المساعد', fr: 'Le tuteur' })}</h3>
        {data.ai
          ? <Badge tone="info"><Sparkles className="size-3.5" aria-hidden />{tr({ ar: 'ذكاء اصطناعي', fr: 'IA' })}</Badge>
          : <Badge tone="neutral">{tr({ ar: 'شرح مبسّط', fr: 'Explication simplifiée' })}</Badge>}
        {data.remainingToday != null && (
          <span className="ms-auto text-xs text-muted">
            {tr({ ar: `المتبقي اليوم: ${nOf('ar', data.remainingToday, 'explanation')} مجانًا`, fr: `Reste aujourd’hui : ${nOf('fr', data.remainingToday, 'explanation')} gratuite(s)` })}
          </span>
        )}
      </div>
      {blocks.map((b) => (
        <div key={b.title.fr} className="flex flex-col gap-1">
          <h4 className="text-sm font-bold text-info">{tr(b.title)}</h4>
          <p className="whitespace-pre-line text-[15px] leading-relaxed" dir="auto">{b.body}</p>
        </div>
      ))}
      {data.similar_question && (
        <div className="rounded-xl bg-surface p-3">
          <p className="mb-1 text-xs font-bold text-muted">{tr({ ar: 'سؤال مشابه للتدرب', fr: 'Question similaire' })}</p>
          <p className="text-sm font-semibold" lang={data.similar_question.language} dir="auto">{data.similar_question.stem}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" className="min-h-11" onClick={() => onPractice(topicKey)} loading={practiceBusy}>
          <Dumbbell className="size-4" aria-hidden />
          {tr({ ar: 'تدرّب على أسئلة مشابهة', fr: 'S’entraîner sur des questions similaires' })}
        </Button>
        <Link href={`/app/lesson/${encodeURIComponent(topicKey)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2">
          <BookOpen className="size-4" aria-hidden />
          {data.review_topic ? `${tr({ ar: 'راجع الدرس:', fr: 'Revoir :' })} ${bi(locale, data.review_topic.title_ar, data.review_topic.title_fr)}` : tr({ ar: 'راجع الدرس', fr: 'Revoir la leçon' })}
        </Link>
      </div>
      {data.citations.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-muted">
          <span className="font-bold">{tr({ ar: 'المصادر', fr: 'Sources' })}</span>
          <ul className="flex flex-col gap-1">
            {data.citations.map((c, i) => {
              const href = safeUrl(c.url);
              return (
                <li key={`${c.title}-${i}`} className="flex items-center gap-1">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-text" dir="auto">
                      {c.title}<ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : <span dir="auto">{c.title}</span>}
                  {c.sourceType === 'OFFICIAL' && <Badge tone="success">{tr({ ar: 'رسمي', fr: 'Officiel' })}</Badge>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {data.ai && (
        <p className="text-xs text-muted">{tr({ ar: 'شرح مولّد آليًا للمساعدة على الفهم وقد يحتوي على أخطاء؛ المرجع هو التصحيح أعلاه.', fr: 'Explication générée automatiquement pour aider à comprendre, elle peut contenir des erreurs ; le corrigé ci-dessus fait foi.' })}</p>
      )}
    </section>
  );
}

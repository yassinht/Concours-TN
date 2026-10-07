'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, CheckCheck, CircleAlert, Copy, Eye, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import type { Difficulty, Domain, QuestionType } from '@ctn/shared';
import { DIFFICULTIES, DOMAIN_LABELS, DOMAINS, QUESTION_TYPES } from '@ctn/shared/dist/enums';
import { Badge, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi } from './hooks';
import {
  CONTENT_STATUS_LABEL, DIFFICULTY_LABEL, describeError, fmtDateTime, fmtPct, LANGUAGE_LABEL, ORIGIN_LABEL, QUESTION_TYPE_LABEL, REPORT_REASON_LABEL,
  REPORT_STATUS_LABEL,
} from './labels';
import { SourcePicker, useFamilies } from './pickers';
import { correctIds, QuestionPreview } from './question-preview';
import { useAdmin } from './shell';
import { useToast } from './toast';
import { TopicObjectivesEditor, type TopicInfo } from './topic-picker';
import type { AdminQuestionDetail, AdminQuestionFull, QuestionOption, ReviewResult } from './types';
import { AdminPage, Checkbox, ErrorBox, ListInput, Loading, Section, StatusBadge, Toggle, useConfirm } from './ui';

type Lang = 'ar' | 'fr' | 'en';
const EDITOR_ORIGINS = ['AUTHORED', 'PAST_EXAM_VERBATIM', 'PAST_EXAM_REWRITTEN', 'ALGORITHMIC'] as const;
const TF_TEXT: Record<Lang, [string, string]> = { ar: ['صحيح', 'خطأ'], fr: ['Vrai', 'Faux'], en: ['True', 'False'] };
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

interface Draft {
  type: QuestionType; domain: Domain; language: Lang; difficulty: Difficulty;
  stem: string; options: QuestionOption[]; explanation: string;
  choice: string[]; numValue: string; numTolerance: string; pairs: Record<string, string>; order: string[];
  topicKey: string; objectiveKeys: string[]; familySlugs: string[]; isGeneral: boolean;
  sourceId: string | null; year: string; validUntil: string; tags: string[]; origin: string; extId: string;
}

const BLANK: Draft = {
  type: 'MCQ_SINGLE', domain: 'CULTURE_GENERALE', language: 'ar', difficulty: 'MEDIUM',
  stem: '', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }], explanation: '',
  choice: [], numValue: '', numTolerance: '', pairs: {}, order: [],
  topicKey: '', objectiveKeys: [], familySlugs: [], isGeneral: true, sourceId: null, year: '', validUntil: '', tags: [], origin: 'AUTHORED', extId: '',
};

function fromDetail(q: AdminQuestionDetail): Draft {
  const c = q.correct as { value?: number; tolerance?: number; pairs?: [string, string][]; order?: string[] } | null;
  return {
    type: q.type, domain: q.domain, language: (['ar', 'fr', 'en'].includes(q.language) ? q.language : 'ar') as Lang, difficulty: q.difficulty,
    stem: q.stem, options: q.options.map((o) => ({ ...o })), explanation: q.explanation,
    choice: correctIds(q.correct),
    numValue: c && typeof c.value === 'number' ? String(c.value) : '', numTolerance: c && typeof c.tolerance === 'number' ? String(c.tolerance) : '',
    pairs: Object.fromEntries((c?.pairs ?? []).map(([l, r]) => [l, r])),
    order: c?.order ?? q.options.map((o) => o.id),
    topicKey: q.topic.key, objectiveKeys: q.objectives.map((o) => o.key), familySlugs: q.families.map((f) => f.slug), isGeneral: q.isGeneral,
    sourceId: q.source?.id ?? null, year: q.year != null ? String(q.year) : '', validUntil: q.validUntil ?? '', tags: q.tags,
    origin: q.origin, extId: q.extId ?? '',
  };
}

function nextId(options: QuestionOption[], side?: 'left' | 'right'): string {
  const used = new Set(options.map((o) => o.id));
  if (side === 'right') {
    for (let i = 1; i < 100; i++) if (!used.has(String(i))) return String(i);
  }
  for (const l of LETTERS) if (!used.has(l)) return l;
  return `o${options.length + 1}`;
}

/** The answer key in the API's format for the draft's type. */
function correctOf(d: Draft): unknown {
  switch (d.type) {
    case 'MCQ_SINGLE':
    case 'MCQ_MULTI':
    case 'TRUE_FALSE':
      return d.choice.filter((id) => d.options.some((o) => o.id === id));
    case 'NUMERIC': {
      const value = Number(d.numValue.replace(',', '.'));
      const tol = d.numTolerance.trim() ? Number(d.numTolerance.replace(',', '.')) : undefined;
      return tol === undefined ? { value } : { value, tolerance: tol };
    }
    case 'MATCHING':
      return { pairs: d.options.filter((o) => o.side === 'left' && d.pairs[o.id]).map((o) => [o.id, d.pairs[o.id]] as [string, string]) };
    case 'ORDERING':
      return { order: syncOrder(d.order, d.options) };
  }
}

/** Keeps the ordering key a permutation of the current options (removed ones dropped, new ones appended). */
function syncOrder(order: string[], options: QuestionOption[]): string[] {
  const ids = options.map((o) => o.id);
  const kept = order.filter((id) => ids.includes(id));
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}

/** Client-side mirror of the API's validateQuestionContent + required fields, shown before saving. */
function validate(d: Draft): string[] {
  const issues: string[] = [];
  if (d.stem.trim().length < 3) issues.push('Énoncé trop court (3 caractères min.).');
  if (d.explanation.trim().length < 3) issues.push('Explication obligatoire (3 caractères min.).');
  if (!d.topicKey) issues.push('Choisissez un thème.');
  if (!d.objectiveKeys.length) issues.push('Cochez au moins un objectif.');
  if (!d.isGeneral && !d.familySlugs.length) issues.push('Question non générale : liez-la à au moins un concours.');
  const opts = d.type === 'NUMERIC' ? [] : d.options;
  const ids = opts.map((o) => o.id);
  if (new Set(ids).size !== ids.length) issues.push('Identifiants d’options en double.');
  opts.forEach((o, i) => { if (!o.text.trim()) issues.push(`Option ${i + 1} vide.`); });
  switch (d.type) {
    case 'MCQ_SINGLE':
    case 'TRUE_FALSE':
    case 'MCQ_MULTI': {
      if (d.type === 'TRUE_FALSE' && opts.length !== 2) issues.push('Vrai/Faux : exactement 2 options.');
      else if (opts.length < 2) issues.push('Au moins 2 options.');
      if (opts.length > 10) issues.push('10 options au maximum.');
      const keys = correctOf(d) as string[];
      if (d.type !== 'MCQ_MULTI' && keys.length !== 1) issues.push('Cochez exactement une bonne réponse.');
      if (d.type === 'MCQ_MULTI' && keys.length < 1) issues.push('Cochez au moins une bonne réponse.');
      if (d.type === 'MCQ_MULTI' && keys.length === opts.length && opts.length > 0) issues.push('Toutes les options sont correctes : ce n’est pas une vraie question.');
      break;
    }
    case 'NUMERIC': {
      if (!d.numValue.trim() || !Number.isFinite(Number(d.numValue.replace(',', '.')))) issues.push('Valeur attendue numérique obligatoire.');
      if (d.numTolerance.trim() && !(Number(d.numTolerance.replace(',', '.')) >= 0)) issues.push('Tolérance ≥ 0.');
      break;
    }
    case 'MATCHING': {
      const lefts = opts.filter((o) => o.side === 'left');
      const rights = opts.filter((o) => o.side === 'right');
      if (lefts.length < 2 || rights.length < 2) issues.push('Appariement : au moins 2 éléments à gauche et 2 à droite.');
      if (lefts.length + rights.length !== opts.length) issues.push('Chaque option doit avoir un côté (gauche/droite).');
      if (lefts.some((l) => !d.pairs[l.id] || !rights.some((r) => r.id === d.pairs[l.id]))) issues.push('Associez chaque élément de gauche à un élément de droite.');
      break;
    }
    case 'ORDERING':
      if (opts.length < 2) issues.push('Au moins 2 éléments à ordonner.');
      break;
  }
  if (d.year && !/^\d{4}$/.test(d.year)) issues.push('Année sur 4 chiffres.');
  if (d.extId && !/^[A-Za-z0-9._:-]+$/.test(d.extId)) issues.push('Identifiant externe : lettres, chiffres, . _ : - uniquement.');
  return issues;
}

function toBody(d: Draft, originalOrigin: string | null) {
  return {
    type: d.type, domain: d.domain, language: d.language, stem: d.stem.trim(),
    options: d.type === 'NUMERIC' ? [] : d.options.map((o) => (d.type === 'MATCHING' ? { id: o.id, text: o.text.trim(), side: o.side ?? 'left' } : { id: o.id, text: o.text.trim() })),
    correct: correctOf(d), explanation: d.explanation.trim(), difficulty: d.difficulty,
    topicKey: d.topicKey, objectiveKeys: d.objectiveKeys, familySlugs: d.familySlugs, isGeneral: d.isGeneral,
    sourceId: d.sourceId, year: d.year ? Number(d.year) : null, validUntil: d.validUntil || null, tags: d.tags,
    // AI_GENERATED provenance is set by the pipeline only; editors keep it as is.
    ...(originalOrigin === 'AI_GENERATED' ? {} : { origin: d.origin }),
    extId: d.extId.trim() || null,
  };
}

export function QuestionEditorView({ id }: { id: string | null }) {
  const sp = useSearchParams();
  const fromReview = sp.get('from') === 'review';
  // /admin/questions/new?duplicate=<id>: a new question pre-filled from an existing one (variants of the same item).
  const duplicateId = !id ? sp.get('duplicate') : null;
  const { data, error, loading, reload, setData } = useAdminApi<AdminQuestionFull>(id ? `/admin/questions/${id}` : duplicateId ? `/admin/questions/${duplicateId}` : null);
  const pending = !!(id || duplicateId);
  if (pending && error && !data) return <AdminPage title="Question" back={{ href: '/admin/questions', label: 'Banque de questions' }}><ErrorBox error={error} onRetry={() => void reload()} /></AdminPage>;
  // Only the first load shows a spinner: reloads after a save keep the editor (and scroll position) on screen.
  if (pending && !data) return loading ? <Loading /> : null;
  if (!id) return <QuestionEditor key={`new:${duplicateId ?? ''}`} question={null} template={data ?? null} fromReview={false} onSaved={() => {}} reload={async () => undefined} />;
  return <QuestionEditor key={data ? `${data.id}:${data.version}:${data.status}` : 'new'} question={data ?? null} fromReview={fromReview} onSaved={(q) => setData(q)} reload={reload} />;
}

function QuestionEditor({ question, template, fromReview, onSaved, reload }: {
  question: AdminQuestionFull | null; template?: AdminQuestionDetail | null; fromReview: boolean; onSaved: (q: AdminQuestionFull) => void; reload: () => Promise<unknown>;
}) {
  const router = useRouter();
  const { refreshStats } = useAdmin();
  const { toast, toastError } = useToast();
  const confirm = useConfirm();
  const { families } = useFamilies();
  const initial = useMemo(() => {
    if (question) return fromDetail(question);
    if (!template) return BLANK;
    // A duplicate is a new authored item: provenance ids are not copied (ext ids are unique, AI origin is not ours).
    const d = fromDetail(template);
    return { ...d, extId: '', origin: d.origin === 'AI_GENERATED' ? 'AUTHORED' : d.origin };
  }, [question, template]);
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [serverIssues, setServerIssues] = useState<{ message: string; details: string[] } | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [familyFilter, setFamilyFilter] = useState('');

  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const issues = useMemo(() => validate(d), [d]);

  // Ctrl/Cmd+S saves (without publishing).
  const saveRef = useRef<(publish: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        void saveRef.current(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v })), []);

  function changeType(type: QuestionType) {
    setD((x) => {
      let options = x.options;
      if (type === 'TRUE_FALSE') {
        const [t, f] = TF_TEXT[x.language];
        options = [{ id: 'a', text: t }, { id: 'b', text: f }];
      } else if (type === 'MATCHING') {
        options = x.options.map((o, i) => ({ ...o, side: o.side ?? (i % 2 === 0 ? 'left' : 'right') }));
        if (options.length < 4) options = [{ id: 'a', text: '', side: 'left' }, { id: 'b', text: '', side: 'left' }, { id: '1', text: '', side: 'right' }, { id: '2', text: '', side: 'right' }];
      } else if (x.type === 'TRUE_FALSE' || x.type === 'NUMERIC' || !options.length) {
        options = BLANK.options.map((o) => ({ ...o }));
      } else {
        options = options.map(({ id, text }) => ({ id, text }));
      }
      return { ...x, type, options, choice: type === x.type ? x.choice : [], pairs: {}, order: options.map((o) => o.id) };
    });
  }

  function updateOption(i: number, patch: Partial<QuestionOption>) {
    setD((x) => {
      const prevId = x.options[i]?.id;
      const options = x.options.map((o, j) => (j === i ? { ...o, ...patch } : o));
      // Renaming an option id carries its answer-key references along.
      if (patch.id !== undefined && prevId !== undefined && patch.id !== prevId) {
        const ren = (v: string) => (v === prevId ? patch.id! : v);
        return {
          ...x, options,
          choice: x.choice.map(ren),
          pairs: Object.fromEntries(Object.entries(x.pairs).map(([l, r]) => [ren(l), ren(r)])),
          order: syncOrder(x.order.map(ren), options),
        };
      }
      return { ...x, options, order: syncOrder(x.order, options) };
    });
  }

  function changeLanguage(language: Lang) {
    setD((x) => {
      // Vrai/Faux labels follow the language when they are still the defaults.
      const isDefaultTf = x.type === 'TRUE_FALSE' && Object.values(TF_TEXT).some(([t, f]) => x.options[0]?.text === t && x.options[1]?.text === f);
      const options = isDefaultTf ? x.options.map((o, i) => ({ ...o, text: TF_TEXT[language][i] ?? o.text })) : x.options;
      return { ...x, language, options };
    });
  }
  function addOption(side?: 'left' | 'right') {
    setD((x) => {
      const options = [...x.options, { id: nextId(x.options, side), text: '', ...(x.type === 'MATCHING' ? { side: side ?? 'left' } : {}) }];
      return { ...x, options, order: syncOrder(x.order, options) };
    });
  }
  function removeOption(i: number) {
    setD((x) => {
      const gone = x.options[i]?.id;
      const options = x.options.filter((_, j) => j !== i);
      const pairs = Object.fromEntries(Object.entries(x.pairs).filter(([l, r]) => l !== gone && r !== gone));
      return { ...x, options, choice: x.choice.filter((c) => c !== gone), pairs, order: syncOrder(x.order, options) };
    });
  }
  function moveOrder(i: number, dir: -1 | 1) {
    setD((x) => {
      const order = syncOrder(x.order, x.options);
      const j = i + dir;
      if (j < 0 || j >= order.length) return x;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...x, order };
    });
  }

  const onTopicLoaded = useCallback((t: TopicInfo | null) => {
    // A new question takes the domain of its topic (still editable).
    if (t && !question) setD((x) => (x.domain === t.domain ? x : { ...x, domain: t.domain }));
  }, [question]);

  async function save(publish: boolean) {
    if (issues.length) {
      toast({ tone: 'warning', title: 'Corrigez la question avant d’enregistrer', details: issues });
      return;
    }
    if (publish) {
      const ok = await confirm.ask({
        title: 'Publier cette question ?',
        body: 'Vous en êtes le relecteur humain : elle sera servie aux candidats dans les entraînements et examens blancs.',
        tone: 'primary',
        confirmLabel: 'Enregistrer + publier',
      });
      if (!ok) return;
    }
    setBusy(true);
    setServerIssues(null);
    try {
      const body = toBody(d, question?.origin ?? null);
      const suffix = publish ? '?publish=true' : '';
      if (question) {
        const r = await api<AdminQuestionDetail & { changed: boolean }>(`/admin/questions/${question.id}${suffix}`, { method: 'PATCH', body });
        toast({ tone: 'success', title: r.changed ? `Enregistrée (v${r.version}) — ${CONTENT_STATUS_LABEL[r.status]}` : publish ? `Publiée — ${CONTENT_STATUS_LABEL[r.status]}` : 'Aucune modification' });
        const full = await reload();
        if (!full) onSaved({ ...question, ...r });
      } else {
        const r = await api<AdminQuestionDetail>(`/admin/questions${suffix}`, { method: 'POST', body });
        toast({ tone: 'success', title: `Question créée — ${CONTENT_STATUS_LABEL[r.status]}` });
        router.replace(`/admin/questions/${r.id}`);
      }
      void refreshStats();
    } catch (e) {
      const desc = describeError(e);
      setServerIssues({ message: desc.message, details: desc.details });
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  saveRef.current = save;

  async function changeStatus(action: 'archive' | 'to_draft') {
    if (!question) return;
    const r = await confirm.ask({
      title: action === 'archive' ? 'Archiver la question ?' : 'Repasser en brouillon ?',
      body: action === 'archive' ? 'Elle ne sera plus servie aux candidats.' : 'Elle sort de la publication jusqu’à une nouvelle relecture.',
      confirmLabel: action === 'archive' ? 'Archiver' : 'Repasser en brouillon',
      comment: { label: 'Commentaire', placeholder: 'Pourquoi ?' },
    });
    if (!r) return;
    setBusy(true);
    try {
      const res = await api<ReviewResult>(`/admin/review/question/${question.id}`, { method: 'POST', body: { action, ...(r.comment ? { comment: r.comment } : {}) } });
      toast({ tone: 'success', title: `${CONTENT_STATUS_LABEL[res.from]} → ${CONTENT_STATUS_LABEL[res.status]}` });
      await reload();
      void refreshStats();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const lefts = d.options.filter((o) => o.side === 'left');
  const rights = d.options.filter((o) => o.side === 'right');
  const order = syncOrder(d.order, d.options);
  const shownFamilies = families.filter((f) => !familyFilter || `${f.slug} ${f.name_fr} ${f.name_ar}`.toLowerCase().includes(familyFilter.toLowerCase()));
  const choice = d.type === 'MCQ_SINGLE' || d.type === 'MCQ_MULTI' || d.type === 'TRUE_FALSE';

  return (
    <AdminPage
      title={question ? 'Modifier la question' : 'Nouvelle question'}
      back={fromReview ? { href: '/admin/review', label: 'Retour à la revue' } : { href: '/admin/questions', label: 'Banque de questions' }}
      subtitle={question ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={question.status} /> <Badge tone="neutral">v{question.version}</Badge>
          <Badge tone={question.origin === 'AI_GENERATED' ? 'accent' : 'neutral'}>{ORIGIN_LABEL[question.origin] ?? question.origin}</Badge>
          {question.ai && <span className="text-xs">Modèle : {question.ai.model}</span>}
          {dirty && <Badge tone="warning">Modifications non enregistrées</Badge>}
        </span>
      ) : 'Enregistrer fait de vous le relecteur humain (statut « Relu »). Publier la rend visible aux candidats.'}
      actions={
        <>
          <Button variant="ghost" size="sm" className="xl:hidden" onClick={() => setShowPreview((v) => !v)}><Eye className="size-4" aria-hidden />{showPreview ? 'Masquer l’aperçu' : 'Aperçu'}</Button>
          {question && <Link href={`/admin/questions/new?duplicate=${question.id}`} className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-text"><Copy className="size-4" aria-hidden />Dupliquer</Link>}
          <Button variant="secondary" loading={busy} onClick={() => void save(false)} title="Ctrl+S"><Save className="size-4" aria-hidden />Enregistrer</Button>
          <Button loading={busy} onClick={() => void save(true)}><CheckCheck className="size-4" aria-hidden />Enregistrer + publier</Button>
        </>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
        <form className="flex min-w-0 flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
          {template && !question && (
            <div className="rounded-xl bg-info-soft p-3 text-sm" role="status">
              Copie de « {template.stem.slice(0, 80)}{template.stem.length > 80 ? '…' : ''} » : modifiez l’énoncé (une question identique dans le même thème est refusée).
            </div>
          )}
          {serverIssues && (
            <div className="rounded-xl bg-danger-soft p-3 text-sm" role="alert">
              <p className="flex items-center gap-1.5 font-semibold text-danger"><CircleAlert className="size-4" aria-hidden />{serverIssues.message}</p>
              {!!serverIssues.details.length && <ul className="list-disc ps-5">{serverIssues.details.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </div>
          )}

          <Section title="Format">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Type" htmlFor="q-type">
                <Select id="q-type" value={d.type} onChange={(e) => changeType(e.target.value as QuestionType)}>
                  {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
                </Select>
              </Field>
              <Field label="Langue" htmlFor="q-lang">
                <Select id="q-lang" value={d.language} onChange={(e) => changeLanguage(e.target.value as Lang)}>
                  {(['ar', 'fr', 'en'] as const).map((l) => <option key={l} value={l}>{LANGUAGE_LABEL[l]}</option>)}
                </Select>
              </Field>
              <Field label="Domaine" htmlFor="q-domain">
                <Select id="q-domain" value={d.domain} onChange={(e) => set('domain', e.target.value as Domain)}>
                  {DOMAINS.map((x) => <option key={x} value={x}>{DOMAIN_LABELS[x].fr}</option>)}
                </Select>
              </Field>
              <Field label="Difficulté" htmlFor="q-diff">
                <Select id="q-diff" value={d.difficulty} onChange={(e) => set('difficulty', e.target.value as Difficulty)}>
                  {DIFFICULTIES.map((x) => <option key={x} value={x}>{DIFFICULTY_LABEL[x]}</option>)}
                </Select>
              </Field>
            </div>
          </Section>

          <Section title="Contenu">
            <Field label="Énoncé" htmlFor="q-stem">
              <Textarea id="q-stem" rows={4} value={d.stem} onChange={(e) => set('stem', e.target.value)} dir="auto" lang={d.language} required />
            </Field>

            {d.type !== 'NUMERIC' && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold">
                  {d.type === 'ORDERING' ? 'Éléments à ordonner' : d.type === 'MATCHING' ? 'Éléments (gauche / droite)' : 'Options'}
                  {choice && <span className="ms-2 font-normal text-muted">{d.type === 'MCQ_MULTI' ? 'cochez toutes les bonnes réponses' : 'cochez la bonne réponse'}</span>}
                </legend>
                {d.options.map((o, i) => {
                  const isKey = d.choice.includes(o.id);
                  return (
                    <div key={i} className={clsx('flex flex-wrap items-center gap-2 rounded-xl border p-2', choice && isKey ? 'border-success bg-success-soft' : 'border-border')}>
                      {choice && (
                        <input
                          type={d.type === 'MCQ_MULTI' ? 'checkbox' : 'radio'}
                          name="q-correct"
                          checked={isKey}
                          onChange={() => set('choice', d.type === 'MCQ_MULTI' ? (isKey ? d.choice.filter((c) => c !== o.id) : [...d.choice, o.id]) : [o.id])}
                          className="size-5 shrink-0 accent-[var(--success)]"
                          aria-label={`Bonne réponse : option ${o.id}`}
                        />
                      )}
                      <Input aria-label={`Identifiant de l’option ${i + 1}`} value={o.id} onChange={(e) => updateOption(i, { id: e.target.value.trim() })} className="h-9 w-14 px-2 text-center text-sm" dir="ltr" />
                      {d.type === 'MATCHING' && (
                        <Select aria-label={`Côté de l’option ${o.id}`} value={o.side ?? 'left'} onChange={(e) => updateOption(i, { side: e.target.value as 'left' | 'right' })} className="h-9 w-28 text-sm">
                          <option value="left">Gauche</option>
                          <option value="right">Droite</option>
                        </Select>
                      )}
                      <Input aria-label={`Texte de l’option ${o.id}`} value={o.text} onChange={(e) => updateOption(i, { text: e.target.value })} dir="auto" lang={d.language} className="h-10 min-w-40 flex-1" />
                      {d.type !== 'TRUE_FALSE' && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => removeOption(i)} aria-label={`Supprimer l’option ${o.id}`} disabled={d.options.length <= 2}><Trash2 className="size-4" aria-hidden /></Button>
                      )}
                    </div>
                  );
                })}
                {d.type !== 'TRUE_FALSE' && (
                  <div className="flex flex-wrap gap-2">
                    {d.type === 'MATCHING' ? (
                      <>
                        <Button type="button" size="sm" variant="secondary" onClick={() => addOption('left')}><Plus className="size-4" aria-hidden />Élément à gauche</Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => addOption('right')}><Plus className="size-4" aria-hidden />Élément à droite</Button>
                      </>
                    ) : (
                      <Button type="button" size="sm" variant="secondary" onClick={() => addOption()} disabled={d.options.length >= 10}><Plus className="size-4" aria-hidden />Ajouter une option</Button>
                    )}
                  </div>
                )}
              </fieldset>
            )}

            {d.type === 'NUMERIC' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Valeur attendue" htmlFor="q-num"><Input id="q-num" inputMode="decimal" dir="ltr" value={d.numValue} onChange={(e) => set('numValue', e.target.value)} /></Field>
                <Field label="Tolérance (±, optionnelle)" htmlFor="q-tol"><Input id="q-tol" inputMode="decimal" dir="ltr" value={d.numTolerance} onChange={(e) => set('numTolerance', e.target.value)} /></Field>
              </div>
            )}

            {d.type === 'MATCHING' && (
              <fieldset className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
                <legend className="text-sm font-semibold">Associations correctes</legend>
                {lefts.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-40 flex-1 text-sm" dir="auto"><b dir="ltr">{l.id}</b> · {l.text || '…'}</span>
                    <Select aria-label={`Associer ${l.id}`} value={d.pairs[l.id] ?? ''} onChange={(e) => set('pairs', { ...d.pairs, [l.id]: e.target.value })} className="h-10 w-auto min-w-48">
                      <option value="">— choisir —</option>
                      {rights.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.text}</option>)}
                    </Select>
                  </div>
                ))}
              </fieldset>
            )}

            {d.type === 'ORDERING' && (
              <fieldset className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
                <legend className="text-sm font-semibold">Ordre correct</legend>
                <ol className="flex flex-col gap-1.5">
                  {order.map((oid, i) => (
                    <li key={oid} className="flex items-center gap-2 rounded-lg bg-surface p-1.5">
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-bold">{i + 1}</span>
                      <span className="flex-1 text-sm" dir="auto">{d.options.find((o) => o.id === oid)?.text || oid}</span>
                      <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => moveOrder(i, -1)} aria-label="Monter"><ArrowUp className="size-4" aria-hidden /></Button>
                      <Button type="button" size="sm" variant="ghost" disabled={i === order.length - 1} onClick={() => moveOrder(i, 1)} aria-label="Descendre"><ArrowDown className="size-4" aria-hidden /></Button>
                    </li>
                  ))}
                </ol>
              </fieldset>
            )}

            <Field label="Explication (affichée après la réponse)" htmlFor="q-expl">
              <Textarea id="q-expl" rows={4} value={d.explanation} onChange={(e) => set('explanation', e.target.value)} dir="auto" lang={d.language} required />
            </Field>
          </Section>

          <Section title="Programme" description="Le thème décide où la question est servie ; les objectifs alimentent la maîtrise par compétence.">
            <TopicObjectivesEditor
              topicKey={d.topicKey}
              objectiveKeys={d.objectiveKeys}
              onTopic={(k) => setD((x) => ({ ...x, topicKey: k, objectiveKeys: k === x.topicKey ? x.objectiveKeys : [] }))}
              onObjectives={(keys) => set('objectiveKeys', keys)}
              onTopicLoaded={onTopicLoaded}
            />
          </Section>

          <Section title="Concours">
            <Toggle checked={d.isGeneral} onChange={(v) => set('isGeneral', v)} label="Question générale" description="Servie à tous les concours dont le programme couvre ce thème. Sinon, uniquement aux concours cochés." />
            <div className="flex flex-col gap-2">
              <Input aria-label="Filtrer les concours" placeholder="Filtrer les concours…" value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value)} className="h-9 text-sm" />
              <div className="grid max-h-56 gap-0.5 overflow-y-auto rounded-xl border border-border p-2 sm:grid-cols-2">
                {shownFamilies.map((f) => (
                  <Checkbox
                    key={f.slug}
                    checked={d.familySlugs.includes(f.slug)}
                    onChange={(v) => set('familySlugs', v ? [...d.familySlugs, f.slug] : d.familySlugs.filter((s) => s !== f.slug))}
                    label={<span>{f.name_fr} <code className="text-xs text-muted">{f.slug}</code></span>}
                  />
                ))}
              </div>
              {d.familySlugs.length > 0 && <p className="text-xs text-muted">Liée à : {d.familySlugs.join(', ')}</p>}
            </div>
          </Section>

          <Section title="Provenance">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Source" htmlFor="q-source"><SourcePicker id="q-source" value={d.sourceId} onChange={(v) => set('sourceId', v)} /></Field>
              <Field label="Origine" htmlFor="q-origin">
                {question?.origin === 'AI_GENERATED'
                  ? <Input id="q-origin" value="Générée par IA (non modifiable)" disabled />
                  : (
                    <Select id="q-origin" value={d.origin} onChange={(e) => set('origin', e.target.value)}>
                      {EDITOR_ORIGINS.map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
                    </Select>
                  )}
              </Field>
              <Field label="Année (annale)" htmlFor="q-year"><Input id="q-year" inputMode="numeric" value={d.year} onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))} dir="ltr" placeholder="2024" /></Field>
              <Field label="Valable jusqu’au" htmlFor="q-valid" hint="Ex. question d’actualité : retirée automatiquement après cette date."><Input id="q-valid" type="date" value={d.validUntil} onChange={(e) => set('validUntil', e.target.value)} /></Field>
              <Field label="Tags" htmlFor="q-tags" hint="Un par ligne ou séparés par des virgules."><ListInput id="q-tags" value={d.tags} onChange={(v) => set('tags', v)} dir="ltr" /></Field>
              <Field label="Identifiant externe (optionnel)" htmlFor="q-ext"><Input id="q-ext" value={d.extId} onChange={(e) => set('extId', e.target.value)} dir="ltr" placeholder="cg-2023-014" /></Field>
            </div>
          </Section>

          {issues.length > 0 && (
            <div className="rounded-xl bg-warning-soft p-3 text-sm" role="status">
              <p className="font-semibold text-warning">À compléter avant d’enregistrer</p>
              <ul className="list-disc ps-5">{issues.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {question && question.status !== 'ARCHIVED' && <Button type="button" variant="ghost" disabled={busy} onClick={() => void changeStatus('archive')}><Archive className="size-4" aria-hidden />Archiver</Button>}
            {question && (question.status === 'PUBLISHED' || question.status === 'ARCHIVED') && <Button type="button" variant="ghost" disabled={busy} onClick={() => void changeStatus('to_draft')}><Undo2 className="size-4" aria-hidden />Repasser en brouillon</Button>}
            <Button type="submit" variant="secondary" loading={busy}><Save className="size-4" aria-hidden />Enregistrer</Button>
            <Button type="button" loading={busy} onClick={() => void save(true)}><CheckCheck className="size-4" aria-hidden />Enregistrer + publier</Button>
          </div>
        </form>

        <aside className={clsx('flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:self-start xl:overflow-y-auto', !showPreview && 'hidden xl:flex')} aria-label="Aperçu">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Aperçu candidat (clé surlignée)</p>
          <QuestionPreview q={{ type: d.type, domain: d.domain, language: d.language, stem: d.stem, options: d.type === 'NUMERIC' ? [] : d.options, correct: correctOf(d), explanation: d.explanation, difficulty: d.difficulty }} />
          {question && <QuestionMeta q={question} />}
        </aside>
      </div>
      {confirm.element}
    </AdminPage>
  );
}

function QuestionMeta({ q }: { q: AdminQuestionFull }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-1 p-4 text-sm">
        <p className="font-semibold">Statistiques</p>
        <p>{q.stats.attempts ? `${q.stats.attempts} réponses · ${fmtPct(q.stats.accuracy)} de réussite` : 'Pas encore posée.'}</p>
        <p className="text-xs text-muted">Changer la clé de réponse remet ces statistiques à zéro.</p>
      </div>
      {q.reports.length > 0 && (
        <div className="card flex flex-col gap-2 p-4 text-sm">
          <p className="font-semibold">Signalements ({q.reports.length})</p>
          <ul className="flex flex-col gap-2">
            {q.reports.slice(0, 10).map((r) => (
              <li key={r.id} className="rounded-lg bg-surface-2 p-2">
                <span className="font-semibold">{REPORT_REASON_LABEL[r.reason] ?? r.reason}</span> · <Badge tone={r.status === 'OPEN' ? 'danger' : 'neutral'}>{REPORT_STATUS_LABEL[r.status] ?? r.status}</Badge>
                <span className="ms-1 text-xs text-muted">{fmtDateTime(r.createdAt)}</span>
                {r.comment && <p dir="auto">{r.comment}</p>}
              </li>
            ))}
          </ul>
          <Link href={`/admin/reports?questionId=${q.id}&status=ALL`} className="text-xs font-semibold text-primary underline">Traiter les signalements</Link>
        </div>
      )}
      {q.history.length > 0 && (
        <div className="card flex flex-col gap-2 p-4 text-sm">
          <p className="font-semibold">Historique de revue</p>
          <ol className="flex flex-col gap-1.5">
            {q.history.map((h, i) => (
              <li key={i} className="border-s-2 border-border ps-2">
                <span className="text-xs text-muted">{fmtDateTime(h.at)} · {h.reviewer?.name ?? 'système'}</span>
                <p>{h.fromStatus ? `${CONTENT_STATUS_LABEL[h.fromStatus as keyof typeof CONTENT_STATUS_LABEL] ?? h.fromStatus} → ` : ''}{CONTENT_STATUS_LABEL[h.toStatus as keyof typeof CONTENT_STATUS_LABEL] ?? h.toStatus}</p>
                {h.comment && <p className="text-muted" dir="auto">{h.comment}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

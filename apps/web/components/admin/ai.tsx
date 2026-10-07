'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Bot, Calculator, RotateCcw, Sparkles } from 'lucide-react';
import type { Difficulty } from '@ctn/shared';
import { DIFFICULTIES } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi, usePersistentState } from './hooks';
import { describeError, DIFFICULTY_LABEL, fmtDateTime, JOB_KIND_LABEL, JOB_STATUS_LABEL, JOB_STATUS_TONE, LANGUAGE_LABEL, qs } from './labels';
import { useToast } from './toast';
import { loadTopic, TopicSearch, type TopicInfo } from './topic-picker';
import type { AiJob, AlgorithmicResult, FactsProposal, GenerationOutput } from './types';
import { AdminPage, Empty, ErrorBox, FilterBar, FilterField, JsonBlock, Loading, Section } from './ui';

const ALGO_KINDS = [
  { v: 'NUMBER_SERIES', l: 'Suites numériques (logique)' },
  { v: 'LETTER_SERIES', l: 'Suites de lettres (logique)' },
  { v: 'CODING', l: 'Codage (psychotechnique)' },
] as const;
const POLL_MS = 4000;

export function AiView() {
  const sp = useSearchParams();
  const [aiDisabled, setAiDisabled] = usePersistentState<boolean>('ctn_admin_ai_disabled', false);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const jobs = useAdminApi<AiJob[]>(`/admin/ai/jobs${qs({ kind, status, limit: 50 })}`);
  const running = (jobs.data ?? []).some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  const reloadJobs = jobs.reload;

  // Poll while a generation runs in the background.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void reloadJobs(), POLL_MS);
    return () => window.clearInterval(t);
  }, [running, reloadJobs]);

  return (
    <AdminPage
      title="Génération de contenu"
      subtitle="Tout contenu généré arrive en brouillon ou « Validé par IA » : un humain doit le relire avant publication."
    >
      {aiDisabled ? (
        <Alert tone="warning" title="IA désactivée sur ce serveur">
          La clé ANTHROPIC_API_KEY n’est pas configurée : la génération par IA est indisponible et l’extraction de faits utilise l’heuristique. Le générateur algorithmique fonctionne sans IA.
          <button type="button" className="ms-2 font-semibold underline" onClick={() => setAiDisabled(false)}>Réessayer</button>
        </Alert>
      ) : (
        <Alert tone="info">
          La génération IA nécessite une clé ANTHROPIC_API_KEY côté API. Chaque question générée passe une validation automatique (structure, doublons, seconde résolution à l’aveugle) avant d’atteindre « Validé par IA ».
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <GenerateForm initialTopic={sp.get('topicKey') ?? ''} disabled={aiDisabled} onDisabled={() => setAiDisabled(true)} onStarted={() => void jobs.reload()} />
        <AlgorithmicForm onDone={() => void jobs.reload()} />
      </div>

      <Section title="Tâches" actions={<Button size="sm" variant="ghost" onClick={() => void jobs.reload()}><RotateCcw className="size-4" aria-hidden />Recharger</Button>}>
        <FilterBar>
          <FilterField label="Type" htmlFor="jf-kind">
            <Select id="jf-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Tous</option>
              {Object.entries(JOB_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Statut" htmlFor="jf-status">
            <Select id="jf-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tous</option>
              {Object.entries(JOB_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </FilterField>
        </FilterBar>
        {jobs.error && !jobs.data ? <ErrorBox error={jobs.error} onRetry={() => void jobs.reload()} /> : !jobs.data ? <Loading /> : !jobs.data.length ? <Empty title="Aucune tâche" /> : (
          <ul className="flex flex-col gap-2">
            {jobs.data.map((j) => <JobRow key={j.id} j={j} />)}
          </ul>
        )}
      </Section>
    </AdminPage>
  );
}

function GenerateForm({ initialTopic, disabled, onDisabled, onStarted }: { initialTopic: string; disabled: boolean; onDisabled: () => void; onStarted: () => void }) {
  const { toast, toastError } = useToast();
  const [topicKey, setTopicKey] = useState(initialTopic);
  const [topic, setTopic] = useState<TopicInfo | null>(null);
  const [count, setCount] = useState('10');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!topicKey) {
      setTopic(null);
      return;
    }
    let alive = true;
    void loadTopic(topicKey).then((t) => alive && setTopic(t));
    return () => {
      alive = false;
    };
  }, [topicKey]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const job = await api<AiJob>('/admin/ai/generate-questions', {
        method: 'POST',
        body: { topicKey, count: Number(count), ...(difficulty ? { difficulty } : {}), ...(language ? { language } : {}) },
      });
      toast({ tone: 'success', title: 'Génération lancée', body: `Tâche ${job.id.slice(0, 8)}… : suivez son avancement ci-dessous.` });
      onStarted();
    } catch (err) {
      if (describeError(err).code === 'AI_DISABLED') onDisabled();
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={<span className="inline-flex items-center gap-2"><Sparkles className="size-5 text-accent" aria-hidden />Générer des questions (IA)</span>} description="Ancrées sur le thème, ses objectifs et sa source. Résultat : questions « Validé par IA » ou brouillons avec motif.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Thème (niveau TOPIC)" htmlFor="gen-topic">
          <TopicSearch id="gen-topic" value={topicKey} onPick={(k) => setTopicKey(k)} />
        </Field>
        {topic && (
          <p className="text-xs text-muted">
            {topic.title_fr} · {topic.objectives.length} objectif(s)
            {topic.level !== 'TOPIC' && <span className="ms-1 font-semibold text-danger">— choisissez un thème de niveau TOPIC (ici {topic.level})</span>}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nombre (1–30)" htmlFor="gen-count"><Input id="gen-count" type="number" min={1} max={30} required value={count} onChange={(e) => setCount(e.target.value)} /></Field>
          <Field label="Difficulté" htmlFor="gen-diff">
            <Select id="gen-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}>
              <option value="">Mélangée</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
            </Select>
          </Field>
          <Field label="Langue" htmlFor="gen-lang">
            <Select id="gen-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Selon le thème</option>
              {['ar', 'fr', 'en'].map((l) => <option key={l} value={l}>{LANGUAGE_LABEL[l]}</option>)}
            </Select>
          </Field>
        </div>
        <Button type="submit" loading={busy} disabled={disabled || !topicKey || topic?.level === 'UNIT' || topic?.level === 'SUBJECT'} className="self-start"><Bot className="size-4" aria-hidden />Lancer la génération</Button>
      </form>
    </Section>
  );
}

function AlgorithmicForm({ onDone }: { onDone: () => void }) {
  const { toast, toastError } = useToast();
  const [kind, setKind] = useState<(typeof ALGO_KINDS)[number]['v']>('NUMBER_SERIES');
  const [count, setCount] = useState('20');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [language, setLanguage] = useState<'ar' | 'fr'>('ar');
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AlgorithmicResult | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<AlgorithmicResult>('/admin/ai/generate-algorithmic', {
        method: 'POST',
        body: { kind, count: Number(count), language, ...(difficulty ? { difficulty } : {}), ...(seed ? { seed: Number(seed) } : {}) },
      });
      setResult(r);
      toast({ tone: 'success', title: `${r.inserted} question(s) créée(s)`, body: r.skippedDuplicates ? `${r.skippedDuplicates} doublon(s) ignoré(s).` : undefined });
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={<span className="inline-flex items-center gap-2"><Calculator className="size-5 text-primary" aria-hidden />Générateur algorithmique</span>} description="Items psychotechniques corrects par construction (sans IA). Ils arrivent « Validé par IA » : un humain les publie.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Type d’item" htmlFor="algo-kind">
          <Select id="algo-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {ALGO_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Nombre (1–100)" htmlFor="algo-count"><Input id="algo-count" type="number" min={1} max={100} required value={count} onChange={(e) => setCount(e.target.value)} /></Field>
          <Field label="Difficulté" htmlFor="algo-diff">
            <Select id="algo-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}>
              <option value="">Mélangée</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
            </Select>
          </Field>
          <Field label="Langue" htmlFor="algo-lang">
            <Select id="algo-lang" value={language} onChange={(e) => setLanguage(e.target.value as 'ar' | 'fr')}>
              <option value="ar">Arabe</option>
              <option value="fr">Français</option>
            </Select>
          </Field>
          <Field label="Graine (optionnel)" htmlFor="algo-seed" hint="Lot reproductible."><Input id="algo-seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <Button type="submit" loading={busy} className="self-start"><Calculator className="size-4" aria-hidden />Générer</Button>
        {result && (
          <Alert tone="success" title={`${result.inserted} / ${result.requested} question(s) ajoutée(s) au thème ${result.topicKey}`}>
            {result.skippedDuplicates > 0 && <span>{result.skippedDuplicates} déjà présente(s). </span>}
            <Link href="/admin/review?entity=question&status=AI_REVIEWED" className="font-semibold underline">Les relire dans la file de revue</Link>
          </Alert>
        )}
      </form>
    </Section>
  );
}

function JobRow({ j }: { j: AiJob }) {
  const input = (j.input ?? {}) as Record<string, unknown>;
  const gen = j.kind === 'GENERATE_QUESTIONS' ? (j.output as GenerationOutput | null) : null;
  const algo = j.kind === 'GENERATE_ALGORITHMIC' ? (j.output as Omit<AlgorithmicResult, 'jobId'> | null) : null;
  const facts = j.kind === 'EXTRACT_FACTS' ? (j.output as FactsProposal | null) : null;
  const reasons = gen ? Object.entries(gen.rejected.reduce<Record<string, number>>((m, r) => ({ ...m, [r.reason]: (m[r.reason] ?? 0) + 1 }), {})) : [];
  return (
    <li className="card flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={JOB_STATUS_TONE[j.status] ?? 'neutral'}>{JOB_STATUS_LABEL[j.status] ?? j.status}</Badge>
        <span className="font-semibold">{JOB_KIND_LABEL[j.kind] ?? j.kind}</span>
        {typeof input.topicKey === 'string' && <code className="text-xs">{input.topicKey}</code>}
        {typeof input.kind === 'string' && <code className="text-xs">{input.kind}</code>}
        {typeof input.count === 'number' && <span className="text-muted">× {input.count}</span>}
        <span className={clsx('ms-auto text-xs text-muted')}>{fmtDateTime(j.createdAt)}{j.finishedAt ? ` → ${fmtDateTime(j.finishedAt)}` : ''}</span>
      </div>
      {gen && (
        <p>
          {gen.inserted} insérée(s) · <b className="text-success">{gen.aiReviewed} validée(s) par IA</b> · {gen.draft} brouillon(s) · {gen.discarded} écartée(s)
          {reasons.length > 0 && <span className="text-muted"> — motifs : {reasons.map(([r, n]) => `${r} ×${n}`).join(', ')}</span>}
        </p>
      )}
      {algo && <p>{algo.inserted} insérée(s){algo.skippedDuplicates ? ` · ${algo.skippedDuplicates} doublon(s)` : ''}</p>}
      {facts && <p>{facts.method === 'AI' ? 'IA' : 'Heuristique'} · {facts.editions?.length ?? 0} session(s), {facts.phases?.length ?? 0} épreuve(s), {facts.required_documents?.length ?? 0} pièce(s){typeof input.documentId === 'string' && <> · <Link className="underline" href={`/admin/sources/documents/${input.documentId}`}>document</Link></>}</p>}
      {(j.model || j.tokensIn) && <p className="text-xs text-muted">{j.model ?? '—'}{j.promptVersion ? ` · ${j.promptVersion}` : ''}{j.tokensIn ? ` · ${j.tokensIn} → ${j.tokensOut ?? 0} tokens` : ''}</p>}
      {j.error && <p className="text-xs text-danger" dir="auto">{j.error}</p>}
      {gen?.batchErrors?.length ? <p className="text-xs text-danger">{gen.batchErrors.join(' · ')}</p> : null}
      {(gen?.aiReviewed || algo?.inserted) ? <Link href="/admin/review?entity=question&status=AI_REVIEWED" className="self-start text-xs font-semibold text-primary underline">Relire les questions</Link> : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Détails</summary>
        <JsonBlock value={{ input: j.input, output: j.output }} className="mt-1" />
      </details>
    </li>
  );
}

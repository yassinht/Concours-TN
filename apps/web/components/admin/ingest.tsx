'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { CircleCheck, EyeOff, FilePlus2, Pencil, Plus, Radar, RefreshCw, TriangleAlert } from 'lucide-react';
import { Alert, Badge, Button, Field, Input, Modal, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi } from './hooks';
import { fmtDate, fmtDateTime, safeHref, truncate } from './labels';
import { FamilySelect } from './pickers';
import { useToast } from './toast';
import type { Candidate, CheckResult, DraftResult, WatchedSource } from './types';
import { AdminPage, Checkbox, Empty, ErrorBox, Loading, Section, TableWrap, tableCls, tdCls, thCls, Toggle, useConfirm } from './ui';

const OUTCOME_LABEL: Record<CheckResult['outcome'], string> = {
  FIRST_SNAPSHOT: 'Première capture', UNCHANGED: 'Inchangée', CHANGED: 'Modifiée', ERROR: 'Erreur',
};

export function IngestView() {
  const { toast, toastError } = useToast();
  const watch = useAdminApi<WatchedSource[]>('/admin/watch');
  const [status, setStatus] = useState<'NEW' | 'DRAFTED' | 'IGNORED'>('NEW');
  const candidates = useAdminApi<Candidate[]>(`/admin/ingest?status=${status}&limit=100`);
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [editWatch, setEditWatch] = useState<{ w: WatchedSource | null } | null>(null);

  async function checkNow(ids?: string[]) {
    setChecking(ids?.[0] ?? 'all');
    try {
      const r = await api<{ checked: number; newCandidates: number; results: CheckResult[] }>('/admin/watch/check-now', { method: 'POST', body: ids ? { ids } : {} });
      setResults(r.results);
      toast({ tone: r.newCandidates ? 'success' : 'info', title: `${r.checked} page(s) vérifiée(s)`, body: r.newCandidates ? `${r.newCandidates} nouvelle(s) annonce(s) détectée(s).` : 'Aucune nouvelle annonce.' });
      void watch.reload();
      void candidates.reload();
    } catch (e) {
      toastError(e);
    } finally {
      setChecking(null);
    }
  }

  async function toggleActive(w: WatchedSource) {
    try {
      const r = await api<WatchedSource>(`/admin/watch/${w.id}`, { method: 'PATCH', body: { active: !w.active } });
      watch.setData((list) => list?.map((x) => (x.id === w.id ? { ...r, newCandidates: x.newCandidates } : x)));
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <AdminPage
      title="Veille des pages officielles"
      subtitle="Les pages surveillées (concours.gov.tn, ministères…) sont relevées toutes les 6 heures. Une nouvelle annonce devient un candidat : transformez-le en session brouillon, vérifiez-la, publiez-la — les candidats correspondants sont alors alertés."
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => setEditWatch({ w: null })}><Plus className="size-4" aria-hidden />Surveiller une page</Button>
          <Button size="sm" loading={checking === 'all'} disabled={!!checking} onClick={() => void checkNow()}><RefreshCw className="size-4" aria-hidden />Vérifier maintenant</Button>
        </>
      }
    >
      {results && (
        <Alert tone="info" title="Résultat de la vérification">
          <ul className="mt-1 flex flex-col gap-0.5">
            {results.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-1.5">
                {r.outcome === 'ERROR' ? <TriangleAlert className="size-4 text-danger" aria-hidden /> : <CircleCheck className="size-4 text-success" aria-hidden />}
                <span dir="ltr">{truncate(r.url, 70)}</span> — {OUTCOME_LABEL[r.outcome]}{r.newCandidates ? `, ${r.newCandidates} nouvelle(s)` : ''}{r.error ? ` (${r.error})` : ''}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Section title="Pages surveillées">
        {watch.error && !watch.data ? <ErrorBox error={watch.error} onRetry={() => void watch.reload()} /> : !watch.data ? <Loading /> : !watch.data.length ? <Empty title="Aucune page surveillée" action={<Button size="sm" onClick={() => setEditWatch({ w: null })}>Ajouter une page</Button>} /> : (
          <TableWrap>
            <table className={clsx(tableCls, 'min-w-[900px]')}>
              <thead><tr><th className={thCls}>Page</th><th className={thCls}>Concours</th><th className={thCls}>Dernier relevé</th><th className={thCls}>Nouvelles</th><th className={thCls}>Active</th><th className={thCls}>Actions</th></tr></thead>
              <tbody>
                {watch.data.map((w) => {
                  const href = safeHref(w.url);
                  return (
                    <tr key={w.id} className={clsx(!w.active && 'opacity-60')}>
                      <td className={tdCls}>
                        <p className="font-semibold" dir="auto">{w.label}</p>
                        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-muted underline" dir="ltr">{truncate(href, 70)}</a> : <span className="text-xs" dir="ltr">{w.url}</span>}
                      </td>
                      <td className={tdCls}>{w.familySlug ? <code className="text-xs">{w.familySlug}</code> : <span className="text-xs text-muted">Plusieurs</span>}</td>
                      <td className={clsx(tdCls, 'text-xs')}>
                        {fmtDateTime(w.lastCheckedAt)}
                        {w.lastError && <p className="text-danger" title={w.lastError}>Erreur : {truncate(w.lastError, 60)}</p>}
                      </td>
                      <td className={tdCls}>{w.newCandidates ? <Badge tone="warning">{w.newCandidates}</Badge> : <span className="text-muted">0</span>}</td>
                      <td className={tdCls}><Toggle checked={w.active} onChange={() => void toggleActive(w)} label={<span className="sr-only">Surveillance active</span>} /></td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="secondary" loading={checking === w.id} disabled={!!checking} onClick={() => void checkNow([w.id])}><Radar className="size-4" aria-hidden />Vérifier</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditWatch({ w })} aria-label="Modifier"><Pencil className="size-4" aria-hidden /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Annonces détectées">
        <Tabs tabs={[{ value: 'NEW', label: 'Nouvelles' }, { value: 'DRAFTED', label: 'Transformées en session' }, { value: 'IGNORED', label: 'Ignorées' }]} value={status} onChange={setStatus} />
        {candidates.error && !candidates.data ? <ErrorBox error={candidates.error} onRetry={() => void candidates.reload()} /> : !candidates.data ? <Loading /> : !candidates.data.length ? (
          <Empty title="Aucune annonce" body={status === 'NEW' ? 'Lancez « Vérifier maintenant » pour relever les pages surveillées.' : undefined} />
        ) : (
          <ul className="flex flex-col gap-3">
            {candidates.data.map((c) => <CandidateCard key={c.id} c={c} onChanged={() => { void candidates.reload(); void watch.reload(); }} />)}
          </ul>
        )}
      </Section>

      <WatchFormModal state={editWatch} onClose={() => setEditWatch(null)} onSaved={() => void watch.reload()} />
    </AdminPage>
  );
}

function CandidateCard({ c, onChanged }: { c: Candidate; onChanged: () => void }) {
  const { toast, toastError } = useToast();
  const confirm = useConfirm();
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const href = safeHref(c.url);
  const ex = c.extracted ?? {};
  const guess = ex.familyGuess;
  const ed = ex.editions?.[0];

  async function ignore() {
    const r = await confirm.ask({ title: 'Ignorer cette annonce ?', body: 'Elle ne sera plus proposée (une annonce identique ne sera pas recréée).', confirmLabel: 'Ignorer' });
    if (!r) return;
    setBusy(true);
    try {
      await api(`/admin/ingest/${c.id}/ignore`, { method: 'POST', body: {} });
      toast({ tone: 'success', title: 'Annonce ignorée' });
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold" dir="auto">{c.title}</p>
          <p className="text-xs text-muted">
            {c.watchedSourceLabel ?? 'Page surveillée'} · détectée le {fmtDateTime(c.detectedAt)}
            {href && <> · <a href={href} target="_blank" rel="noopener noreferrer" className="underline">ouvrir l’annonce</a></>}
          </p>
        </div>
        {c.status === 'NEW' && (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" onClick={() => setDrafting(true)}><FilePlus2 className="size-4" aria-hidden />Créer une session brouillon</Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void ignore()}><EyeOff className="size-4" aria-hidden />Ignorer</Button>
          </div>
        )}
        {c.status === 'DRAFTED' && ex.draft && (
          <Link href={`/admin/concours/${ex.draft.familySlug}?edition=${ex.draft.competitionId}`} className="text-sm font-semibold text-primary underline">Voir la session ({ex.draft.familySlug})</Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {guess?.slug
          ? <Badge tone="primary" title={guess.matched.join(', ')}>Concours probable : {guess.slug} (score {guess.score.toFixed(1)})</Badge>
          : <Badge tone="neutral">Concours non identifié</Badge>}
        {guess?.matched?.length ? <span className="text-muted">mots-clés : {guess.matched.slice(0, 6).join(', ')}</span> : null}
      </div>
      {ed && (
        <p className="text-sm">
          <Badge tone="warning">Suggestion à vérifier</Badge>{' '}
          Année {ed.year ?? '?'} · ouverture {fmtDate(ed.registration_open)} · clôture <b>{fmtDate(ed.registration_deadline)}</b> · examen {fmtDate(ed.exam_date)}{ed.positions_count ? ` · ${ed.positions_count} postes` : ''}
        </p>
      )}
      {c.rawText && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Texte détecté</summary>
          <p className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2" dir="auto">{c.rawText}</p>
        </details>
      )}
      <DraftModal c={c} open={drafting} onClose={() => setDrafting(false)} onDone={onChanged} />
      {confirm.element}
    </li>
  );
}

function DraftModal({ c, open, onClose, onDone }: { c: Candidate; open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast, toastError } = useToast();
  const [familySlug, setFamilySlug] = useState(c.familySlugGuess ?? '');
  const [importDoc, setImportDoc] = useState(!!c.url);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);

  async function draft(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<DraftResult>(`/admin/ingest/${c.id}/draft`, { method: 'POST', body: { familySlug, importDocument: importDoc } });
      setResult(r);
      toast({ tone: 'success', title: 'Session brouillon créée', body: 'Invisible pour les candidats tant qu’elle n’est pas vérifiée et publiée.' });
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { onClose(); setResult(null); }} title="Créer une session à partir de l’annonce">
      {result ? (
        <div className="flex flex-col gap-3 text-sm">
          <Alert tone="success" title={`Session ${result.competition.year} créée (brouillon, à vérifier)`}>
            Prochaine étape : vérifiez les dates contre l’avis, complétez la source puis publiez. La publication d’une session ouverte alerte les candidats correspondants.
          </Alert>
          {result.import?.document && (
            <p>Avis importé ({result.import.document.duplicate ? 'déjà présent' : 'nouveau'}, {result.import.document.pageCount ?? '?'} page(s)) — <Link className="font-semibold text-primary underline" href={`/admin/sources/documents/${result.import.document.id}`}>ouvrir le document et la proposition d’extraction</Link></p>
          )}
          {result.import?.error && <Alert tone="warning">Import de l’avis impossible : {result.import.error}</Alert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Link href="/admin/review?entity=edition" className="inline-flex h-11 items-center rounded-xl border border-border px-4 font-semibold hover:bg-surface-2">File de revue</Link>
            <Link href={`/admin/concours/${result.competition.familySlug}?edition=${result.competition.id}`} className="inline-flex h-11 items-center rounded-xl bg-primary px-4 font-semibold text-primary-contrast">Ouvrir la session</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={draft} className="flex flex-col gap-3">
          <p className="text-sm" dir="auto"><b>{c.title}</b></p>
          <Field label="Concours" htmlFor={`dr-family-${c.id}`} hint={c.familySlugGuess ? `Suggestion de la veille : ${c.familySlugGuess}` : 'Aucun concours reconnu automatiquement.'}>
            <FamilySelect id={`dr-family-${c.id}`} value={familySlug} onChange={setFamilySlug} allowEmpty={false} required />
          </Field>
          {c.url && <Checkbox checked={importDoc} onChange={setImportDoc} label="Télécharger l’avis (PDF/HTML), le rattacher à la source et lancer l’extraction des faits" />}
          <p className="text-xs text-muted">La session est créée au statut « Annoncée », marquée « À vérifier », en brouillon : aucun candidat n’est alerté avant sa publication.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={busy} disabled={!familySlug}>Créer la session brouillon</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function WatchFormModal({ state, onClose, onSaved }: { state: { w: WatchedSource | null } | null; onClose: () => void; onSaved: () => void }) {
  const { toast, toastError } = useToast();
  const w = state?.w ?? null;
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [familySlug, setFamilySlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [openedFor, setOpenedFor] = useState<typeof state>(null);
  if (state !== openedFor) {
    // Reset the form when it opens for another watcher (render-phase sync, no effect flash).
    setOpenedFor(state);
    setUrl(w?.url ?? '');
    setLabel(w?.label ?? '');
    setFamilySlug(w?.familySlug ?? '');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (w) await api(`/admin/watch/${w.id}`, { method: 'PATCH', body: { label, familySlug: familySlug || null } });
      else await api('/admin/watch', { method: 'POST', body: { url, label, familySlug: familySlug || null } });
      toast({ tone: 'success', title: w ? 'Page mise à jour' : 'Page ajoutée à la veille', body: w ? undefined : 'Lancez « Vérifier » pour la première capture.' });
      onSaved();
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!state} onClose={onClose} title={w ? 'Modifier la page surveillée' : 'Surveiller une page officielle'}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="URL" htmlFor="wf-url"><Input id="wf-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!w} dir="ltr" placeholder="https://www.concours.gov.tn/…" /></Field>
        <Field label="Libellé" htmlFor="wf-label"><Input id="wf-label" required minLength={2} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} dir="auto" /></Field>
        <Field label="Concours (si la page n’en concerne qu’un)" htmlFor="wf-family"><FamilySelect id="wf-family" value={familySlug} onChange={setFamilySlug} emptyLabel="Plusieurs concours" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={busy}>{w ? 'Enregistrer' : 'Ajouter'}</Button>
        </div>
      </form>
    </Modal>
  );
}

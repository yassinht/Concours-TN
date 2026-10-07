'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { History, ScanSearch } from 'lucide-react';
import { Alert, Badge, Button, Field } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi } from './hooks';
import { fmtDateTime, safeHref } from './labels';
import { FamilySelect } from './pickers';
import { highlight, ProposalPanel } from './proposal';
import { useToast } from './toast';
import type { AiJob, DocumentDetail, FactsProposal } from './types';
import { AdminPage, ErrorBox, Loading, Section } from './ui';

/** Document text by page, side by side with an extraction proposal whose quotes can be located in the text. */
export function DocumentViewerView({ id }: { id: string }) {
  const { toast, toastError } = useToast();
  const { data: doc, error, loading, reload } = useAdminApi<DocumentDetail>(`/admin/documents/${id}`);
  const jobs = useAdminApi<AiJob[]>('/admin/ai/jobs?kind=EXTRACT_FACTS&limit=100');
  const [familySlug, setFamilySlug] = useState('');
  const [job, setJob] = useState<AiJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<{ quote: string; page: number | null } | null>(null);

  const pages = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const c of doc?.chunks ?? []) m.set(c.page, [...(m.get(c.page) ?? []), c.text]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [doc]);
  const previous = useMemo(() => (jobs.data ?? []).filter((j) => (j.input as { documentId?: string } | null)?.documentId === id), [jobs.data, id]);

  async function extract() {
    setBusy(true);
    try {
      const r = await api<AiJob>('/admin/ai/extract', { method: 'POST', body: { documentId: id, ...(familySlug ? { familySlug } : {}) } });
      setJob(r);
      const p = r.output as FactsProposal | null;
      toast({ tone: 'success', title: `Proposition prête (${p?.method === 'AI' ? 'IA' : 'heuristique'})`, body: 'Vérifiez chaque citation avant de copier les valeurs.' });
      void jobs.reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  function locate(quote: string, page: number | null) {
    setActive({ quote, page });
    const target = page != null ? document.getElementById(`doc-page-${page}`) : null;
    // Wait for the highlight to render, then bring the first match (or the page) into view.
    window.setTimeout(() => {
      const mark = document.querySelector('#doc-text mark');
      (mark ?? target)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);
  }

  if (error && !doc) return <AdminPage title="Document" back={{ href: '/admin/sources', label: 'Sources & documents' }}><ErrorBox error={error} onRetry={() => void reload()} /></AdminPage>;
  if (loading && !doc) return <Loading />;
  if (!doc) return null;
  const proposal = job?.output as FactsProposal | undefined;
  const sourceHref = safeHref(doc.source?.url);

  return (
    <AdminPage
      back={{ href: '/admin/sources', label: 'Sources & documents' }}
      title={<span dir="auto">{doc.filename ?? 'Document'}</span>}
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{doc.mime}</Badge>
          <Badge tone="neutral">{doc.pageCount ?? '?'} page(s)</Badge>
          {doc.ocrStatus === 'NEEDS_OCR' ? <Badge tone="warning">Scanné : pas de couche texte</Badge> : <Badge tone="success">{doc.chunkCount} extrait(s)</Badge>}
          <span>· ajouté le {fmtDateTime(doc.createdAt)}</span>
          {doc.source && <span>· source : {sourceHref ? <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="underline" dir="auto">{doc.source.title}</a> : <span dir="auto">{doc.source.title}</span>}</span>}
        </span>
      }
    >
      {doc.ocrStatus === 'NEEDS_OCR' && <Alert tone="warning" title="Document scanné">L’OCR n’est pas pris en charge : retranscrivez le texte et utilisez « Extraire depuis un texte » dans Sources & documents.</Alert>}
      {!doc.source && <Alert tone="info">Ce document n’a pas de source : les formulaires pré-remplis vous demanderont d’en choisir une avant toute vérification.</Alert>}

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Texte par page" className="xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:self-start">
          <div id="doc-text" className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pe-1 xl:max-h-none">
            {pages.length ? pages.map(([page, texts]) => (
              <section key={page} id={`doc-page-${page}`} className={clsx('rounded-xl border p-3', active?.page === page ? 'border-warning' : 'border-border')} aria-label={`Page ${page}`}>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Page {page}</p>
                {texts.map((t, i) => <p key={i} className="mb-2 whitespace-pre-wrap text-sm leading-relaxed" dir="auto">{highlight(t, active?.quote ?? null)}</p>)}
              </section>
            )) : <p className="text-sm text-muted">Aucun texte extrait.</p>}
          </div>
        </Section>

        <div className="flex flex-col gap-5">
          <Section title="Extraction" description="Propose sessions, conditions, épreuves et pièces à fournir, chacune avec sa citation et sa page. L’heuristique prend le relais si l’IA est désactivée.">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1"><Field label="Concours concerné (aide l’extraction)" htmlFor="dv-family"><FamilySelect id="dv-family" value={familySlug} onChange={setFamilySlug} emptyLabel="Non précisé" /></Field></div>
              <Button onClick={() => void extract()} loading={busy} disabled={doc.ocrStatus === 'NEEDS_OCR'}><ScanSearch className="size-4" aria-hidden />Extraire avec IA / heuristique</Button>
            </div>
            {previous.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold"><History className="me-1 inline size-4" aria-hidden />Extractions précédentes ({previous.length})</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {previous.map((j) => {
                    const p = j.output as FactsProposal | null;
                    return (
                      <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 p-2">
                        <span>{fmtDateTime(j.createdAt)} · {p?.method === 'AI' ? `IA (${j.model ?? '?'})` : 'heuristique'} · {p?.family_slug ?? 'sans concours'}</span>
                        <Button size="sm" variant="secondary" onClick={() => { setJob(j); if (p?.family_slug) setFamilySlug(p.family_slug); }}>Afficher</Button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </Section>
          {proposal && (
            <Section title="Proposition (brouillon)" description="« Voir » surligne la citation dans le texte. Copiez ensuite les valeurs vérifiées dans une session ou un poste.">
              <ProposalPanel proposal={proposal} source={doc.source ? { id: doc.source.id, url: doc.source.url } : null} defaultFamily={familySlug || proposal.family_slug} onLocate={locate} />
            </Section>
          )}
        </div>
      </div>
    </AdminPage>
  );
}

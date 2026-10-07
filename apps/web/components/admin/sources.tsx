'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { FileText, FileUp, Pencil, RotateCcw, ScanSearch, Search, ShieldCheck } from 'lucide-react';
import type { SourceType } from '@ctn/shared';
import { SOURCE_TYPES } from '@ctn/shared/dist/enums';
import { Badge, Button, Field, Input, Select, Tabs, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { invalidateLookup, SOURCES_LOOKUP, useAdminApi, useDebounced } from './hooks';
import { fmtDate, fmtDateTime, qs, safeHref, SOURCE_TYPE_LABEL, truncate } from './labels';
import { FamilySelect, SourceFormModal, SourcePicker } from './pickers';
import { ProposalPanel } from './proposal';
import { useToast } from './toast';
import type { AiJob, DocumentDetail, DocumentSummary, FactsProposal, Paged, SourceRow } from './types';
import {
  AdminPage, ConfidenceBadge, Empty, ErrorBox, FilterBar, FilterField, Loading, Pagination, Section, TableWrap, tableCls, tdCls, thCls,
} from './ui';

type Tab = 'sources' | 'documents' | 'paste';

export function SourcesView() {
  const [tab, setTab] = useState<Tab>('sources');
  return (
    <AdminPage
      title="Sources & documents"
      subtitle="Chaque fait publié cite une source. Téléversez les avis officiels (PDF/HTML/TXT), puis extrayez-en les dates et conditions avec leurs citations."
    >
      <Tabs tabs={[{ value: 'sources', label: 'Sources' }, { value: 'documents', label: 'Documents' }, { value: 'paste', label: 'Extraire depuis un texte' }]} value={tab} onChange={setTab} />
      {tab === 'sources' && <SourcesTable />}
      {tab === 'documents' && <DocumentsPanel />}
      {tab === 'paste' && <PasteExtract />}
    </AdminPage>
  );
}

function SourcesTable() {
  const { toast, toastError } = useToast();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ source: SourceRow | null } | null>(null);
  const dq = useDebounced(q.trim());
  const { data, error, loading, reload, setData } = useAdminApi<Paged<SourceRow>>(`/admin/sources${qs({ q: dq, sourceType: type, page, pageSize: 50 })}`);

  async function verify(s: SourceRow) {
    try {
      const r = await api<SourceRow>(`/admin/sources/${s.id}/verify`, { method: 'POST', body: {} });
      setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === s.id ? { ...x, ...r } : x)) } : d));
      toast({ tone: 'success', title: 'Source revérifiée aujourd’hui' });
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Section title="Sources" actions={<Button size="sm" onClick={() => setEditing({ source: null })}>Nouvelle source</Button>}>
      <FilterBar>
        <FilterField label="Recherche" htmlFor="sf-q" className="min-w-56 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input id="sf-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="ps-9" placeholder="Titre, URL, éditeur…" dir="auto" />
          </div>
        </FilterField>
        <FilterField label="Type" htmlFor="sf-type">
          <Select id="sf-type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">Tous</option>
            {SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_TYPE_LABEL[t]}</option>)}
          </Select>
        </FilterField>
      </FilterBar>
      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : !data ? <Loading /> : !data.items.length ? <Empty title="Aucune source" /> : (
        <div className={clsx('flex flex-col gap-2', loading && 'opacity-60')}>
          <TableWrap>
            <table className={clsx(tableCls, 'min-w-[960px]')}>
              <thead>
                <tr><th className={thCls}>Titre</th><th className={thCls}>Type</th><th className={thCls}>Confiance</th><th className={thCls}>Publication</th><th className={thCls}>Utilisations</th><th className={thCls}>Vérifiée</th><th className={thCls}>Actions</th></tr>
              </thead>
              <tbody>
                {data.items.map((s) => {
                  const href = safeHref(s.url);
                  return (
                    <tr key={s.id}>
                      <td className={clsx(tdCls, 'max-w-md')}>
                        <p className="font-semibold" dir="auto">{s.title}</p>
                        <p className="text-xs text-muted">{s.publisher ?? '—'}{href && <> · <a href={href} target="_blank" rel="noopener noreferrer" className="underline" dir="ltr">{truncate(href, 60)}</a></>}</p>
                        {s.notes && <p className="text-xs text-muted" dir="auto">{truncate(s.notes, 140)}</p>}
                      </td>
                      <td className={tdCls}><Badge tone={s.sourceType === 'OFFICIAL' ? 'success' : s.sourceType === 'SUGGESTED' ? 'warning' : 'info'}>{SOURCE_TYPE_LABEL[s.sourceType as SourceType]}</Badge></td>
                      <td className={tdCls}><ConfidenceBadge c={s.confidence} /></td>
                      <td className={clsx(tdCls, 'whitespace-nowrap')}>{fmtDate(s.publicationDate)}</td>
                      <td className={clsx(tdCls, 'tabular-nums')}>{s.usage ?? '—'}</td>
                      <td className={clsx(tdCls, 'whitespace-nowrap text-xs')}>{fmtDate(s.lastVerifiedAt)}</td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setEditing({ source: s })}><Pencil className="size-4" aria-hidden />Modifier</Button>
                          <Button size="sm" variant="ghost" onClick={() => void verify(s)} title="La page est toujours en ligne et son contenu inchangé"><ShieldCheck className="size-4" aria-hidden />Revérifiée</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}
      <SourceFormModal open={!!editing} source={editing?.source ?? null} onClose={() => setEditing(null)} onSaved={() => { invalidateLookup(SOURCES_LOOKUP); void reload(); }} />
    </Section>
  );
}

function DocumentsPanel() {
  const { toast, toastError } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useAdminApi<{ items: DocumentSummary[]; total: number }>(`/admin/documents?limit=50&offset=${offset}`);

  async function upload(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast({ tone: 'warning', title: 'Choisissez un fichier' });
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    if (sourceId) fd.append('sourceId', sourceId);
    setBusy(true);
    try {
      const r = await api<{ duplicate: boolean; document: DocumentDetail }>('/admin/documents', { method: 'POST', body: fd });
      toast({
        tone: r.document.ocrStatus === 'NEEDS_OCR' ? 'warning' : 'success',
        title: r.duplicate ? 'Document déjà présent (même empreinte SHA-256)' : 'Document téléversé',
        body: r.document.ocrStatus === 'NEEDS_OCR'
          ? 'PDF scanné sans couche texte : collez son texte dans « Extraire depuis un texte ».'
          : <Link href={`/admin/sources/documents/${r.document.id}`} className="font-semibold underline">Ouvrir et extraire ({r.document.pageCount ?? '?'} page(s), {r.document.chunkCount} extrait(s))</Link>,
      }, 10000);
      if (fileRef.current) fileRef.current.value = '';
      void reload();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Section title="Téléverser un document" description="PDF avec couche texte, HTML ou TXT (UTF-8), 20 Mo max. Les doublons sont détectés par empreinte.">
        <form onSubmit={upload} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label="Fichier" htmlFor="doc-file"><input id="doc-file" ref={fileRef} type="file" accept=".pdf,.txt,.html,.htm,application/pdf,text/plain,text/html" className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:font-semibold file:text-primary" /></Field>
          <Field label="Source (avis, ministère…)" htmlFor="doc-src"><SourcePicker id="doc-src" value={sourceId} onChange={setSourceId} /></Field>
          <Button type="submit" loading={busy}><FileUp className="size-4" aria-hidden />Téléverser</Button>
        </form>
      </Section>
      <Section title="Documents" actions={<Button size="sm" variant="ghost" onClick={() => void reload()}><RotateCcw className="size-4" aria-hidden />Recharger</Button>}>
        {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : !data ? <Loading /> : !data.items.length ? <Empty title="Aucun document" /> : (
          <div className={clsx('flex flex-col gap-2', loading && 'opacity-60')}>
            <TableWrap>
              <table className={tableCls}>
                <thead><tr><th className={thCls}>Fichier</th><th className={thCls}>Source</th><th className={thCls}>Pages</th><th className={thCls}>Texte</th><th className={thCls}>Ajouté</th></tr></thead>
                <tbody>
                  {data.items.map((d) => (
                    <tr key={d.id}>
                      <td className={tdCls}>
                        <Link href={`/admin/sources/documents/${d.id}`} className="inline-flex items-center gap-1.5 font-semibold hover:text-primary hover:underline" dir="auto"><FileText className="size-4 shrink-0" aria-hidden />{d.filename ?? d.sha256.slice(0, 12)}</Link>
                        <p className="text-xs text-muted">{d.mime} · {d.language ?? '?'}</p>
                      </td>
                      <td className={tdCls}>{d.source ? <span dir="auto">{d.source.title}</span> : <span className="text-xs text-warning">Aucune</span>}</td>
                      <td className={clsx(tdCls, 'tabular-nums')}>{d.pageCount ?? '—'}</td>
                      <td className={tdCls}>{d.ocrStatus === 'NEEDS_OCR' ? <Badge tone="warning">Scanné (OCR requis)</Badge> : <Badge tone="success">{d.chunkCount} extrait(s)</Badge>}</td>
                      <td className={clsx(tdCls, 'whitespace-nowrap text-xs text-muted')}>{fmtDateTime(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={Math.floor(offset / 50) + 1} pageSize={50} total={data.total} onPage={(p) => setOffset((p - 1) * 50)} />
          </div>
        )}
      </Section>
    </div>
  );
}

function PasteExtract() {
  const { toastError } = useToast();
  const [text, setText] = useState('');
  const [familySlug, setFamilySlug] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<AiJob | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setJob(await api<AiJob>('/admin/ai/extract', { method: 'POST', body: { text, ...(familySlug ? { familySlug } : {}) } }));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  const proposal = job?.output as FactsProposal | undefined;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="Texte de l’avis" description="Collez le texte d’un avis (site officiel, JORT, PDF scanné retranscrit). Séparez les pages par un saut de page si besoin.">
        <form onSubmit={run} className="flex flex-col gap-3">
          <Textarea aria-label="Texte à analyser" rows={16} value={text} onChange={(e) => setText(e.target.value)} dir="auto" required maxLength={200_000} className="text-sm" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Concours (contexte)" htmlFor="pe-family"><FamilySelect id="pe-family" value={familySlug} onChange={setFamilySlug} emptyLabel="Non précisé" /></Field>
            <Field label="Source de ce texte" htmlFor="pe-src" hint="Reprise dans les formulaires pré-remplis."><SourcePicker id="pe-src" value={sourceId} onChange={setSourceId} /></Field>
          </div>
          <Button type="submit" loading={busy} disabled={!text.trim()} className="self-start"><ScanSearch className="size-4" aria-hidden />Extraire avec IA / heuristique</Button>
        </form>
      </Section>
      <Section title="Proposition (brouillon)" description="Rien n’est appliqué automatiquement : copiez les valeurs vérifiées dans une session ou un poste.">
        {!proposal ? <p className="text-sm text-muted">Lancez une extraction pour voir la proposition ici.</p> : (
          <ProposalPanel proposal={proposal} source={sourceId ? { id: sourceId, url: null } : null} defaultFamily={familySlug || null} />
        )}
      </Section>
    </div>
  );
}

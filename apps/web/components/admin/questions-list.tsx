'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, CheckCheck, Plus, RotateCcw, Search, TriangleAlert, Undo2 } from 'lucide-react';
import type { ContentStatus } from '@ctn/shared';
import { CONTENT_STATUSES, DOMAIN_LABELS, DOMAINS, QUESTION_ORIGINS } from '@ctn/shared/dist/enums';
import { Badge, Button, ButtonLink, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi, useDebounced, useUrlSync } from './hooks';
import { CONTENT_STATUS_LABEL, DIFFICULTY_LABEL, fmtDate, fmtNumber, fmtPct, ORIGIN_LABEL, qs, QUESTION_TYPE_LABEL, truncate } from './labels';
import { FamilySelect } from './pickers';
import { useAdmin } from './shell';
import { useToast } from './toast';
import type { BulkReviewResult, QuestionsResponse, QuestionSummary, ReviewAction } from './types';
import { AdminPage, Empty, ErrorBox, FilterBar, FilterField, Loading, Pagination, StatusBadge, TableWrap, tableCls, tdCls, thCls, useConfirm } from './ui';

const SORTS = [
  { v: 'recent', l: 'Modifiées récemment' },
  { v: 'oldest', l: 'Plus anciennes' },
  { v: 'accuracy', l: 'Taux de réussite (bas → haut)' },
  { v: 'attempts', l: 'Plus posées' },
  { v: 'reports', l: 'Plus signalées' },
];
const PAGE_SIZE = 25;

/** Accuracy that deserves a second look: almost nobody (key wrong?) or everybody (too easy / leaked) gets it right. */
function suspicious(q: QuestionSummary): 'low' | 'high' | null {
  if (q.stats.attempts < 20 || q.stats.accuracy == null) return null;
  if (q.stats.accuracy < 0.2) return 'low';
  if (q.stats.accuracy > 0.97) return 'high';
  return null;
}

export function QuestionsListView() {
  const sp = useSearchParams();
  const { refreshStats } = useAdmin();
  const { toast, toastError } = useToast();
  const confirm = useConfirm();

  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [domain, setDomain] = useState(sp.get('domain') ?? '');
  const [topicKey, setTopicKey] = useState(sp.get('topicKey') ?? '');
  const [familySlug, setFamilySlug] = useState(sp.get('familySlug') ?? '');
  const [origin, setOrigin] = useState(sp.get('origin') ?? '');
  const [reported, setReported] = useState(sp.get('reported') ?? '');
  const [sort, setSort] = useState(sp.get('sort') ?? 'recent');
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [page, setPage] = useState(Number(sp.get('page')) || 1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q.trim());
  const dTopic = useDebounced(topicKey.trim());

  // A search started elsewhere (sidebar) while this page is open arrives as a new ?q=. Our own URL sync writes the
  // debounced value, so only a different value is an external change.
  const urlQ = sp.get('q') ?? '';
  useEffect(() => {
    if (urlQ !== dq) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  const filters = { status, domain, topicKey: dTopic, familySlug, origin, reported, sort: sort === 'recent' ? '' : sort, q: dq };
  const filterKey = JSON.stringify(filters);
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    // A new filter starts from page 1 (but the page from the URL survives the first render).
    if (prevFilterKey.current === filterKey) return;
    prevFilterKey.current = filterKey;
    setPage(1);
  }, [filterKey]);
  useEffect(() => setSelected(new Set()), [filterKey, page]);

  useUrlSync(`/admin/questions${qs({ ...filters, page: page > 1 ? page : undefined })}`);

  const { data, error, loading, reload } = useAdminApi<QuestionsResponse>(`/admin/questions${qs({ ...filters, page, pageSize: PAGE_SIZE })}`);
  const items = useMemo(() => data?.items ?? [], [data]);
  const totalAll = data ? CONTENT_STATUSES.reduce((n, s) => n + (data.counts[s] ?? 0), 0) : 0;

  async function bulk(action: ReviewAction) {
    const ids = [...selected];
    if (!ids.length) return;
    const labels: Record<ReviewAction, string> = { approve: 'Approuver', publish: 'Approuver + publier', reject: 'Rejeter', archive: 'Archiver', to_draft: 'Repasser en brouillon' };
    const r = await confirm.ask({
      title: `${labels[action]} ${ids.length} question(s) ?`,
      body: action === 'publish' ? 'Vous attestez les avoir relues : elles seront servies aux candidats.' : 'Les transitions non autorisées sont ignorées et listées.',
      tone: action === 'archive' || action === 'reject' ? 'danger' : 'primary',
      confirmLabel: labels[action],
      comment: action === 'reject' ? { label: 'Motif', required: true } : undefined,
    });
    if (!r) return;
    setBusy(true);
    try {
      const res = await api<BulkReviewResult>('/admin/review/questions/bulk', { method: 'POST', body: { ids, action, ...(r.comment ? { comment: r.comment } : {}) } });
      toast({
        tone: res.failed.length ? 'warning' : 'success',
        title: `${res.ok.length} question(s) mise(s) à jour${res.failed.length ? `, ${res.failed.length} refusée(s)` : ''}`,
        details: res.failed.slice(0, 6).map((f) => `${f.id.slice(0, 8)}… : ${f.error}`),
      });
      setSelected(new Set());
      void reload();
      void refreshStats();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const statusTabs: { v: string; l: string; n: number }[] = [
    { v: '', l: 'Tous', n: totalAll },
    ...CONTENT_STATUSES.map((s: ContentStatus) => ({ v: s, l: CONTENT_STATUS_LABEL[s], n: data?.counts[s] ?? 0 })),
  ];

  return (
    <AdminPage
      title="Banque de questions"
      subtitle="Filtrez, repérez les questions suspectes (taux de réussite extrême, signalements) et ouvrez l’éditeur."
      actions={<ButtonLink href="/admin/questions/new" size="sm"><Plus className="size-4" aria-hidden />Nouvelle question</ButtonLink>}
    >
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Statut">
        {statusTabs.map((t) => (
          <button
            key={t.v || 'all'}
            role="tab"
            aria-selected={status === t.v}
            onClick={() => setStatus(t.v)}
            className={clsx('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition', status === t.v ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
          >
            {t.l} <span className="tabular-nums text-muted">{data ? fmtNumber(t.n) : ''}</span>
          </button>
        ))}
      </div>

      <FilterBar>
        <FilterField label="Recherche" htmlFor="qf-q" className="min-w-56 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input id="qf-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Énoncé, explication, ext_id ou id…" className="ps-9" dir="auto" />
          </div>
        </FilterField>
        <FilterField label="Domaine" htmlFor="qf-domain">
          <Select id="qf-domain" value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">Tous</option>
            {DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABELS[d].fr}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Thème (clé, sous-thèmes inclus)" htmlFor="qf-topic">
          <Input id="qf-topic" value={topicKey} onChange={(e) => setTopicKey(e.target.value)} placeholder="cg.histoire" dir="ltr" />
        </FilterField>
        <FilterField label="Concours" htmlFor="qf-family"><FamilySelect id="qf-family" value={familySlug} onChange={setFamilySlug} /></FilterField>
        <FilterField label="Origine" htmlFor="qf-origin">
          <Select id="qf-origin" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">Toutes</option>
            {QUESTION_ORIGINS.map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Signalements" htmlFor="qf-rep">
          <Select id="qf-rep" value={reported} onChange={(e) => setReported(e.target.value)}>
            <option value="">Indifférent</option>
            <option value="true">Avec signalement ouvert</option>
            <option value="false">Sans signalement</option>
          </Select>
        </FilterField>
        <FilterField label="Tri" htmlFor="qf-sort">
          <Select id="qf-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </Select>
        </FilterField>
      </FilterBar>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-primary-soft p-2 text-sm">
          <span className="font-semibold">{selected.size} sélectionnée(s)</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void bulk('approve')}><Check className="size-4" aria-hidden />Approuver</Button>
          <Button size="sm" disabled={busy} onClick={() => void bulk('publish')}><CheckCheck className="size-4" aria-hidden />Publier</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void bulk('to_draft')}><Undo2 className="size-4" aria-hidden />Brouillon</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void bulk('archive')}><Archive className="size-4" aria-hidden />Archiver</Button>
        </div>
      )}

      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : !data ? <Loading /> : !items.length ? (
        <Empty title="Aucune question" body="Modifiez les filtres ou créez une question." action={<ButtonLink href="/admin/questions/new" size="sm" variant="secondary"><Plus className="size-4" aria-hidden />Nouvelle question</ButtonLink>} />
      ) : (
        <div className={clsx('flex flex-col gap-3', loading && 'opacity-60')}>
          <TableWrap>
            <table className={clsx(tableCls, 'min-w-[1000px]')}>
              <thead>
                <tr>
                  <th className={thCls}>
                    <input type="checkbox" aria-label="Tout sélectionner" className="size-4 accent-[var(--primary)]" checked={items.every((i) => selected.has(i.id))} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
                  </th>
                  <th className={thCls}>Énoncé</th>
                  <th className={thCls}>Statut</th>
                  <th className={thCls}>Thème</th>
                  <th className={thCls}>Type · niveau</th>
                  <th className={thCls}>Origine</th>
                  <th className={thCls}>Réussite</th>
                  <th className={thCls}>Signal.</th>
                  <th className={thCls}>Modifiée</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const sus = suspicious(it);
                  return (
                    <tr key={it.id} className="hover:bg-surface-2/60">
                      <td className={tdCls}>
                        <input type="checkbox" aria-label="Sélectionner" className="size-4 accent-[var(--primary)]" checked={selected.has(it.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(it.id); else n.delete(it.id); return n; })} />
                      </td>
                      <td className={clsx(tdCls, 'max-w-md')}>
                        <Link href={`/admin/questions/${it.id}`} className="font-semibold hover:text-primary hover:underline" dir="auto">{truncate(it.stem, 140)}</Link>
                        <div className="mt-0.5 text-xs text-muted">{DOMAIN_LABELS[it.domain]?.fr} · v{it.version}{it.extId ? ` · ${it.extId}` : ''}</div>
                      </td>
                      <td className={tdCls}><StatusBadge status={it.status} /></td>
                      <td className={tdCls}>
                        <button type="button" className="text-start hover:text-primary" onClick={() => setTopicKey(it.topicKey)} title="Filtrer sur ce thème">
                          <span className="block text-sm">{it.topicTitle_fr}</span>
                          <code className="text-xs text-muted">{it.topicKey}</code>
                        </button>
                      </td>
                      <td className={clsx(tdCls, 'whitespace-nowrap text-xs')}>{QUESTION_TYPE_LABEL[it.type]}<br /><span className="text-muted">{DIFFICULTY_LABEL[it.difficulty]}</span></td>
                      <td className={tdCls}>{it.origin === 'AI_GENERATED' ? <Badge tone="accent" title={it.aiModel ?? undefined}>IA</Badge> : <span className="text-xs">{ORIGIN_LABEL[it.origin] ?? it.origin}</span>}</td>
                      <td className={clsx(tdCls, 'whitespace-nowrap tabular-nums')}>
                        {it.stats.accuracy == null ? <span className="text-muted">—</span> : (
                          <span className={clsx(sus === 'low' && 'font-semibold text-danger', sus === 'high' && 'font-semibold text-warning')}>
                            {sus && <TriangleAlert className="me-1 inline size-3.5" aria-label={sus === 'low' ? 'Taux très bas : clé à vérifier' : 'Taux très haut : trop facile ?'} />}
                            {fmtPct(it.stats.accuracy)}
                          </span>
                        )}
                        <div className="text-xs text-muted">{fmtNumber(it.stats.attempts)} rép.</div>
                      </td>
                      <td className={tdCls}>{it.stats.openReports ? <Link href={`/admin/reports?questionId=${it.id}`}><Badge tone="danger">{it.stats.openReports}</Badge></Link> : <span className="text-muted">0</span>}</td>
                      <td className={clsx(tdCls, 'whitespace-nowrap text-xs text-muted')}>{fmtDate(it.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            <Button size="sm" variant="ghost" onClick={() => void reload()}><RotateCcw className="size-4" aria-hidden />Recharger</Button>
          </div>
        </div>
      )}
      {confirm.element}
    </AdminPage>
  );
}

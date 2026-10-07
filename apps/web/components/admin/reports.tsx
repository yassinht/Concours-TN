'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { CircleCheck, Pencil, RotateCcw, X } from 'lucide-react';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Badge, Button, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi, useUrlSync } from './hooks';
import { fmtDateTime, qs, REPORT_REASON_LABEL, REPORT_STATUS_LABEL, truncate } from './labels';
import { useAdmin } from './shell';
import { useToast } from './toast';
import type { ReportRow, ReportsResponse } from './types';
import { AdminPage, BarRow, Checkbox, Empty, ErrorBox, FilterBar, FilterField, Loading, Pagination, Section, StatusBadge } from './ui';

export function ReportsView() {
  const sp = useSearchParams();
  const { refreshStats } = useAdmin();
  const { toast, toastError } = useToast();
  const [status, setStatus] = useState(sp.get('status') ?? 'OPEN');
  const [questionId, setQuestionId] = useState(sp.get('questionId') ?? '');
  const [page, setPage] = useState(1);
  const [applyAll, setApplyAll] = useState(true);
  const [thank, setThank] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useUrlSync(`/admin/reports${qs({ status: status === 'OPEN' ? '' : status, questionId })}`);
  const { data, error, loading, reload } = useAdminApi<ReportsResponse>(`/admin/reports${qs({ status, questionId, page, pageSize: 30 })}`);
  const maxReason = Math.max(1, ...Object.values(data?.byReason ?? {}));

  async function update(r: ReportRow, next: 'RESOLVED' | 'REJECTED' | 'OPEN') {
    setBusyId(r.id);
    try {
      const res = await api<{ updated: number; notified: number }>(`/admin/reports/${r.id}`, {
        method: 'PATCH',
        body: { status: next, applyToQuestion: next !== 'OPEN' && applyAll, notifyReporter: next === 'RESOLVED' && thank },
      });
      toast({ tone: 'success', title: `${res.updated} signalement(s) → ${REPORT_STATUS_LABEL[next]}`, body: res.notified ? `${res.notified} candidat(s) remercié(s).` : undefined });
      void reload();
      void refreshStats();
    } catch (e) {
      toastError(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminPage
      title="Signalements"
      subtitle="Erreurs remontées par les candidats. Corrigez la question dans l’éditeur, puis marquez le signalement comme résolu : le candidat est remercié par une notification."
    >
      <FilterBar>
        <FilterField label="Statut" htmlFor="rp-status">
          <Select id="rp-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="OPEN">Ouverts</option>
            <option value="RESOLVED">Résolus</option>
            <option value="REJECTED">Rejetés</option>
            <option value="ALL">Tous</option>
          </Select>
        </FilterField>
        {questionId && (
          <div className="flex items-end gap-2">
            <Badge tone="info">Question {questionId.slice(0, 8)}…</Badge>
            <Button size="sm" variant="ghost" onClick={() => setQuestionId('')}><X className="size-4" aria-hidden />Toutes les questions</Button>
          </div>
        )}
        <div className="flex flex-col gap-0.5 self-end">
          <Checkbox checked={applyAll} onChange={setApplyAll} label="Appliquer à tous les signalements ouverts de la même question" />
          <Checkbox checked={thank} onChange={setThank} label="Remercier le candidat à la résolution" />
        </div>
      </FilterBar>

      {data && Object.keys(data.byReason).length > 0 && (
        <Section title="Motifs">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(data.byReason).map(([k, n]) => <BarRow key={k} label={REPORT_REASON_LABEL[k] ?? k} value={n} max={maxReason} tone="danger" />)}
          </div>
        </Section>
      )}

      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : !data ? <Loading /> : !data.items.length ? <Empty title="Aucun signalement" body={status === 'OPEN' ? 'Rien à traiter. Merci !' : undefined} /> : (
        <div className={clsx('flex flex-col gap-3', loading && 'opacity-60')}>
          <ul className="flex flex-col gap-3">
            {data.items.map((r) => (
              <li key={r.id} className="card flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="danger">{REPORT_REASON_LABEL[r.reason] ?? r.reason}</Badge>
                  <Badge tone={r.status === 'OPEN' ? 'warning' : r.status === 'RESOLVED' ? 'success' : 'neutral'}>{REPORT_STATUS_LABEL[r.status] ?? r.status}</Badge>
                  {r.question.openReports > 1 && <Badge tone="danger">{r.question.openReports} signalements ouverts sur cette question</Badge>}
                  <span className="ms-auto text-xs text-muted">{fmtDateTime(r.createdAt)} · {r.reporter?.name ?? 'Anonyme'}</span>
                </div>
                {r.comment && <p className="rounded-lg bg-surface-2 p-2 text-sm" dir="auto">« {r.comment} »</p>}
                <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/questions/${r.question.id}`} className="font-semibold hover:text-primary hover:underline" dir="auto">{truncate(r.question.stem, 200)}</Link>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted"><StatusBadge status={r.question.status} /> {DOMAIN_LABELS[r.question.domain]?.fr} · <code>{r.question.topicKey}</code> · v{r.question.version}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Link href={`/admin/questions/${r.question.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2"><Pencil className="size-4" aria-hidden />Corriger</Link>
                    {r.status === 'OPEN' ? (
                      <>
                        <Button size="sm" loading={busyId === r.id} onClick={() => void update(r, 'RESOLVED')}><CircleCheck className="size-4" aria-hidden />Résolu</Button>
                        <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => void update(r, 'REJECTED')}><X className="size-4" aria-hidden />Rejeter</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => void update(r, 'OPEN')}><RotateCcw className="size-4" aria-hidden />Rouvrir</Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}
    </AdminPage>
  );
}

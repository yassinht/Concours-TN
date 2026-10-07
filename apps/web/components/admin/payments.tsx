'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { CircleCheck, RotateCcw, X } from 'lucide-react';
import { PAYMENT_PROVIDERS, PAYMENT_STATUSES } from '@ctn/shared/dist/enums';
import { formatTnd } from '@ctn/shared/dist/pricing';
import { Badge, Button, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi } from './hooks';
import { fmtDateTime, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, qs } from './labels';
import { AdminOnly, useAdmin } from './shell';
import { useToast } from './toast';
import type { PaymentRow, PaymentsResponse } from './types';
import { AdminPage, Empty, ErrorBox, FilterBar, FilterField, Loading, Pagination, StatCard, TableWrap, tableCls, tdCls, thCls, useConfirm } from './ui';

export function PaymentsView() {
  return <AdminOnly><PaymentsInner /></AdminOnly>;
}

function PaymentsInner() {
  const { refreshStats } = useAdmin();
  const { toast, toastError } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState('PENDING');
  const [provider, setProvider] = useState('MANUAL');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, error, loading, reload, setData } = useAdminApi<PaymentsResponse>(`/admin/payments${qs({ status, provider, page, pageSize: 50 })}`);

  async function approve(p: PaymentRow) {
    const ok = await confirm.ask({
      title: 'Valider ce paiement ?',
      tone: 'primary',
      confirmLabel: 'Valider et activer Premium',
      body: (
        <div className="flex flex-col gap-1">
          <p>Vérifiez sur le relevé (D17 / virement) la réception de <b>{formatTnd(p.amountMillimes, 'fr')}</b>{p.manualReference ? <> avec la référence <b dir="ltr">{p.manualReference}</b></> : <b className="text-warning"> — aucune référence fournie</b>}.</p>
          <p>L’abonnement {p.plan.name_fr} de {p.user.name ?? p.user.email} sera activé immédiatement.</p>
        </div>
      ),
    });
    if (!ok) return;
    setBusyId(p.id);
    try {
      const r = await api<PaymentRow>(`/admin/payments/${p.id}/approve`, { method: 'POST', body: {} });
      setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === p.id ? r : x)) } : d));
      toast({ tone: 'success', title: 'Paiement validé', body: 'Premium activé pour le candidat.' });
      void refreshStats();
    } catch (e) {
      toastError(e);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(p: PaymentRow) {
    const r = await confirm.ask({
      title: 'Rejeter ce paiement ?',
      confirmLabel: 'Rejeter',
      body: 'Le paiement passe en « Échoué / rejeté ». Le candidat pourra recommencer.',
      comment: { label: 'Motif (visible dans l’historique)', placeholder: 'Aucun virement reçu avec cette référence' },
    });
    if (!r) return;
    setBusyId(p.id);
    try {
      const res = await api<PaymentRow>(`/admin/payments/${p.id}/reject`, { method: 'POST', body: r.comment ? { reason: r.comment } : {} });
      setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === p.id ? res : x)) } : d));
      toast({ tone: 'success', title: 'Paiement rejeté' });
      void refreshStats();
    } catch (e) {
      toastError(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminPage title="Paiements" subtitle="Les paiements Konnect / Flouci sont confirmés par le prestataire. Les virements et D17 (manuels) se valident ici, après contrôle du relevé.">
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Manuels en attente" value={data.summary.pendingManual} tone={data.summary.pendingManual ? 'warning' : undefined} />
          <StatCard label="… dont avec justificatif" value={data.summary.pendingManualWithProof} sub="À traiter en priorité" tone={data.summary.pendingManualWithProof ? 'danger' : undefined} />
        </div>
      )}
      <FilterBar>
        <FilterField label="Statut" htmlFor="pf-status">
          <Select id="pf-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Tous</option>
            {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_STATUS_LABEL[s]}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Moyen" htmlFor="pf-provider">
          <Select id="pf-provider" value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
            <option value="">Tous</option>
            {PAYMENT_PROVIDERS.map((p) => <option key={p} value={p}>{p === 'MANUAL' ? 'Manuel (D17 / virement)' : p}</option>)}
          </Select>
        </FilterField>
        <Button size="sm" variant="ghost" className="self-end" onClick={() => void reload()}><RotateCcw className="size-4" aria-hidden />Recharger</Button>
      </FilterBar>
      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : !data ? <Loading /> : !data.items.length ? <Empty title="Aucun paiement" body={status === 'PENDING' ? 'Rien à valider.' : undefined} /> : (
        <div className={clsx('flex flex-col gap-2', loading && 'opacity-60')}>
          <TableWrap>
            <table className={clsx(tableCls, 'min-w-[1000px]')}>
              <thead><tr><th className={thCls}>Candidat</th><th className={thCls}>Formule</th><th className={thCls}>Montant</th><th className={thCls}>Moyen</th><th className={thCls}>Référence</th><th className={thCls}>Statut</th><th className={thCls}>Créé</th><th className={thCls}>Actions</th></tr></thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td className={tdCls}><p className="font-semibold">{p.user.name ?? '—'}</p><p className="text-xs text-muted">{p.user.email ?? ''}{p.user.phone ? ` · ${p.user.phone}` : ''}</p></td>
                    <td className={tdCls}>{p.plan.name_fr}{p.promoCode && <Badge tone="accent" className="ms-1">{p.promoCode}</Badge>}</td>
                    <td className={clsx(tdCls, 'whitespace-nowrap font-semibold tabular-nums')}>{formatTnd(p.amountMillimes, 'fr')}</td>
                    <td className={tdCls}>{p.provider}</td>
                    <td className={tdCls}>{p.manualReference ? <code className="text-xs" dir="ltr">{p.manualReference}</code> : p.providerRef ? <code className="text-xs text-muted" dir="ltr">{p.providerRef}</code> : <span className="text-xs text-muted">—</span>}</td>
                    <td className={tdCls}>
                      <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                      {p.failureReason && <p className="text-xs text-muted" dir="auto">{p.failureReason}</p>}
                    </td>
                    <td className={clsx(tdCls, 'whitespace-nowrap text-xs')}>{fmtDateTime(p.createdAt)}{p.paidAt && <p className="text-success">Payé {fmtDateTime(p.paidAt)}</p>}</td>
                    <td className={tdCls}>
                      {p.provider === 'MANUAL' && p.status === 'PENDING' ? (
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" loading={busyId === p.id} onClick={() => void approve(p)}><CircleCheck className="size-4" aria-hidden />Valider</Button>
                          <Button size="sm" variant="secondary" disabled={busyId === p.id} onClick={() => void reject(p)}><X className="size-4" aria-hidden />Rejeter</Button>
                        </div>
                      ) : <span className="text-xs text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}
      {confirm.element}
    </AdminPage>
  );
}

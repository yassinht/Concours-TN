'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi } from './hooks';
import { ANNOUNCE_BLOCK_LABEL, daysFromToday, fmtDate, fmtDateTime } from './labels';
import { useAdmin } from './shell';
import { useToast } from './toast';
import type { AdminEdition, Paged } from './types';
import { EditionStatusBadge, Empty, ErrorBox, Loading, Section, StatusBadge, TableWrap, tableCls, tdCls, thCls, useConfirm, VerifyBadge } from './ui';

/**
 * Open / announced sessions and the state of their "concours matching your profile" alerts, with a one-click
 * "notify matching candidates" (POST /admin/editions/:id/notify).
 */
export function OpenEditionsPanel() {
  const { refreshStats } = useAdmin();
  const { toast, toastError } = useToast();
  const confirm = useConfirm();
  const open = useAdminApi<Paged<AdminEdition>>('/admin/editions?status=OPEN&pageSize=100');
  const announced = useAdminApi<Paged<AdminEdition>>('/admin/editions?status=ANNOUNCED&pageSize=100');
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = [...(open.data?.items ?? []), ...(announced.data?.items ?? [])].filter((e) => e.contentStatus !== 'ARCHIVED');
    const key = (e: AdminEdition) => e.registrationDeadline ?? '9999-12-31';
    // Actionable first (ready but never sent), then by nearest deadline.
    return all.sort((a, b) => Number(!!a.alerts.sentAt || !a.alerts.announceable) - Number(!!b.alerts.sentAt || !b.alerts.announceable) || key(a).localeCompare(key(b)));
  }, [open.data, announced.data]);
  const pending = rows.filter((e) => e.alerts.announceable && !e.alerts.sentAt).length;

  async function notify(e: AdminEdition) {
    const ok = await confirm.ask({
      title: `Notifier les candidats — ${e.familyName_fr} ${e.year}`,
      tone: 'primary',
      confirmLabel: 'Envoyer les alertes',
      body: 'Les candidats dont le profil correspond aux conditions des postes de cette session reçoivent une alerte (in-app, push, e-mail selon leurs préférences). Ceux déjà alertés ne le sont pas deux fois.',
    });
    if (!ok) return;
    setBusyId(e.id);
    try {
      const r = await api<{ matchedUsers: number; notified: number }>(`/admin/editions/${e.id}/notify`, { method: 'POST', body: {} });
      toast({ tone: 'success', title: 'Alertes envoyées', body: `${r.matchedUsers} candidat(s) correspondant(s) · ${r.notified} nouvellement notifié(s).` }, 10000);
      void open.reload();
      void announced.reload();
      void refreshStats();
    } catch (err) {
      toastError(err);
    } finally {
      setBusyId(null);
    }
  }

  const error = open.error ?? announced.error;
  return (
    <Section
      title={<span className="inline-flex items-center gap-2"><BellRing className="size-5 text-primary" aria-hidden />Sessions ouvertes et alertes candidats</span>}
      description={pending ? `${pending} session(s) prête(s) à alerter les candidats correspondants.` : 'Toutes les sessions annonçables ont déjà alerté leurs candidats.'}
    >
      {error && !open.data && !announced.data ? <ErrorBox error={error} onRetry={() => { void open.reload(); void announced.reload(); }} /> : (!open.data || !announced.data) ? <Loading /> : !rows.length ? (
        <Empty title="Aucune session annoncée ou ouverte" body="Créez une session depuis la fiche d’un concours ou depuis la veille des pages officielles." />
      ) : (
        <TableWrap>
          <table className={clsx(tableCls, 'min-w-[960px]')}>
            <thead>
              <tr><th className={thCls}>Session</th><th className={thCls}>Statut</th><th className={thCls}>Clôture</th><th className={thCls}>Vérification</th><th className={thCls}>Alertes</th><th className={thCls}><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const left = daysFromToday(e.registrationDeadline);
                return (
                  <tr key={e.id}>
                    <td className={tdCls}>
                      <Link href={`/admin/concours/${e.familySlug}?edition=${e.id}`} className="font-semibold hover:text-primary hover:underline">{e.familyName_fr} {e.year}{e.sessionLabel ? ` — ${e.sessionLabel}` : ''}</Link>
                      <p className="text-xs text-muted" lang="ar" dir="rtl">{e.familyName_ar}</p>
                    </td>
                    <td className={tdCls}><div className="flex flex-col items-start gap-1"><EditionStatusBadge status={e.status} /><StatusBadge status={e.contentStatus} /></div></td>
                    <td className={clsx(tdCls, 'whitespace-nowrap')}>
                      {fmtDate(e.registrationDeadline)}
                      {left != null && (left >= 0 ? <Badge tone={left <= 3 ? 'danger' : left <= 7 ? 'warning' : 'neutral'} className="ms-1">J-{left}</Badge> : <Badge tone="neutral" className="ms-1">passée</Badge>)}
                    </td>
                    <td className={tdCls}><VerifyBadge needsVerification={e.needsVerification} /></td>
                    <td className={clsx(tdCls, 'text-xs')}>
                      {e.alerts.sentAt
                        ? <p className="text-success">Envoyées le {fmtDateTime(e.alerts.sentAt)}</p>
                        : e.alerts.announceable ? <p className="font-semibold text-warning">Prête, non envoyée</p> : <p className="text-muted">Bloquée : {ANNOUNCE_BLOCK_LABEL[e.alerts.blockedBy ?? ''] ?? e.alerts.blockedBy}</p>}
                      <p className="tabular-nums">{e.alerts.matchedUsers} correspondant(s) · {e.alerts.notifiedUsers} notifié(s)</p>
                    </td>
                    <td className={tdCls}>
                      <Button size="sm" variant={e.alerts.sentAt ? 'secondary' : 'primary'} loading={busyId === e.id} disabled={!e.alerts.announceable || (!!busyId && busyId !== e.id)} onClick={() => void notify(e)} title={e.alerts.announceable ? undefined : ANNOUNCE_BLOCK_LABEL[e.alerts.blockedBy ?? '']}>
                        <BellRing className="size-4" aria-hidden />{e.alerts.sentAt ? 'Relancer' : 'Notifier'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      {confirm.element}
    </Section>
  );
}

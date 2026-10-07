'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useDebounced } from './hooks';
import { fmtDateTime, qs } from './labels';
import { useAdmin } from './shell';
import { useToast } from './toast';
import type { AuditResponse, AuditRow } from './types';
import { AdminPage, Empty, ErrorBox, FilterBar, FilterField, JsonBlock, Loading, TableWrap, tableCls, tdCls, thCls } from './ui';

const ENTITY_TYPES = ['question', 'lesson', 'fact', 'edition', 'family', 'position', 'eligibility', 'phase', 'subject', 'source', 'blueprint', 'report', 'source_document', 'ai_job', 'watched_source', 'ingest_candidate', 'organization', 'user', 'payment', 'notification', 'waitlist'];
const PAGE = 100;

/** Link to the admin page of an audited entity, when there is one. */
function entityHref(r: AuditRow): string | null {
  if (!r.entityId) return null;
  switch (r.entityType) {
    case 'question': return `/admin/questions/${r.entityId}`;
    case 'source_document': return `/admin/sources/documents/${r.entityId}`;
    case 'report': return '/admin/reports?status=ALL';
    case 'ai_job': return '/admin/ai';
    default: return null;
  }
}

export function AuditView() {
  const { isAdmin } = useAdmin();
  const { toastError } = useToast();
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const dAction = useDebounced(action.trim());
  const dEntity = useDebounced(entityId.trim());
  const base = qs({ entityType, action: dAction, entityId: dEntity, limit: PAGE });

  async function load(before: string | null) {
    setLoading(true);
    try {
      const r = await api<AuditResponse>(`/admin/audit${base}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      setRows((prev) => (before && prev ? [...prev, ...r.items] : r.items));
      setNext(r.nextBefore);
      setError(null);
    } catch (e) {
      if (before) toastError(e);
      else setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setRows(null);
    void load(null);
    // `load` closes over `base` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  return (
    <AdminPage title="Journal d’audit" subtitle={isAdmin ? 'Toutes les actions du back-office.' : 'Actions sur le contenu (les comptes, paiements et diffusions sont réservés aux administrateurs).'}>
      <FilterBar>
        <FilterField label="Type d’élément" htmlFor="au-type">
          <Select id="au-type" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">Tous</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Action (préfixe)" htmlFor="au-action"><Input id="au-action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="review, edition, payment.approve…" dir="ltr" /></FilterField>
        <FilterField label="Identifiant" htmlFor="au-id"><Input id="au-id" value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="uuid" dir="ltr" /></FilterField>
        <Button size="sm" variant="ghost" className="self-end" onClick={() => void load(null)}><RotateCcw className="size-4" aria-hidden />Recharger</Button>
      </FilterBar>
      {error && !rows ? <ErrorBox error={error} onRetry={() => void load(null)} /> : !rows ? <Loading /> : !rows.length ? <Empty title="Aucune entrée" /> : (
        <div className="flex flex-col gap-2">
          <TableWrap>
            <table className={clsx(tableCls, 'min-w-[900px]')}>
              <thead><tr><th className={thCls}>Date</th><th className={thCls}>Auteur</th><th className={thCls}>Action</th><th className={thCls}>Élément</th><th className={thCls}>Détails</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const href = entityHref(r);
                  return (
                    <tr key={r.id}>
                      <td className={clsx(tdCls, 'whitespace-nowrap text-xs')}>{fmtDateTime(r.createdAt)}</td>
                      <td className={tdCls}>{r.actor?.name ?? (r.actor ? r.actor.id.slice(0, 8) : 'système')}</td>
                      <td className={tdCls}><code className="text-xs">{r.action}</code></td>
                      <td className={clsx(tdCls, 'text-xs')}>
                        <span className="font-semibold">{r.entityType}</span>
                        {r.entityId && (href ? <Link href={href} className="ms-1 underline" dir="ltr">{r.entityId.slice(0, 12)}</Link> : <button type="button" className="ms-1 text-muted hover:underline" dir="ltr" onClick={() => setEntityId(r.entityId ?? '')} title="Filtrer sur cet élément">{r.entityId.slice(0, 12)}</button>)}
                      </td>
                      <td className={clsx(tdCls, 'max-w-md')}>
                        {r.diff != null && (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted">Voir</summary>
                            <JsonBlock value={r.diff} className="mt-1 max-h-60" />
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          {next && <Button variant="secondary" size="sm" className="self-center" loading={loading} onClick={() => void load(next)}>Charger plus</Button>}
        </div>
      )}
    </AdminPage>
  );
}

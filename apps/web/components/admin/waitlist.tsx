'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { useAdminApi } from './hooks';
import { fmtDateTime, fmtNumber, fmtPct, qs } from './labels';
import { FamilySelect } from './pickers';
import { AdminOnly } from './shell';
import type { WaitlistResponse } from './types';
import { AdminPage, BarRow, Empty, ErrorBox, FilterBar, FilterField, Loading, Pagination, Section, StatCard, TableWrap, tableCls, tdCls, thCls } from './ui';

const WILLINGNESS_ORDER = ['0', '10', '20', '40', '60+', 'unknown'];
const WILLINGNESS_LABEL: Record<string, string> = { '0': '0 DT (gratuit seulement)', '10': '10 DT / mois', '20': '20 DT / mois', '40': '40 DT / mois', '60+': '60 DT et plus', unknown: 'Non renseigné' };

export function WaitlistView() {
  return <AdminOnly><WaitlistInner /></AdminOnly>;
}

function WaitlistInner() {
  const [familySlug, setFamilySlug] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAdminApi<WaitlistResponse>(`/admin/waitlist${qs({ familySlug, page, pageSize: 100 })}`);
  const c = data?.counts;
  const willing = c ? WILLINGNESS_ORDER.filter((k) => c.byWillingness[k] != null).map((k) => [k, c.byWillingness[k]] as const) : [];
  const willMax = Math.max(1, ...willing.map(([, n]) => n));
  const answered = willing.filter(([k]) => k !== 'unknown').reduce((n, [, v]) => n + v, 0);
  const payers = willing.filter(([k]) => k !== '0' && k !== 'unknown').reduce((n, [, v]) => n + v, 0);
  const famMax = Math.max(1, ...(c?.byFamily ?? []).map((f) => f.count));

  return (
    <AdminPage
      title="Liste d’attente"
      subtitle="Personnes intéressées avant le lancement d’un concours ou d’une offre, avec leur disposition à payer."
      actions={<a href={`/api/admin/waitlist${qs({ format: 'csv', familySlug })}`} download className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2"><Download className="size-4" aria-hidden />Exporter CSV</a>}
    >
      <FilterBar>
        <FilterField label="Concours" htmlFor="wl-family"><FamilySelect id="wl-family" value={familySlug} onChange={(v) => { setFamilySlug(v); setPage(1); }} /></FilterField>
      </FilterBar>
      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : !data || !c ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Inscrits" value={fmtNumber(c.total)} />
            <StatCard label="7 derniers jours" value={fmtNumber(c.last7d)} tone="primary" />
            <StatCard label="30 derniers jours" value={fmtNumber(c.last30d)} />
            <StatCard label="Avec e-mail" value={fmtNumber(c.withEmail)} />
            <StatCard label="Avec téléphone" value={fmtNumber(c.withPhone)} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Disposition à payer" description={answered ? `${fmtPct(payers / answered)} des répondants paieraient (hors « 0 DT »).` : 'Aucune réponse pour l’instant.'}>
              <div className="flex flex-col gap-3">
                {willing.map(([k, n]) => <BarRow key={k} label={WILLINGNESS_LABEL[k] ?? k} value={n} max={willMax} tone={k === '0' ? 'warning' : k === 'unknown' ? 'info' : 'success'} sub={c.total ? `· ${fmtPct(n / c.total)}` : undefined} />)}
              </div>
            </Section>
            <Section title="Par concours">
              {!c.byFamily.length ? <p className="text-sm text-muted">—</p> : (
                <div className="flex flex-col gap-3">
                  {c.byFamily.map((f) => <BarRow key={f.familySlug ?? 'none'} label={f.familySlug ?? 'Sans concours'} value={f.count} max={famMax} />)}
                </div>
              )}
            </Section>
          </div>
          <Section title="Inscriptions">
            {!data.items.length ? <Empty title="Liste vide" /> : (
              <div className={clsx('flex flex-col gap-2', loading && 'opacity-60')}>
                <TableWrap>
                  <table className={tableCls}>
                    <thead><tr><th className={thCls}>Date</th><th className={thCls}>E-mail</th><th className={thCls}>Téléphone</th><th className={thCls}>Concours</th><th className={thCls}>Paierait</th><th className={thCls}>Provenance</th></tr></thead>
                    <tbody>
                      {data.items.map((w) => {
                        const utm = (w.utm ?? {}) as Record<string, string>;
                        return (
                          <tr key={w.id}>
                            <td className={clsx(tdCls, 'whitespace-nowrap text-xs')}>{fmtDateTime(w.createdAt)}</td>
                            <td className={tdCls}>{w.email ?? '—'}</td>
                            <td className={tdCls} dir="ltr">{w.phone ?? '—'}</td>
                            <td className={tdCls}>{w.familySlug ? <code className="text-xs">{w.familySlug}</code> : '—'}</td>
                            <td className={tdCls}>{w.willingness ? WILLINGNESS_LABEL[w.willingness] ?? w.willingness : '—'}</td>
                            <td className={clsx(tdCls, 'text-xs text-muted')}>{[utm.utm_source ?? utm.source, utm.utm_campaign ?? utm.campaign].filter(Boolean).join(' / ') || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </div>
            )}
          </Section>
        </>
      )}
    </AdminPage>
  );
}

'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ContentStatus, Domain } from '@ctn/shared';
import { CONTENT_STATUSES, DOMAIN_LABELS, DOMAINS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, Field, Input, Modal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi } from './hooks';
import { CONTENT_STATUS_LABEL, describeError, qs } from './labels';
import { FamilySelect } from './pickers';
import { useToast } from './toast';
import type { BlueprintRow, BlueprintSectionRow, FamilyDetail } from './types';
import { AdminPage, Checkbox, Empty, ErrorBox, FilterBar, FilterField, Loading, StatusBadge, TableWrap, tableCls, tdCls, thCls } from './ui';

const FIDELITY_LABEL = { OFFICIAL_FORMAT: 'Format officiel', APPROXIMATED: 'Approximé' } as const;

export function BlueprintsView() {
  const [familySlug, setFamilySlug] = useState('');
  const { data, error, loading, reload } = useAdminApi<BlueprintRow[]>(`/admin/blueprints${qs({ familySlug })}`);
  const [editing, setEditing] = useState<{ bp: BlueprintRow | null } | null>(null);

  return (
    <AdminPage
      title="Blueprints d’examens blancs"
      subtitle="Structure de chaque examen blanc par poste : sections (domaine, nombre de questions, minutes). « Format officiel » seulement si la structure est sourcée."
      actions={<Button size="sm" onClick={() => setEditing({ bp: null })}><Plus className="size-4" aria-hidden />Nouveau blueprint</Button>}
    >
      <FilterBar>
        <FilterField label="Concours" htmlFor="bp-family"><FamilySelect id="bp-family" value={familySlug} onChange={setFamilySlug} /></FilterField>
      </FilterBar>
      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : loading && !data ? <Loading /> : !data?.length ? <Empty title="Aucun blueprint" /> : (
        <TableWrap>
          <table className={clsx(tableCls, 'min-w-[900px]')}>
            <thead><tr><th className={thCls}>Blueprint</th><th className={thCls}>Poste</th><th className={thCls}>Sections</th><th className={thCls}>Durée</th><th className={thCls}>Fidélité</th><th className={thCls}>Statut</th><th className={thCls}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id}>
                  <td className={tdCls}><p className="font-semibold" dir="auto">{b.title}</p><p className="text-xs text-muted">{b.questionCount} questions</p></td>
                  <td className={tdCls}><p>{b.positionTitle_fr}</p><p className="text-xs text-muted"><code>{b.familySlug}</code> / <code>{b.positionSlug}</code></p></td>
                  <td className={clsx(tdCls, 'text-xs')}>
                    <ul>{b.sections.map((s, i) => <li key={i}>{DOMAIN_LABELS[s.domain]?.fr ?? s.domain}{s.specialtyKey ? ` (${s.specialtyKey})` : ''} : {s.count} q. · {s.minutes} min</li>)}</ul>
                  </td>
                  <td className={clsx(tdCls, 'tabular-nums')}>{b.totalMinutes} min</td>
                  <td className={tdCls}><Badge tone={b.fidelity === 'OFFICIAL_FORMAT' ? 'success' : 'warning'}>{FIDELITY_LABEL[b.fidelity]}</Badge></td>
                  <td className={tdCls}><StatusBadge status={b.status} /></td>
                  <td className={tdCls}><Button size="sm" variant="secondary" onClick={() => setEditing({ bp: b })}><Pencil className="size-4" aria-hidden />Modifier</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <BlueprintModal state={editing} defaultFamily={familySlug} onClose={() => setEditing(null)} onSaved={() => void reload()} />
    </AdminPage>
  );
}

interface Draft { familySlug: string; positionSlug: string; title: string; totalMinutes: string; fidelity: 'OFFICIAL_FORMAT' | 'APPROXIMATED'; status: ContentStatus; sections: BlueprintSectionRow[]; replace: boolean }

function sectionIssues(d: Draft): string[] {
  const out: string[] = [];
  const total = Number(d.totalMinutes) || 0;
  const minutes = d.sections.reduce((n, s) => n + (Number(s.minutes) || 0), 0);
  const count = d.sections.reduce((n, s) => n + (Number(s.count) || 0), 0);
  if (!d.sections.length) out.push('Au moins une section.');
  if (minutes > total) out.push(`Les sections durent ${minutes} min, plus que la durée totale (${total} min).`);
  if (count > 300) out.push('300 questions au maximum.');
  const seen = new Set<string>();
  d.sections.forEach((s, i) => {
    const key = `${s.domain}|${s.specialtyKey ?? ''}`;
    if (seen.has(key)) out.push(`Section ${i + 1} : domaine en double.`);
    seen.add(key);
    if (s.domain === 'SPECIALTY' && !s.specialtyKey) out.push(`Section ${i + 1} : clé de spécialité requise.`);
    if (!(s.count >= 1)) out.push(`Section ${i + 1} : au moins 1 question.`);
  });
  return out;
}

function BlueprintModal({ state, defaultFamily, onClose, onSaved }: { state: { bp: BlueprintRow | null } | null; defaultFamily: string; onClose: () => void; onSaved: () => void }) {
  const { toast, toastError } = useToast();
  const bp = state?.bp ?? null;
  const [d, setD] = useState<Draft>({ familySlug: '', positionSlug: '', title: '', totalMinutes: '60', fidelity: 'APPROXIMATED', status: 'PUBLISHED', sections: [], replace: false });
  const [busy, setBusy] = useState(false);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (state && !wasOpen.current) {
      setConflictId(null);
      setD(bp
        ? { familySlug: bp.familySlug, positionSlug: bp.positionSlug, title: bp.title, totalMinutes: String(bp.totalMinutes), fidelity: bp.fidelity, status: bp.status, sections: bp.sections.map((s) => ({ ...s })), replace: false }
        : { familySlug: defaultFamily, positionSlug: '', title: '', totalMinutes: '60', fidelity: 'APPROXIMATED', status: 'PUBLISHED', sections: [{ domain: 'CULTURE_GENERALE', specialtyKey: null, count: 20, minutes: 20 }], replace: false });
    }
    wasOpen.current = !!state;
  }, [state, bp, defaultFamily]);
  const { data: family } = useAdminApi<FamilyDetail>(state && !bp && d.familySlug ? `/admin/families/${d.familySlug}` : null);
  const issues = sectionIssues(d);
  const setSection = (i: number, patch: Partial<BlueprintSectionRow>) => setD((x) => ({ ...x, sections: x.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (issues.length) return;
    setBusy(true);
    const common = {
      title: d.title.trim(), totalMinutes: Number(d.totalMinutes), fidelity: d.fidelity, status: d.status,
      sections: d.sections.map((s) => ({ domain: s.domain, specialtyKey: s.specialtyKey?.trim() || null, count: Number(s.count), minutes: Number(s.minutes) })),
    };
    try {
      if (bp) await api(`/admin/blueprints/${bp.id}`, { method: 'PATCH', body: common });
      else await api(`/admin/blueprints${d.replace ? '?replace=true' : ''}`, { method: 'POST', body: { ...common, familySlug: d.familySlug, positionSlug: d.positionSlug } });
      toast({ tone: 'success', title: bp ? 'Blueprint mis à jour' : 'Blueprint créé' });
      onSaved();
      onClose();
    } catch (err) {
      const desc = describeError(err);
      if (desc.code === 'BLUEPRINT_EXISTS') setConflictId('exists');
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  const minutes = d.sections.reduce((n, s) => n + (Number(s.minutes) || 0), 0);
  const count = d.sections.reduce((n, s) => n + (Number(s.count) || 0), 0);

  return (
    <Modal open={!!state} onClose={onClose} title={bp ? `Blueprint : ${bp.title}` : 'Nouveau blueprint'}>
      <form onSubmit={save} className="flex flex-col gap-3">
        {!bp && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Concours" htmlFor="bpf-family"><FamilySelect id="bpf-family" value={d.familySlug} onChange={(v) => setD((x) => ({ ...x, familySlug: v, positionSlug: '' }))} allowEmpty={false} required /></Field>
            <Field label="Poste" htmlFor="bpf-pos">
              <Select id="bpf-pos" required value={d.positionSlug} onChange={(e) => setD((x) => ({ ...x, positionSlug: e.target.value }))}>
                <option value="" disabled>Choisir…</option>
                {(family?.slug === d.familySlug ? family.positions : []).map((p) => <option key={p.slug} value={p.slug}>{p.title_fr}</option>)}
              </Select>
            </Field>
          </div>
        )}
        <Field label="Titre" htmlFor="bpf-title"><Input id="bpf-title" required minLength={2} value={d.title} onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))} dir="auto" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Durée totale (min)" htmlFor="bpf-total"><Input id="bpf-total" type="number" min={1} max={600} required value={d.totalMinutes} onChange={(e) => setD((x) => ({ ...x, totalMinutes: e.target.value }))} /></Field>
          <Field label="Fidélité" htmlFor="bpf-fid">
            <Select id="bpf-fid" value={d.fidelity} onChange={(e) => setD((x) => ({ ...x, fidelity: e.target.value as Draft['fidelity'] }))}>
              <option value="APPROXIMATED">Approximé</option>
              <option value="OFFICIAL_FORMAT">Format officiel (sourcé)</option>
            </Select>
          </Field>
          <Field label="Statut" htmlFor="bpf-status">
            <Select id="bpf-status" value={d.status} onChange={(e) => setD((x) => ({ ...x, status: e.target.value as ContentStatus }))}>
              {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{CONTENT_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Sections <span className="font-normal text-muted">({count} questions · {minutes} min)</span></legend>
          {d.sections.map((s, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-2">
              <Field label="Domaine" htmlFor={`bps-d-${i}`}>
                <Select id={`bps-d-${i}`} value={s.domain} onChange={(e) => setSection(i, { domain: e.target.value as Domain })} className="h-10 w-44">
                  {DOMAINS.map((x) => <option key={x} value={x}>{DOMAIN_LABELS[x].fr}</option>)}
                </Select>
              </Field>
              {s.domain === 'SPECIALTY' && <Field label="Spécialité (clé)" htmlFor={`bps-k-${i}`}><Input id={`bps-k-${i}`} value={s.specialtyKey ?? ''} onChange={(e) => setSection(i, { specialtyKey: e.target.value })} dir="ltr" className="h-10 w-36" /></Field>}
              <Field label="Questions" htmlFor={`bps-c-${i}`}><Input id={`bps-c-${i}`} type="number" min={1} max={200} value={s.count} onChange={(e) => setSection(i, { count: Number(e.target.value) })} className="h-10 w-24" /></Field>
              <Field label="Minutes" htmlFor={`bps-m-${i}`}><Input id={`bps-m-${i}`} type="number" min={0} max={600} value={s.minutes} onChange={(e) => setSection(i, { minutes: Number(e.target.value) })} className="h-10 w-24" /></Field>
              <Button type="button" size="sm" variant="ghost" aria-label={`Supprimer la section ${i + 1}`} onClick={() => setD((x) => ({ ...x, sections: x.sections.filter((_, j) => j !== i) }))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" className="self-start" disabled={d.sections.length >= 30} onClick={() => setD((x) => ({ ...x, sections: [...x.sections, { domain: 'LOGIC', specialtyKey: null, count: 10, minutes: 10 }] }))}><Plus className="size-4" aria-hidden />Ajouter une section</Button>
        </fieldset>
        {issues.length > 0 && <ul className="list-disc ps-5 text-xs text-danger" role="alert">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}
        {!bp && (conflictId || d.replace) && (
          <Alert tone="warning">
            Ce poste a déjà un blueprint actif. Les examens blancs n’en utilisent qu’un.
            <Checkbox className="mt-1" checked={d.replace} onChange={(v) => setD((x) => ({ ...x, replace: v }))} label="Remplacer l’actuel (il sera archivé)" />
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={busy} disabled={issues.length > 0}>{bp ? 'Enregistrer' : 'Créer'}</Button>
        </div>
      </form>
    </Modal>
  );
}

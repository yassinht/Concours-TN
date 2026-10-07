'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { ChevronUp, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import type { Confidence, DiplomaLevel, EligibilityRules } from '@ctn/shared';
import { CONFIDENCES, DIPLOMA_LABELS, DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Badge, Button, Field, Input, Select, Tabs, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { alertOutcomeText } from './edition-form';
import { useAdminApi, useUrlSync } from './hooks';
import { CONFIDENCE_LABEL, CONTENT_STATUS_LABEL, EDITION_STATUS_LABEL, FACT_KIND_LABEL, fmtDate, PHASE_KIND_LABEL, qs } from './labels';
import { FamilySelect, SourcePicker } from './pickers';
import { useAdmin } from './shell';
import { useToast } from './toast';
import type { EditionAlertOutcome, FactItem, FactKind, FactsResponse } from './types';
import { AdminPage, ConfidenceBadge, Empty, ErrorBox, FilterBar, FilterField, JsonBlock, Loading, SourceLink, Toggle, VerifyBadge } from './ui';

const KINDS: FactKind[] = ['edition', 'eligibility', 'phase', 'subject', 'fact'];

export function FactsView() {
  const sp = useSearchParams();
  const { refreshStats } = useAdmin();
  const [nv, setNv] = useState(sp.get('needsVerification') ?? 'true');
  const [familySlug, setFamilySlug] = useState(sp.get('familySlug') ?? '');
  const [kind, setKind] = useState<FactKind | ''>((KINDS as string[]).includes(sp.get('kind') ?? '') ? (sp.get('kind') as FactKind) : '');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useUrlSync(`/admin/facts${qs({ needsVerification: nv === 'true' ? '' : nv, familySlug, kind })}`);
  // Counts per kind come from the unfiltered-by-kind request so the tabs always show every total.
  const { data, error, loading, reload, setData } = useAdminApi<FactsResponse>(`/admin/facts${qs({ needsVerification: nv, familySlug, limit: 1000 })}`);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => (!kind || i.kind === kind)
      && (!s || `${i.label_fr} ${i.label_ar} ${i.familySlug} ${i.positionSlug ?? ''} ${i.sourceQuote ?? ''}`.toLowerCase().includes(s)));
  }, [data, kind, q]);

  const tabs = [
    { value: '' as const, label: `Tous${data ? ` (${data.total})` : ''}` },
    ...KINDS.map((k) => ({ value: k, label: `${FACT_KIND_LABEL[k]}${data ? ` (${data.counts[k] ?? 0})` : ''}` })),
  ];

  function onSaved(updated: FactItem) {
    setData((d) => {
      if (!d) return d;
      const stillListed = nv === 'all' || String(updated.needsVerification) === nv;
      const items = stillListed ? d.items.map((i) => (i.kind === updated.kind && i.id === updated.id ? updated : i)) : d.items.filter((i) => !(i.kind === updated.kind && i.id === updated.id));
      const removed = d.items.length - items.length;
      return { ...d, items, total: d.total - removed, counts: { ...d.counts, [updated.kind]: (d.counts[updated.kind] ?? 0) - removed } };
    });
    setOpenId(null);
    void refreshStats();
  }

  return (
    <AdminPage
      title="Faits à vérifier"
      subtitle="Chaque information sur un concours doit être confirmée par une source (citation + page). Tant qu’elle ne l’est pas, le site l’affiche « À vérifier / للتحقق »."
    >
      <Tabs tabs={tabs} value={kind} onChange={setKind} />
      <FilterBar>
        <FilterField label="État" htmlFor="ff-nv">
          <Select id="ff-nv" value={nv} onChange={(e) => setNv(e.target.value)}>
            <option value="true">À vérifier</option>
            <option value="false">Vérifiés</option>
            <option value="all">Tous</option>
          </Select>
        </FilterField>
        <FilterField label="Concours" htmlFor="ff-family"><FamilySelect id="ff-family" value={familySlug} onChange={setFamilySlug} /></FilterField>
        <FilterField label="Recherche" htmlFor="ff-q" className="min-w-56 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input id="ff-q" value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" placeholder="Libellé, poste, citation…" dir="auto" />
          </div>
        </FilterField>
        <Button variant="ghost" size="sm" className="self-end" onClick={() => void reload()}><RotateCcw className="size-4" aria-hidden />Recharger</Button>
      </FilterBar>

      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : loading && !data ? <Loading /> : !items.length ? (
        <Empty title={nv === 'true' ? 'Rien à vérifier' : 'Aucun fait'} body={nv === 'true' ? 'Toutes les informations de ce filtre sont sourcées et vérifiées.' : undefined} />
      ) : (
        <ul className={clsx('flex flex-col gap-3', loading && 'opacity-60')}>
          {items.map((it) => (
            <FactRow key={`${it.kind}:${it.id}`} item={it} open={openId === `${it.kind}:${it.id}`} onToggle={() => setOpenId((o) => (o === `${it.kind}:${it.id}` ? null : `${it.kind}:${it.id}`))} onSaved={onSaved} />
          ))}
        </ul>
      )}
    </AdminPage>
  );
}

function FactRow({ item, open, onToggle, onSaved }: { item: FactItem; open: boolean; onToggle: () => void; onSaved: (f: FactItem) => void }) {
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="primary">{FACT_KIND_LABEL[item.kind]}</Badge>
            <VerifyBadge needsVerification={item.needsVerification} />
            <ConfidenceBadge c={item.confidence} />
            {item.status && <Badge tone="neutral">{CONTENT_STATUS_LABEL[item.status]}</Badge>}
          </div>
          <p className="font-semibold">{item.label_fr} <span className="font-normal text-muted" lang="ar" dir="rtl">· {item.label_ar}</span></p>
          <p className="text-xs text-muted">
            <Link href={`/admin/concours/${item.familySlug}`} className="underline">{item.familyName_fr}</Link>
            {item.positionTitle_fr && ` · ${item.positionTitle_fr}`}
          </p>
        </div>
        <Button size="sm" variant={open ? 'secondary' : 'primary'} onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronUp className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}{open ? 'Fermer' : 'Vérifier'}
        </Button>
      </div>
      <FactValue item={item} />
      <div className="flex flex-col gap-1 text-sm">
        <SourceLink source={item.source} />
        {item.sourceQuote
          ? <blockquote className="border-s-4 border-primary bg-surface-2 p-2 text-sm italic" dir="auto">« {item.sourceQuote} »{item.sourcePage != null && <span className="not-italic text-muted"> — p. {item.sourcePage}</span>}</blockquote>
          : <p className="text-xs text-warning">Pas de citation de la source.</p>}
        {item.lastVerifiedAt && <p className="text-xs text-muted">Source vérifiée le {fmtDate(item.lastVerifiedAt)}</p>}
      </div>
      {open && <VerifyForm item={item} onSaved={onSaved} />}
    </li>
  );
}

/** Readable value per kind (dates of an edition, rules of a position, phase/subject details). */
function FactValue({ item }: { item: FactItem }) {
  const v = (item.value ?? {}) as Record<string, unknown>;
  if (item.kind === 'edition') {
    return (
      <p className="text-sm">
        Statut : {EDITION_STATUS_LABEL[v.status as keyof typeof EDITION_STATUS_LABEL] ?? String(v.status)} · Ouverture {fmtDate(v.registrationOpen as string | null)} · Clôture <b>{fmtDate(v.registrationDeadline as string | null)}</b> · Examen {fmtDate(v.examDate as string | null)}
        {v.positionsCount != null && ` · ${String(v.positionsCount)} postes`}
      </p>
    );
  }
  if (item.kind === 'eligibility') {
    const r = (v.rules ?? {}) as EligibilityRules;
    const parts = [
      v.diplomaLevel ? `Niveau : ${DIPLOMA_LABELS[v.diplomaLevel as DiplomaLevel]?.fr ?? String(v.diplomaLevel)}` : null,
      r.min_age != null || r.max_age != null ? `Âge ${r.min_age ?? '?'}–${r.max_age ?? '?'}` : null,
      r.genders?.length ? `Sexe : ${r.genders.join('/')}` : null,
      r.min_diploma ? `Diplôme min. : ${DIPLOMA_LABELS[r.min_diploma]?.fr}` : null,
      r.diplomas?.length ? `Diplômes : ${r.diplomas.map((d) => DIPLOMA_LABELS[d]?.fr ?? d).join(', ')}` : null,
      r.min_height_cm_male ? `Taille H ≥ ${r.min_height_cm_male}` : null,
      r.min_height_cm_female ? `Taille F ≥ ${r.min_height_cm_female}` : null,
      r.marital_status === 'SINGLE' ? 'Célibataire' : null,
      r.specialties?.length ? `Spécialités : ${r.specialties.join(', ')}` : null,
    ].filter(Boolean);
    return <p className="text-sm">{parts.length ? parts.join(' · ') : 'Aucune condition saisie.'}</p>;
  }
  if (item.kind === 'phase') {
    return <p className="text-sm">Ordre {String(v.order)} · {PHASE_KIND_LABEL[String(v.kind)] ?? String(v.kind)}{v.isEliminatory ? ' · éliminatoire' : ''}{v.durationMinutes ? ` · ${String(v.durationMinutes)} min` : ''}</p>;
  }
  if (item.kind === 'subject') {
    return <p className="text-sm">{DOMAIN_LABELS[v.domain as keyof typeof DOMAIN_LABELS]?.fr ?? String(v.domain)}{v.coefficient != null ? ` · coef. ${String(v.coefficient)}` : ''}{v.durationMinutes ? ` · ${String(v.durationMinutes)} min` : ''}{v.questionCount ? ` · ${String(v.questionCount)} questions` : ''}</p>;
  }
  const details = [v.details_fr, v.details_ar].filter(Boolean) as string[];
  return (
    <div className="flex flex-col gap-1 text-sm">
      {details.map((d, i) => <p key={i} dir="auto" className="text-muted">{d}</p>)}
      {v.value != null && <JsonBlock value={v.value} className="max-h-40" />}
    </div>
  );
}

function VerifyForm({ item, onSaved }: { item: FactItem; onSaved: (f: FactItem) => void }) {
  const { toast, toastError } = useToast();
  const [sourceId, setSourceId] = useState<string | null>(item.source?.id ?? null);
  const [quote, setQuote] = useState(item.sourceQuote ?? '');
  const [page, setPage] = useState(item.sourcePage != null ? String(item.sourcePage) : '');
  const [confidence, setConfidence] = useState<Confidence>(item.confidence);
  const [verified, setVerified] = useState(!!item.source);
  const [busy, setBusy] = useState(false);
  const supportsQuote = item.kind !== 'edition';
  const supportsPage = item.kind === 'fact';

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        needsVerification: !verified, confidence, sourceId,
        ...(supportsQuote ? { sourceQuote: quote.trim() || null } : {}),
        ...(supportsPage ? { sourcePage: page ? Number(page) : null } : {}),
      };
      const r = await api<FactItem & { ignored: string[]; notifications?: EditionAlertOutcome }>(`/admin/facts/${item.kind}/${item.id}`, { method: 'PATCH', body });
      const outcome = alertOutcomeText(r.notifications);
      toast({ tone: 'success', title: r.needsVerification ? 'Enregistré (reste à vérifier)' : 'Marqué vérifié', body: outcome ? `Alertes : ${outcome}.` : item.kind === 'eligibility' && !r.needsVerification ? 'Les sessions ouvertes de ce concours sont recalculées.' : undefined });
      onSaved(r);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3 rounded-xl border border-primary/30 bg-primary-soft/40 p-3 md:grid-cols-2">
      <Field label="Source" htmlFor={`vf-src-${item.id}`} hint="Obligatoire pour marquer vérifié."><SourcePicker id={`vf-src-${item.id}`} value={sourceId} onChange={(v) => { setSourceId(v); if (!v) setVerified(false); }} /></Field>
      <Field label="Confiance" htmlFor={`vf-conf-${item.id}`}>
        <Select id={`vf-conf-${item.id}`} value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>
          {CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
        </Select>
      </Field>
      {supportsQuote && (
        <div className="md:col-span-2">
          <Field label="Citation exacte de la source" htmlFor={`vf-q-${item.id}`}><Textarea id={`vf-q-${item.id}`} value={quote} onChange={(e) => setQuote(e.target.value)} dir="auto" /></Field>
        </div>
      )}
      {supportsPage && <Field label="Page" htmlFor={`vf-p-${item.id}`}><Input id={`vf-p-${item.id}`} type="number" min={1} value={page} onChange={(e) => setPage(e.target.value)} /></Field>}
      <div className="md:col-span-2">
        <Toggle checked={verified} onChange={setVerified} disabled={!sourceId} label="Vérifié contre la source" description={item.kind === 'edition' ? 'Une session vérifiée et ouverte peut relancer les alertes des candidats correspondants.' : 'Retire la mention « À vérifier » sur le site.'} />
      </div>
      <div className="flex justify-end gap-2 md:col-span-2">
        <Button type="submit" loading={busy}><ShieldCheck className="size-4" aria-hidden />{verified ? 'Enregistrer comme vérifié' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}

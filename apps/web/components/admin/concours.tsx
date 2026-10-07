'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Archive, BellRing, CheckCheck, ExternalLink, Megaphone, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import type { ContentStatus, Field as FieldKey } from '@ctn/shared';
import { CONTENT_STATUSES, DIPLOMA_LABELS, DOMAIN_LABELS, FIELD_LABELS, FIELDS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { OpenEditionsPanel } from './alerts-panel';
import { EditionFormModal, alertOutcomeText } from './edition-form';
import { FAMILIES_LOOKUP, invalidateLookup, useAdminApi } from './hooks';
import {
  ANNOUNCE_BLOCK_LABEL, CONTENT_STATUS_LABEL, daysFromToday, describeError, fmtDate, fmtDateTime, fmtNumber, FREQUENCY_LABEL, PHASE_KIND_LABEL, safeHref,
} from './labels';
import { PositionFormModal } from './position-form';
import { useAdmin } from './shell';
import { useToast } from './toast';
import type { AdminEdition, AdminPosition, FamilyDetail, FamilyListItem, ReviewResult } from './types';
import {
  AdminPage, ConfidenceBadge, EditionStatusBadge, Empty, ErrorBox, FilterBar, FilterField, ListInput, Loading, Section, SourceLink, StatusBadge,
  TableWrap, tableCls, tdCls, thCls, useConfirm, VerifyBadge,
} from './ui';

const FREQUENCIES = ['ANNUAL', 'BIENNIAL', 'IRREGULAR', 'UNKNOWN'] as const;

// ───────────── Families list ─────────────

export function ConcoursListView() {
  const { data, error, loading, reload } = useAdminApi<FamilyListItem[]>('/admin/families');
  const [field, setField] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [newEdition, setNewEdition] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const router = useRouter();

  const rows = useMemo(() => (data ?? []).filter((f) =>
    (!field || f.field === field) && (!status || f.status === status)
    && (!q.trim() || `${f.slug} ${f.name_fr} ${f.name_ar} ${f.organization.name_fr}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, field, status, q]);

  return (
    <AdminPage
      title="Concours"
      subtitle="Familles de concours, postes, conditions d’éligibilité et sessions. Ouvrir une session déclenche les alertes aux candidats dont le profil correspond."
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => setNewEdition(true)}><BellRing className="size-4" aria-hidden />Nouvelle session</Button>
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />Nouveau concours</Button>
        </>
      }
    >
      <OpenEditionsPanel key={panelKey} />
      <FilterBar>
        <FilterField label="Recherche" htmlFor="cf-q" className="min-w-56 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input id="cf-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, slug, organisation…" className="ps-9" dir="auto" />
          </div>
        </FilterField>
        <FilterField label="Secteur" htmlFor="cf-field">
          <Select id="cf-field" value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">Tous</option>
            {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f].fr}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Statut" htmlFor="cf-status">
          <Select id="cf-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{CONTENT_STATUS_LABEL[s]}</option>)}
          </Select>
        </FilterField>
      </FilterBar>

      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : loading && !data ? <Loading /> : !rows.length ? <Empty title="Aucun concours" /> : (
        <TableWrap>
          <table className={clsx(tableCls, 'min-w-[960px]')}>
            <thead>
              <tr>
                <th className={thCls}>Concours</th><th className={thCls}>Secteur</th><th className={thCls}>Statut</th><th className={thCls}>Postes</th>
                <th className={thCls}>Sessions</th><th className={thCls}>Abonnés · inscrits</th><th className={thCls}>Questions liées</th><th className={thCls}>À vérifier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.slug} className="cursor-pointer hover:bg-surface-2/60" onClick={() => router.push(`/admin/concours/${f.slug}`)}>
                  <td className={tdCls}>
                    <Link href={`/admin/concours/${f.slug}`} className="font-semibold hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{f.name_fr}</Link>
                    <div className="text-xs text-muted"><span lang="ar" dir="rtl">{f.name_ar}</span> · <code>{f.slug}</code> · {f.organization.name_fr}</div>
                  </td>
                  <td className={tdCls}>{FIELD_LABELS[f.field]?.fr ?? f.field}</td>
                  <td className={tdCls}><StatusBadge status={f.status} /></td>
                  <td className={`${tdCls} tabular-nums`}>{f.counts.positions}</td>
                  <td className={tdCls}>
                    <span className="tabular-nums">{f.counts.editions}</span>
                    {f.counts.openEditions > 0 && <Badge tone="success" className="ms-1">{f.counts.openEditions} ouverte(s)</Badge>}
                  </td>
                  <td className={`${tdCls} tabular-nums`}>{fmtNumber(f.counts.followers)} · {fmtNumber(f.counts.enrolled)}</td>
                  <td className={`${tdCls} tabular-nums`}>{fmtNumber(f.counts.linkedQuestions)}</td>
                  <td className={tdCls}>{f.counts.factsToVerify ? <Badge tone="warning">{f.counts.factsToVerify}</Badge> : <span className="text-muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <FamilyCreateModal open={creating} onClose={() => setCreating(false)} families={data ?? []} onCreated={(slug) => { invalidateLookup(FAMILIES_LOOKUP); router.push(`/admin/concours/${slug}`); }} />
      <EditionFormModal open={newEdition} onClose={() => setNewEdition(false)} onSaved={() => { void reload(); setPanelKey((k) => k + 1); }} />
    </AdminPage>
  );
}

function FamilyCreateModal({ open, onClose, families, onCreated }: { open: boolean; onClose: () => void; families: FamilyListItem[]; onCreated: (slug: string) => void }) {
  const { toastError, toast } = useToast();
  const orgs = useMemo(() => {
    const m = new Map<string, { slug: string; name_fr: string }>();
    for (const f of families) m.set(f.organization.slug, { slug: f.organization.slug, name_fr: f.organization.name_fr });
    return [...m.values()].sort((a, b) => a.name_fr.localeCompare(b.name_fr));
  }, [families]);
  const [slug, setSlug] = useState('');
  const [field, setField] = useState<FieldKey>('ADMINISTRATION');
  const [org, setOrg] = useState('');
  const [newOrg, setNewOrg] = useState({ slug: '', name_ar: '', name_fr: '', ministry_fr: '', website: '' });
  const [nameFr, setNameFr] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        field, name_fr: nameFr.trim(), name_ar: nameAr.trim(), status: 'DRAFT' as ContentStatus,
        ...(org === '__new'
          ? { organization: { slug: newOrg.slug, name_ar: newOrg.name_ar, name_fr: newOrg.name_fr, ministry_fr: newOrg.ministry_fr || null, website: newOrg.website || null } }
          : { organizationSlug: org }),
      };
      await api(`/admin/families/${encodeURIComponent(slug)}`, { method: 'POST', body });
      toast({ tone: 'success', title: 'Concours créé (brouillon)', body: 'Ajoutez ses postes et sessions puis publiez-le.' });
      onClose();
      onCreated(slug);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau concours">
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Identifiant (slug)" htmlFor="fc-slug" hint="Minuscules, chiffres, tirets — ex. police-nationale-agents."><Input id="fc-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} dir="ltr" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom (FR)" htmlFor="fc-fr"><Input id="fc-fr" required minLength={2} value={nameFr} onChange={(e) => setNameFr(e.target.value)} /></Field>
          <Field label="Nom (AR)" htmlFor="fc-ar"><Input id="fc-ar" required minLength={2} value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" lang="ar" /></Field>
        </div>
        <Field label="Secteur" htmlFor="fc-field">
          <Select id="fc-field" value={field} onChange={(e) => setField(e.target.value as FieldKey)}>{FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f].fr}</option>)}</Select>
        </Field>
        <Field label="Organisation" htmlFor="fc-org">
          <Select id="fc-org" required value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="" disabled>Choisir…</option>
            {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name_fr}</option>)}
            <option value="__new">+ Nouvelle organisation</option>
          </Select>
        </Field>
        {org === '__new' && (
          <div className="grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-2">
            <Field label="Slug organisation" htmlFor="fo-slug"><Input id="fo-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={newOrg.slug} onChange={(e) => setNewOrg({ ...newOrg, slug: e.target.value.toLowerCase() })} dir="ltr" /></Field>
            <Field label="Site web" htmlFor="fo-web"><Input id="fo-web" type="url" value={newOrg.website} onChange={(e) => setNewOrg({ ...newOrg, website: e.target.value })} dir="ltr" /></Field>
            <Field label="Nom (FR)" htmlFor="fo-fr"><Input id="fo-fr" required minLength={2} value={newOrg.name_fr} onChange={(e) => setNewOrg({ ...newOrg, name_fr: e.target.value })} /></Field>
            <Field label="Nom (AR)" htmlFor="fo-ar"><Input id="fo-ar" required minLength={2} value={newOrg.name_ar} onChange={(e) => setNewOrg({ ...newOrg, name_ar: e.target.value })} dir="rtl" /></Field>
            <Field label="Ministère de tutelle" htmlFor="fo-min"><Input id="fo-min" value={newOrg.ministry_fr} onChange={(e) => setNewOrg({ ...newOrg, ministry_fr: e.target.value })} /></Field>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={busy}>Créer</Button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────── Family detail ─────────────

export function ConcoursDetailView({ slug }: { slug: string }) {
  const { data, error, loading, reload, setData } = useAdminApi<FamilyDetail>(`/admin/families/${slug}`);
  if (error && !data) return <AdminPage title="Concours" back={{ href: '/admin/concours', label: 'Concours' }}><ErrorBox error={error} onRetry={() => void reload()} /></AdminPage>;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return <FamilyDetailBody f={data} reload={reload} setFamily={(f) => setData(f)} />;
}

function FamilyDetailBody({ f, reload, setFamily }: { f: FamilyDetail; reload: () => Promise<unknown>; setFamily: (f: FamilyDetail) => void }) {
  const sp = useSearchParams();
  const { refreshStats } = useAdmin();
  const { toast, toastError } = useToast();
  const confirm = useConfirm();
  const [editionModal, setEditionModal] = useState<{ edition: AdminEdition | null } | null>(null);
  const [noticeFor, setNoticeFor] = useState<AdminEdition | null>(null);
  const [positionModal, setPositionModal] = useState<{ position: AdminPosition | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const deepLinked = useRef(false);

  // /admin/concours/:slug?edition=<id> (from the review queue) opens that edition's form.
  useEffect(() => {
    const id = sp.get('edition');
    if (!id || deepLinked.current) return;
    const e = f.editions.find((x) => x.id === id);
    if (e) {
      deepLinked.current = true;
      setEditionModal({ edition: e });
      document.getElementById('editions')?.scrollIntoView({ block: 'start' });
    }
  }, [sp, f.editions]);

  const after = () => {
    void reload();
    void refreshStats();
  };

  async function notify(e: AdminEdition) {
    const r = await confirm.ask({
      title: 'Notifier les candidats correspondants ?',
      tone: 'primary',
      confirmLabel: 'Envoyer les alertes',
      body: (
        <div className="flex flex-col gap-2">
          <p>Le profil de chaque candidat (âge à la date limite, diplôme, sexe, taille, spécialité…) est comparé aux conditions des postes de la session <b>{f.name_fr} {e.year}</b>.</p>
          <p>Les candidats éligibles (ou probablement éligibles) reçoivent une alerte selon leurs préférences (in-app, push, e-mail). Ceux déjà alertés pour cette session ne le sont pas une seconde fois.</p>
          {e.needsVerification && <p className="text-warning">La session est « À vérifier » : l’alerte le mentionnera.</p>}
        </div>
      ),
    });
    if (!r) return;
    setBusyId(e.id);
    try {
      const res = await api<{ matchedUsers: number; notified: number }>(`/admin/editions/${e.id}/notify`, { method: 'POST', body: {} });
      toast({ tone: 'success', title: 'Alertes envoyées', body: `${res.matchedUsers} candidat(s) correspondant(s) · ${res.notified} nouvellement notifié(s).` }, 10000);
      after();
    } catch (err) {
      toastError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function reviewEdition(e: AdminEdition, action: 'publish' | 'archive') {
    const r = await confirm.ask({
      title: action === 'publish' ? 'Publier cette session ?' : 'Archiver cette session ?',
      tone: action === 'publish' ? 'primary' : 'danger',
      confirmLabel: action === 'publish' ? 'Vérifier + publier' : 'Archiver',
      body: action === 'publish'
        ? <p>Vous attestez l’avoir vérifiée contre sa source ({e.source?.title ?? <b className="text-danger">aucune source : la publication sera refusée</b>}). {(e.status === 'OPEN' || e.status === 'ANNOUNCED') && <b>Les candidats correspondants seront alertés immédiatement.</b>}</p>
        : <p>Elle disparaît du site et du calendrier.</p>,
      comment: action === 'archive' ? { label: 'Motif' } : undefined,
    });
    if (!r) return;
    setBusyId(e.id);
    try {
      const res = await api<ReviewResult>(`/admin/review/edition/${e.id}`, { method: 'POST', body: { action, ...(r.comment ? { comment: r.comment } : {}) } });
      const outcome = alertOutcomeText(res.alerts);
      toast({ tone: 'success', title: `Session : ${CONTENT_STATUS_LABEL[res.from]} → ${CONTENT_STATUS_LABEL[res.status]}`, body: outcome ? `Alertes : ${outcome}.` : undefined }, outcome ? 10000 : undefined);
      after();
    } catch (err) {
      toastError(err);
    } finally {
      setBusyId(null);
    }
  }

  const publicHref = `/concours/${f.slug}`;
  const openEditions = f.editions.filter((e) => e.alerts.announceable);

  return (
    <AdminPage
      back={{ href: '/admin/concours', label: 'Concours' }}
      title={<span>{f.name_fr} <span className="text-lg font-semibold text-muted" lang="ar" dir="rtl">· {f.name_ar}</span></span>}
      subtitle={<span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={f.status} /><Badge tone="neutral">{FIELD_LABELS[f.field]?.fr}</Badge><code className="text-xs">{f.slug}</code>{f.organization && <span>· {f.organization.name_fr}</span>}</span>}
      actions={<a href={publicHref} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2"><ExternalLink className="size-4" aria-hidden />Fiche publique</a>}
    >
      <Section
        id="editions"
        title="Sessions"
        description="Une session publiée au statut « Annoncée » ou « Inscriptions ouvertes » alerte automatiquement les candidats dont le profil correspond (tâche horaire, ou immédiatement à l’enregistrement)."
        actions={<Button size="sm" onClick={() => setEditionModal({ edition: null })}><Plus className="size-4" aria-hidden />Nouvelle session</Button>}
      >
        <Alert tone="info" title="Ouvrir une session = alerter les candidats">
          <span className="flex items-start gap-1.5"><BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>Passer une session en « Inscriptions ouvertes » envoie l’alerte « مناظرة تناسب ملفك » aux candidats éligibles. Utilisez « Notifier » pour relancer le calcul après une correction de profil ou de conditions ; « Mise à jour » prévient les abonnés d’un changement (report, résultats…).</span>
          </span>
        </Alert>
        {!f.editions.length ? <Empty title="Aucune session" body="Créez la session de l’année quand l’avis est publié." /> : (
          <TableWrap>
            <table className={clsx(tableCls, 'min-w-[1100px]')}>
              <thead>
                <tr>
                  <th className={thCls}>Session</th><th className={thCls}>Statut</th><th className={thCls}>Dates</th><th className={thCls}>Vérification</th>
                  <th className={thCls}>Alertes candidats</th><th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {f.editions.map((e) => {
                  const left = daysFromToday(e.registrationDeadline);
                  return (
                    <tr key={e.id} className={clsx(sp.get('edition') === e.id && 'bg-primary-soft/40')}>
                      <td className={tdCls}>
                        <p className="font-semibold">{e.year}{e.sessionLabel ? ` — ${e.sessionLabel}` : ''}</p>
                        <p className="text-xs text-muted">{e.positionSlugs.length ? e.positionSlugs.join(', ') : 'Tous les postes'}{e.positionsCount != null ? ` · ${e.positionsCount} postes` : ''}</p>
                      </td>
                      <td className={tdCls}>
                        <div className="flex flex-col items-start gap-1">
                          <EditionStatusBadge status={e.status} />
                          <StatusBadge status={e.contentStatus} />
                          {e.effectiveStatus !== e.status && <span className="text-xs text-muted">Affiché : {e.effectiveStatus}</span>}
                        </div>
                      </td>
                      <td className={clsx(tdCls, 'whitespace-nowrap text-xs')}>
                        <p>Ouverture : {fmtDate(e.registrationOpen)}</p>
                        <p>Clôture : <b>{fmtDate(e.registrationDeadline)}</b>{left != null && left >= 0 && <span className="text-muted"> (J-{left})</span>}</p>
                        <p>Examen : {fmtDate(e.examDate)}</p>
                      </td>
                      <td className={tdCls}>
                        <div className="flex flex-col items-start gap-1">
                          <VerifyBadge needsVerification={e.needsVerification} />
                          <SourceLink source={e.source} compact />
                        </div>
                      </td>
                      <td className={clsx(tdCls, 'text-xs')}>
                        {e.alerts.sentAt
                          ? <p className="text-success">Envoyées le {fmtDateTime(e.alerts.sentAt)}</p>
                          : e.alerts.announceable ? <p className="font-semibold text-warning">Prête, pas encore envoyée</p> : <p className="text-muted">Bloquée : {ANNOUNCE_BLOCK_LABEL[e.alerts.blockedBy ?? ''] ?? e.alerts.blockedBy}</p>}
                        <p className="tabular-nums">{e.alerts.matchedUsers} correspondant(s) · {e.alerts.notifiedUsers} notifié(s)</p>
                      </td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setEditionModal({ edition: e })}><Pencil className="size-4" aria-hidden />Modifier</Button>
                          <Button
                            size="sm"
                            onClick={() => void notify(e)}
                            loading={busyId === e.id}
                            disabled={!e.alerts.announceable}
                            title={e.alerts.announceable ? 'Envoyer les alertes aux candidats correspondants' : `Impossible : ${ANNOUNCE_BLOCK_LABEL[e.alerts.blockedBy ?? ''] ?? e.alerts.blockedBy}`}
                          >
                            <BellRing className="size-4" aria-hidden />Notifier les candidats correspondants
                          </Button>
                          {e.contentStatus === 'PUBLISHED' && <Button size="sm" variant="ghost" onClick={() => setNoticeFor(e)}><Megaphone className="size-4" aria-hidden />Mise à jour</Button>}
                          {e.contentStatus !== 'PUBLISHED' && e.contentStatus !== 'ARCHIVED' && <Button size="sm" variant="secondary" disabled={busyId === e.id} onClick={() => void reviewEdition(e, 'publish')}><CheckCheck className="size-4" aria-hidden />Publier</Button>}
                          {e.contentStatus !== 'ARCHIVED' && <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => void reviewEdition(e, 'archive')} aria-label="Archiver"><Archive className="size-4" aria-hidden /></Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {openEditions.length > 0 && <p className="text-xs text-muted">{openEditions.length} session(s) peuvent actuellement alerter les candidats.</p>}
      </Section>

      <Section title="Postes et conditions d’éligibilité" description="Les alertes comparent ces conditions au profil des candidats. Modifier une condition relance le calcul pour les sessions ouvertes." actions={<Button size="sm" variant="secondary" onClick={() => setPositionModal({ position: null })}><Plus className="size-4" aria-hidden />Nouveau poste</Button>}>
        {!f.positions.length ? <Empty title="Aucun poste" /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {f.positions.map((p) => <PositionCard key={p.id} p={p} onEdit={() => setPositionModal({ position: p })} />)}
          </div>
        )}
      </Section>

      <FamilyFieldsForm f={f} onSaved={(nf) => { setFamily(nf); invalidateLookup(FAMILIES_LOOKUP); }} />

      <Section title="Faits du concours" description="Pièces à fournir, épreuves sportives, frais… chaque fait a sa source." actions={<Link href={`/admin/facts?familySlug=${f.slug}&needsVerification=all`} className="text-sm font-semibold text-primary underline">Vérifier les faits</Link>}>
        {!f.facts.length ? <p className="text-sm text-muted">Aucun fait enregistré.</p> : (
          <ul className="flex flex-col gap-2">
            {f.facts.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{x.display_fr} <span className="font-normal text-muted" lang="ar" dir="rtl">· {x.display_ar}</span></p>
                  <p className="text-xs text-muted"><code>{x.key}</code>{x.positionSlug ? ` · ${x.positionSlug}` : ''}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1"><VerifyBadge needsVerification={x.needsVerification} /><SourceLink source={x.source} compact /></div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {f.pastExams.length > 0 && (
        <Section title="Annales référencées">
          <ul className="flex flex-col gap-1 text-sm">
            {f.pastExams.map((p) => {
              const href = safeHref(p.url);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums">{p.year}</span>
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline" dir="auto">{p.title}</a> : <span dir="auto">{p.title}</span>}
                  {p.isVerified ? <Badge tone="success">Vérifiée</Badge> : <Badge tone="warning">À vérifier</Badge>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <EditionFormModal open={!!editionModal} onClose={() => setEditionModal(null)} familySlug={f.slug} edition={editionModal?.edition ?? null} onSaved={after} />
      <PositionFormModal open={!!positionModal} onClose={() => setPositionModal(null)} familySlug={f.slug} position={positionModal?.position ?? null} onSaved={after} />
      <UpdateNoticeModal edition={noticeFor} familyName={f.name_fr} onClose={() => setNoticeFor(null)} />
      {confirm.element}
    </AdminPage>
  );
}

function PositionCard({ p, onEdit }: { p: AdminPosition; onEdit: () => void }) {
  const r = p.eligibility ?? {};
  const rules: string[] = [];
  if (r.min_age != null || r.max_age != null) rules.push(`Âge : ${r.min_age ?? '?'}–${r.max_age ?? '?'} ans`);
  if (r.genders?.length) rules.push(`Sexe : ${r.genders.map((g) => (g === 'M' ? 'hommes' : 'femmes')).join(', ')}`);
  if (r.diplomas?.length) rules.push(`Diplômes : ${r.diplomas.map((d) => DIPLOMA_LABELS[d]?.fr ?? d).join(', ')}`);
  else if (r.min_diploma) rules.push(`Diplôme min. : ${DIPLOMA_LABELS[r.min_diploma]?.fr ?? r.min_diploma}`);
  if (r.specialties?.length) rules.push(`Spécialités : ${r.specialties.join(', ')}`);
  if (r.min_height_cm_male) rules.push(`Taille H ≥ ${r.min_height_cm_male} cm`);
  if (r.min_height_cm_female) rules.push(`Taille F ≥ ${r.min_height_cm_female} cm`);
  if (r.marital_status === 'SINGLE') rules.push('Célibataire');
  if (r.nationality) rules.push(`Nationalité : ${r.nationality}`);
  const prov = p.eligibilityProvenance;
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">{p.title_fr}</h3>
          <p className="text-xs text-muted"><span lang="ar" dir="rtl">{p.title_ar}</span> · <code>{p.slug}</code> · {DIPLOMA_LABELS[p.diplomaLevel]?.fr}</p>
        </div>
        <div className="flex items-center gap-1"><StatusBadge status={p.status} /><Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="size-4" aria-hidden />Modifier</Button></div>
      </div>
      <div className="flex flex-wrap items-center gap-1"><VerifyBadge needsVerification={prov.needsVerification} /><ConfidenceBadge c={prov.confidence} /><SourceLink source={prov.source} compact /></div>
      {rules.length ? <ul className="list-disc ps-5 text-sm">{rules.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-warning">Aucune condition saisie : tous les profils correspondent.</p>}
      {!!r.other_fr?.length && <p className="text-xs text-muted">Autres : {r.other_fr.join(' · ')}</p>}
      {prov.sourceQuote && <blockquote className="border-s-2 border-primary ps-2 text-xs italic text-muted" dir="auto">« {prov.sourceQuote} »</blockquote>}
      {(!!p.phases?.length || !!p.subjects?.length) && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Épreuves ({p.phases?.length ?? 0}) et matières ({p.subjects?.length ?? 0})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {p.phases?.map((ph) => (
              <li key={ph.id} className="flex flex-wrap items-center gap-1">
                <span className="tabular-nums">{ph.order}.</span> {ph.name_fr} <Badge tone="neutral">{PHASE_KIND_LABEL[ph.kind] ?? ph.kind}</Badge>
                {ph.isEliminatory && <Badge tone="danger">Éliminatoire</Badge>}
                <VerifyBadge needsVerification={ph.needsVerification} />
              </li>
            ))}
            {p.subjects?.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-1 ps-4 text-xs">
                {s.name_fr} · {DOMAIN_LABELS[s.domain]?.fr}{s.coefficient != null ? ` · coef. ${s.coefficient}` : ''}{s.durationMinutes ? ` · ${s.durationMinutes} min` : ''}
                <VerifyBadge needsVerification={s.needsVerification} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!p.blueprints?.length && <p className="text-xs text-muted">Blueprint : {p.blueprints.map((b) => `${b.title} (${b.totalMinutes} min, ${b.sections.reduce((n, s) => n + s.count, 0)} q.)`).join(' · ')}</p>}
    </article>
  );
}

function familyDraft(f: FamilyDetail) {
  return {
    name_fr: f.name_fr, name_ar: f.name_ar, field: f.field, description_fr: f.description_fr ?? '', description_ar: f.description_ar ?? '',
    frequency: f.frequency, popularity: String(f.popularity), keywords: f.keywords ?? [], tips_fr: f.tips_fr ?? [], tips_ar: f.tips_ar ?? [],
    researchNotes: f.researchNotes ?? '', status: f.status,
  };
}

function FamilyFieldsForm({ f, onSaved }: { f: FamilyDetail; onSaved: (f: FamilyDetail) => void }) {
  const { toast, toastError } = useToast();
  const initial = useMemo(() => familyDraft(f), [f]);
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const prevInitial = useRef(initial);
  useEffect(() => {
    // The family reloads after edition/position changes: refresh the form only if the editor has no pending edits.
    const prev = JSON.stringify(prevInitial.current);
    setD((cur) => (JSON.stringify(cur) === prev ? initial : cur));
    prevInitial.current = initial;
  }, [initial]);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...d, popularity: Number(d.popularity), researchNotes: d.researchNotes.trim() || null };
      const r = await api<FamilyDetail>(`/admin/families/${f.slug}`, { method: 'PATCH', body });
      toast({ tone: 'success', title: 'Concours mis à jour' });
      const saved = familyDraft(r);
      prevInitial.current = saved;
      setD(saved);
      onSaved(r);
    } catch (err) {
      const desc = describeError(err);
      toastError(err, desc.code === 'INVALID_TRANSITION' ? 'Changement de statut non autorisé' : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Fiche du concours" description="Textes affichés sur la fiche publique.">
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nom (FR)" htmlFor="ff-fr"><Input id="ff-fr" required value={d.name_fr} onChange={(e) => set('name_fr', e.target.value)} /></Field>
          <Field label="Nom (AR)" htmlFor="ff-ar"><Input id="ff-ar" required value={d.name_ar} onChange={(e) => set('name_ar', e.target.value)} dir="rtl" lang="ar" /></Field>
          <Field label="Description (FR)" htmlFor="ff-dfr"><Textarea id="ff-dfr" value={d.description_fr} onChange={(e) => set('description_fr', e.target.value)} /></Field>
          <Field label="Description (AR)" htmlFor="ff-dar"><Textarea id="ff-dar" value={d.description_ar} onChange={(e) => set('description_ar', e.target.value)} dir="rtl" lang="ar" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Secteur" htmlFor="ff-field"><Select id="ff-field" value={d.field} onChange={(e) => set('field', e.target.value as FieldKey)}>{FIELDS.map((x) => <option key={x} value={x}>{FIELD_LABELS[x].fr}</option>)}</Select></Field>
          <Field label="Fréquence" htmlFor="ff-freq"><Select id="ff-freq" value={d.frequency} onChange={(e) => set('frequency', e.target.value)}>{FREQUENCIES.map((x) => <option key={x} value={x}>{FREQUENCY_LABEL[x]}</option>)}</Select></Field>
          <Field label="Popularité (1–5)" htmlFor="ff-pop"><Input id="ff-pop" type="number" min={1} max={5} value={d.popularity} onChange={(e) => set('popularity', e.target.value)} /></Field>
          <Field label="Statut" htmlFor="ff-status"><Select id="ff-status" value={d.status} onChange={(e) => set('status', e.target.value as ContentStatus)}>{CONTENT_STATUSES.map((s) => <option key={s} value={s}>{CONTENT_STATUS_LABEL[s]}</option>)}</Select></Field>
        </div>
        <Field label="Mots-clés (recherche, détection de la veille)" htmlFor="ff-kw" hint="Un par ligne, FR et AR."><ListInput id="ff-kw" value={d.keywords} onChange={(v) => set('keywords', v)} /></Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Conseils (FR)" htmlFor="ff-tfr"><ListInput id="ff-tfr" rows={3} value={d.tips_fr} onChange={(v) => set('tips_fr', v)} /></Field>
          <Field label="Conseils (AR)" htmlFor="ff-tar"><ListInput id="ff-tar" rows={3} value={d.tips_ar} onChange={(v) => set('tips_ar', v)} dir="rtl" /></Field>
        </div>
        <Field label="Notes de recherche (internes)" htmlFor="ff-notes"><Textarea id="ff-notes" value={d.researchNotes} onChange={(e) => set('researchNotes', e.target.value)} dir="auto" /></Field>
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="text-xs text-warning">Modifications non enregistrées</span>}
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => setD(initial)}><RotateCcw className="size-4" aria-hidden />Annuler</Button>
          <Button type="submit" loading={busy} disabled={!dirty}>Enregistrer la fiche</Button>
        </div>
      </form>
    </Section>
  );
}

function UpdateNoticeModal({ edition, familyName, onClose }: { edition: AdminEdition | null; familyName: string; onClose: () => void }) {
  const { toast, toastError } = useToast();
  const [ar, setAr] = useState('');
  const [fr, setFr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (edition) {
      setAr('');
      setFr('');
    }
  }, [edition]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!edition) return;
    setBusy(true);
    try {
      const r = await api<{ sent: number }>(`/admin/editions/${edition.id}/update-notice`, { method: 'POST', body: { summary_ar: ar.trim(), summary_fr: fr.trim() } });
      toast({ tone: 'success', title: 'Mise à jour envoyée', body: `${r.sent} personne(s) prévenue(s) (abonnés, inscrits et candidats correspondants).` });
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!edition} onClose={onClose} title={`Mise à jour — ${familyName} ${edition?.year ?? ''}`}>
      <form onSubmit={send} className="flex flex-col gap-3">
        <p className="text-sm text-muted">Envoyée aux abonnés du concours, aux candidats qui le préparent et à ceux déjà alertés : report, nouvelle date, résultats en ligne…</p>
        <Field label="Message (AR)" htmlFor="un-ar"><Textarea id="un-ar" required minLength={3} maxLength={400} value={ar} onChange={(e) => setAr(e.target.value)} dir="rtl" lang="ar" placeholder="تم تأجيل موعد الاختبار الكتابي إلى…" /></Field>
        <Field label="Message (FR)" htmlFor="un-fr"><Textarea id="un-fr" required minLength={3} maxLength={400} value={fr} onChange={(e) => setFr(e.target.value)} placeholder="L’épreuve écrite est reportée au…" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={busy}><Megaphone className="size-4" aria-hidden />Envoyer</Button>
        </div>
      </form>
    </Modal>
  );
}

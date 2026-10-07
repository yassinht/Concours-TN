'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BellRing } from 'lucide-react';
import type { Confidence, EditionStatus } from '@ctn/shared';
import { CONFIDENCES, EDITION_STATUSES } from '@ctn/shared/dist/enums';
import { Alert, Button, Field, Input, Modal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi } from './hooks';
import { CONFIDENCE_LABEL, EDITION_STATUS_LABEL, tunisToday } from './labels';
import { FamilySelect, SourcePicker } from './pickers';
import { useToast } from './toast';
import type { AdminEdition, EditionAlertOutcome, FamilyDetail } from './types';
import { Checkbox, Toggle } from './ui';

export interface EditionPrefill {
  year?: number | null; sessionLabel?: string | null; status?: EditionStatus; registrationOpen?: string | null; registrationDeadline?: string | null;
  examDate?: string | null; positionsCount?: number | null; announcementUrl?: string | null; sourceId?: string | null; confidence?: Confidence;
}

interface Draft {
  familySlug: string; year: string; sessionLabel: string; status: EditionStatus; registrationOpen: string; registrationDeadline: string; examDate: string;
  positionsCount: string; positionSlugs: string[]; announcementUrl: string; sourceId: string | null; confidence: Confidence; needsVerification: boolean;
}

function draftOf(e: AdminEdition | null, familySlug: string, prefill?: EditionPrefill): Draft {
  if (e) {
    return {
      familySlug: e.familySlug, year: String(e.year), sessionLabel: e.sessionLabel ?? '', status: e.status,
      registrationOpen: e.registrationOpen ?? '', registrationDeadline: e.registrationDeadline ?? '', examDate: e.examDate ?? '',
      positionsCount: e.positionsCount != null ? String(e.positionsCount) : '', positionSlugs: e.positionSlugs, announcementUrl: e.announcementUrl ?? '',
      sourceId: e.source?.id ?? null, confidence: e.confidence, needsVerification: e.needsVerification,
    };
  }
  const p = prefill ?? {};
  return {
    familySlug, year: String(p.year ?? Number(tunisToday().slice(0, 4))), sessionLabel: p.sessionLabel ?? '', status: p.status ?? 'ANNOUNCED',
    registrationOpen: p.registrationOpen ?? '', registrationDeadline: p.registrationDeadline ?? '', examDate: p.examDate ?? '',
    positionsCount: p.positionsCount != null ? String(p.positionsCount) : '', positionSlugs: [], announcementUrl: p.announcementUrl ?? '',
    sourceId: p.sourceId ?? null, confidence: p.confidence ?? 'MEDIUM', needsVerification: true,
  };
}

/** Human summary of what saving an edition did on the alerts side. */
export function alertOutcomeText(n: EditionAlertOutcome | undefined | null): string | null {
  if (!n) return null;
  const parts: string[] = [];
  if (n.alerts) parts.push(`${n.alerts.matchedUsers} candidat(s) correspondant(s), ${n.alerts.notified} notifié(s)`);
  if (n.updateNotified) parts.push(`${n.updateNotified} abonné(s) prévenu(s) de la mise à jour`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Create / edit an edition (EditionUpsertInput). Saving a published edition as ANNOUNCED or OPEN runs profile matching:
 * candidates whose profile matches are alerted right away (the form says so before saving).
 */
export function EditionFormModal({ open, onClose, familySlug: fixedFamily, edition, prefill, onSaved, title }: {
  open: boolean; onClose: () => void; familySlug?: string | null; edition?: AdminEdition | null; prefill?: EditionPrefill;
  onSaved?: (e: AdminEdition & { notifications?: EditionAlertOutcome }) => void; title?: string;
}) {
  const { toast, toastError } = useToast();
  const [d, setD] = useState<Draft>(() => draftOf(edition ?? null, fixedFamily ?? '', prefill));
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    // Reset only when the dialog opens: parents may pass a fresh `prefill` object on every render.
    if (open && !wasOpen.current) {
      setD(draftOf(edition ?? null, fixedFamily ?? '', prefill));
      setNotify(true);
    }
    wasOpen.current = open;
  }, [open, edition, fixedFamily, prefill]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const { data: family } = useAdminApi<FamilyDetail>(open && d.familySlug ? `/admin/families/${d.familySlug}` : null);
  const positions = useMemo(() => (family?.slug === d.familySlug ? family.positions.filter((p) => p.status !== 'ARCHIVED') : []), [family, d.familySlug]);

  const today = tunisToday();
  const deadlinePassed = !!d.registrationDeadline && d.registrationDeadline < today;
  const announceable = (d.status === 'OPEN' || d.status === 'ANNOUNCED') && !deadlinePassed;
  const published = edition ? edition.contentStatus === 'PUBLISHED' : true; // editor-created editions are published
  const wasAnnounceable = !!edition && (edition.status === 'OPEN' || edition.status === 'ANNOUNCED');
  const dateIssue = d.registrationOpen && d.registrationDeadline && d.registrationOpen > d.registrationDeadline
    ? 'L’ouverture doit précéder la clôture.'
    : d.registrationDeadline && d.examDate && d.examDate < d.registrationDeadline ? 'L’examen doit suivre la clôture des inscriptions.' : null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!d.familySlug) {
      toast({ tone: 'warning', title: 'Choisissez le concours' });
      return;
    }
    setBusy(true);
    const body = {
      familySlug: d.familySlug, year: Number(d.year), sessionLabel: d.sessionLabel.trim() || null, status: d.status,
      registrationOpen: d.registrationOpen || null, registrationDeadline: d.registrationDeadline || null, examDate: d.examDate || null,
      positionsCount: d.positionsCount ? Number(d.positionsCount) : null, positionSlugs: d.positionSlugs,
      announcementUrl: d.announcementUrl.trim() || null, sourceId: d.sourceId, confidence: d.confidence, needsVerification: d.needsVerification,
    };
    try {
      const saved = edition
        ? await api<AdminEdition & { notifications: EditionAlertOutcome; changed: boolean }>(`/admin/editions/${edition.id}${notify ? '' : '?notify=false'}`, { method: 'PATCH', body })
        : await api<AdminEdition & { notifications: EditionAlertOutcome }>('/admin/editions', { method: 'POST', body });
      const outcome = alertOutcomeText(saved.notifications);
      toast({
        tone: 'success',
        title: edition ? ('changed' in saved && saved.changed === false ? 'Aucune modification' : 'Session mise à jour') : 'Session créée',
        body: outcome ? `Alertes : ${outcome}.` : saved.alerts.blockedBy ? 'Aucune alerte envoyée pour l’instant.' : undefined,
      }, outcome ? 9000 : undefined);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title ?? (edition ? `Modifier la session ${edition.year}` : 'Nouvelle session')}>
      <form onSubmit={save} className="flex flex-col gap-3">
        {!fixedFamily && !edition && (
          <Field label="Concours" htmlFor="ed-family"><FamilySelect id="ed-family" value={d.familySlug} onChange={(v) => setD((x) => ({ ...x, familySlug: v, positionSlugs: [] }))} allowEmpty={false} required /></Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Année" htmlFor="ed-year"><Input id="ed-year" type="number" min={1990} max={2100} required value={d.year} onChange={(e) => set('year', e.target.value)} /></Field>
          <Field label="Libellé de session (optionnel)" htmlFor="ed-label"><Input id="ed-label" value={d.sessionLabel} onChange={(e) => set('sessionLabel', e.target.value)} dir="auto" placeholder="Session de septembre" /></Field>
        </div>
        <Field label="Statut de la session" htmlFor="ed-status">
          <Select id="ed-status" value={d.status} onChange={(e) => set('status', e.target.value as EditionStatus)}>
            {EDITION_STATUSES.map((s) => <option key={s} value={s}>{EDITION_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ouverture inscriptions" htmlFor="ed-open"><Input id="ed-open" type="date" value={d.registrationOpen} onChange={(e) => set('registrationOpen', e.target.value)} /></Field>
          <Field label="Date limite" htmlFor="ed-deadline"><Input id="ed-deadline" type="date" value={d.registrationDeadline} onChange={(e) => set('registrationDeadline', e.target.value)} /></Field>
          <Field label="Date d’examen" htmlFor="ed-exam"><Input id="ed-exam" type="date" value={d.examDate} onChange={(e) => set('examDate', e.target.value)} /></Field>
        </div>
        {dateIssue && <p className="text-xs text-danger" role="alert">{dateIssue}</p>}
        <Field label="Nombre de postes ouverts" htmlFor="ed-count"><Input id="ed-count" type="number" min={0} value={d.positionsCount} onChange={(e) => set('positionsCount', e.target.value)} /></Field>
        {d.familySlug && (
          <fieldset className="flex flex-col gap-0.5">
            <legend className="mb-1 text-sm font-semibold">Postes concernés <span className="font-normal text-muted">(aucun coché = tous les postes du concours)</span></legend>
            {positions.length ? positions.map((p) => (
              <Checkbox key={p.slug} checked={d.positionSlugs.includes(p.slug)} onChange={(v) => set('positionSlugs', v ? [...d.positionSlugs, p.slug] : d.positionSlugs.filter((s) => s !== p.slug))} label={<span>{p.title_fr} <code className="text-xs text-muted">{p.slug}</code></span>} />
            )) : <p className="text-xs text-muted">Aucun poste défini pour ce concours.</p>}
          </fieldset>
        )}
        <Field label="Lien de l’avis officiel" htmlFor="ed-url"><Input id="ed-url" type="url" value={d.announcementUrl} onChange={(e) => set('announcementUrl', e.target.value)} dir="ltr" placeholder="https://" /></Field>
        <Field label="Source" htmlFor="ed-source" hint="Obligatoire pour marquer la session comme vérifiée."><SourcePicker id="ed-source" value={d.sourceId} onChange={(v) => setD((x) => ({ ...x, sourceId: v, needsVerification: v ? x.needsVerification : true }))} /></Field>
        <Field label="Confiance" htmlFor="ed-conf">
          <Select id="ed-conf" value={d.confidence} onChange={(e) => set('confidence', e.target.value as Confidence)}>
            {CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
          </Select>
        </Field>
        <Toggle checked={!d.needsVerification} onChange={(v) => set('needsVerification', !v)} label="Vérifiée contre la source" description="Sinon la session est affichée « À vérifier / للتحقق » sur le site." disabled={!d.sourceId && d.needsVerification} />

        {announceable && published && (
          <Alert tone="info" title="Cette sauvegarde peut déclencher des alertes">
            <span className="flex items-start gap-1.5">
              <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {wasAnnounceable
                  ? 'Session déjà annoncée : seuls les candidats correspondants pas encore prévenus (nouveaux postes ciblés, nouvelles dates, données confirmées) seront notifiés.'
                  : `En enregistrant avec le statut « ${EDITION_STATUS_LABEL[d.status]} », tous les candidats dont le profil correspond (âge, diplôme, sexe, taille…) recevront une alerte (in-app, push, e-mail selon leurs préférences).`}
                {d.needsVerification && ' Les candidats verront la mention « À vérifier ».'}
              </span>
            </span>
          </Alert>
        )}
        {(d.status === 'OPEN' || d.status === 'ANNOUNCED') && deadlinePassed && <Alert tone="warning">Date limite dépassée : aucune alerte ne sera envoyée.</Alert>}
        {edition && !published && <Alert tone="warning">Session non publiée : aucune alerte tant qu’elle n’est pas relue et publiée (file de revue).</Alert>}
        {edition && (
          <Checkbox checked={notify} onChange={setNotify} label="Prévenir les abonnés des changements de dates/statut (décochez pour une simple correction de coquille)" />
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={busy} disabled={!!dateIssue}>{edition ? 'Enregistrer' : 'Créer la session'}</Button>
        </div>
      </form>
    </Modal>
  );
}

'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Braces, ListChecks } from 'lucide-react';
import type { Confidence, ContentStatus, DiplomaLevel, EligibilityRules, Gender } from '@ctn/shared';
import { CONFIDENCES, CONTENT_STATUSES, DIPLOMA_LABELS, DIPLOMA_LEVELS } from '@ctn/shared/dist/enums';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { CONFIDENCE_LABEL, CONTENT_STATUS_LABEL } from './labels';
import { SourcePicker } from './pickers';
import { useToast } from './toast';
import type { AdminPosition } from './types';
import { Checkbox, ListInput, Toggle } from './ui';

// ───────── Eligibility rules editor (form fields ⇄ JSON) ─────────

export interface RulesDraft {
  min_age: string; max_age: string; genders: Gender[]; nationality: string; min_diploma: DiplomaLevel | ''; diplomas: DiplomaLevel[];
  specialties: string[]; min_height_cm_male: string; min_height_cm_female: string; singleOnly: boolean; other_ar: string[]; other_fr: string[];
}

export function rulesToDraft(r: Partial<EligibilityRules> | null | undefined): RulesDraft {
  const x = r ?? {};
  return {
    min_age: x.min_age != null ? String(x.min_age) : '', max_age: x.max_age != null ? String(x.max_age) : '',
    genders: x.genders ?? [], nationality: x.nationality ?? '', min_diploma: x.min_diploma ?? '', diplomas: x.diplomas ?? [],
    specialties: x.specialties ?? [], min_height_cm_male: x.min_height_cm_male != null ? String(x.min_height_cm_male) : '',
    min_height_cm_female: x.min_height_cm_female != null ? String(x.min_height_cm_female) : '', singleOnly: x.marital_status === 'SINGLE',
    other_ar: x.other_ar ?? [], other_fr: x.other_fr ?? [],
  };
}

const int = (s: string): number | null => (s.trim() && Number.isFinite(Number(s)) ? Math.round(Number(s)) : null);

/** Rules in the API's strict format (EligibilityRulesInput): empty values become null and are dropped server-side. */
export function draftToRules(d: RulesDraft): EligibilityRules {
  return {
    min_age: int(d.min_age), max_age: int(d.max_age), genders: d.genders.length === 1 ? d.genders : null,
    nationality: d.nationality.trim() || null, min_diploma: d.min_diploma || null, diplomas: d.diplomas.length ? d.diplomas : null,
    specialties: d.specialties.length ? d.specialties : null, min_height_cm_male: int(d.min_height_cm_male), min_height_cm_female: int(d.min_height_cm_female),
    marital_status: d.singleOnly ? 'SINGLE' : null, other_ar: d.other_ar, other_fr: d.other_fr,
  };
}

/** Keys accepted by the API (anything else, like a legacy `needs_verification`, is stripped before saving). */
const RULE_KEYS = ['min_age', 'max_age', 'genders', 'nationality', 'min_diploma', 'diplomas', 'specialties', 'min_height_cm_male', 'min_height_cm_female', 'marital_status', 'other_ar', 'other_fr'] as const;
export function sanitizeRules(r: Record<string, unknown>): Partial<EligibilityRules> {
  return Object.fromEntries(Object.entries(r).filter(([k]) => (RULE_KEYS as readonly string[]).includes(k))) as Partial<EligibilityRules>;
}

export function rulesIssues(d: RulesDraft): string[] {
  const out: string[] = [];
  const a = int(d.min_age);
  const b = int(d.max_age);
  if (a != null && (a < 10 || a > 100)) out.push('Âge minimum entre 10 et 100.');
  if (b != null && (b < 10 || b > 100)) out.push('Âge maximum entre 10 et 100.');
  if (a != null && b != null && a > b) out.push('Âge minimum > âge maximum.');
  for (const [k, l] of [['min_height_cm_male', 'Taille min. hommes'], ['min_height_cm_female', 'Taille min. femmes']] as const) {
    const h = int(d[k]);
    if (h != null && (h < 100 || h > 230)) out.push(`${l} entre 100 et 230 cm.`);
  }
  return out;
}

export function EligibilityEditor({ value, onChange, idPrefix = 'el' }: { value: RulesDraft; onChange: (d: RulesDraft) => void; idPrefix?: string }) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const set = <K extends keyof RulesDraft>(k: K, v: RulesDraft[K]) => onChange({ ...value, [k]: v });
  const issues = rulesIssues(value);

  function toJson() {
    setJson(JSON.stringify(Object.fromEntries(Object.entries(draftToRules(value)).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length))), null, 2));
    setJsonError(null);
    setMode('json');
  }
  function fromJson() {
    try {
      const parsed = JSON.parse(json || '{}') as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Objet JSON attendu');
      onChange(rulesToDraft(sanitizeRules(parsed as Record<string, unknown>)));
      setMode('form');
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        {mode === 'form'
          ? <Button type="button" size="sm" variant="ghost" onClick={toJson}><Braces className="size-4" aria-hidden />Éditer en JSON</Button>
          : <Button type="button" size="sm" variant="ghost" onClick={fromJson}><ListChecks className="size-4" aria-hidden />Appliquer et revenir au formulaire</Button>}
      </div>
      {mode === 'json' ? (
        <div className="flex flex-col gap-1">
          <Textarea aria-label="Règles d’éligibilité (JSON)" rows={12} value={json} onChange={(e) => setJson(e.target.value)} dir="ltr" className="font-mono text-xs" />
          {jsonError && <p className="text-xs text-danger" role="alert">JSON invalide : {jsonError}</p>}
          <p className="text-xs text-muted">Clés : {RULE_KEYS.join(', ')}.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Âge minimum" htmlFor={`${idPrefix}-min`}><Input id={`${idPrefix}-min`} type="number" min={10} max={100} value={value.min_age} onChange={(e) => set('min_age', e.target.value)} /></Field>
            <Field label="Âge maximum" htmlFor={`${idPrefix}-max`} hint="Calculé à la date limite d’inscription."><Input id={`${idPrefix}-max`} type="number" min={10} max={100} value={value.max_age} onChange={(e) => set('max_age', e.target.value)} /></Field>
          </div>
          <fieldset className="flex flex-wrap items-center gap-4">
            <legend className="mb-1 text-sm font-semibold">Sexe admis <span className="font-normal text-muted">(aucun = les deux)</span></legend>
            <Checkbox checked={value.genders.includes('M')} onChange={(v) => set('genders', v ? [...new Set([...value.genders, 'M' as const])] : value.genders.filter((g) => g !== 'M'))} label="Hommes" />
            <Checkbox checked={value.genders.includes('F')} onChange={(v) => set('genders', v ? [...new Set([...value.genders, 'F' as const])] : value.genders.filter((g) => g !== 'F'))} label="Femmes" />
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Diplôme minimum" htmlFor={`${idPrefix}-dipl`}>
              <Select id={`${idPrefix}-dipl`} value={value.min_diploma} onChange={(e) => set('min_diploma', e.target.value as DiplomaLevel | '')}>
                <option value="">— Non précisé —</option>
                {DIPLOMA_LEVELS.map((l) => <option key={l} value={l}>{DIPLOMA_LABELS[l].fr}</option>)}
              </Select>
            </Field>
            <Field label="Nationalité" htmlFor={`${idPrefix}-nat`} hint="Code pays, ex. TN."><Input id={`${idPrefix}-nat`} value={value.nationality} maxLength={10} onChange={(e) => set('nationality', e.target.value.toUpperCase())} dir="ltr" /></Field>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold">Diplômes exacts acceptés <span className="font-normal text-muted">(remplace le minimum s’il est renseigné)</span></legend>
            <div className="grid gap-0.5 sm:grid-cols-2">
              {DIPLOMA_LEVELS.map((l) => (
                <Checkbox key={l} checked={value.diplomas.includes(l)} onChange={(v) => set('diplomas', v ? [...value.diplomas, l] : value.diplomas.filter((x) => x !== l))} label={DIPLOMA_LABELS[l].fr} />
              ))}
            </div>
          </fieldset>
          <Field label="Spécialités acceptées" htmlFor={`${idPrefix}-spec`} hint="Une par ligne ; vide = toutes."><ListInput id={`${idPrefix}-spec`} value={value.specialties} onChange={(v) => set('specialties', v)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Taille min. hommes (cm)" htmlFor={`${idPrefix}-hm`}><Input id={`${idPrefix}-hm`} type="number" min={100} max={230} value={value.min_height_cm_male} onChange={(e) => set('min_height_cm_male', e.target.value)} /></Field>
            <Field label="Taille min. femmes (cm)" htmlFor={`${idPrefix}-hf`}><Input id={`${idPrefix}-hf`} type="number" min={100} max={230} value={value.min_height_cm_female} onChange={(e) => set('min_height_cm_female', e.target.value)} /></Field>
          </div>
          <Checkbox checked={value.singleOnly} onChange={(v) => set('singleOnly', v)} label="Réservé aux célibataires" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Autres conditions (FR)" htmlFor={`${idPrefix}-ofr`} hint="Non vérifiables automatiquement ; une par ligne."><ListInput id={`${idPrefix}-ofr`} value={value.other_fr} onChange={(v) => set('other_fr', v)} /></Field>
            <Field label="Autres conditions (AR)" htmlFor={`${idPrefix}-oar`}><ListInput id={`${idPrefix}-oar`} value={value.other_ar} onChange={(v) => set('other_ar', v)} dir="rtl" /></Field>
          </div>
        </>
      )}
      {issues.length > 0 && <ul className="list-disc ps-5 text-xs text-danger" role="alert">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
    </div>
  );
}

// ───────── Position form ─────────

export interface PositionPrefill { rules?: Partial<EligibilityRules>; quote?: string | null; sourceId?: string | null; diplomaLevel?: DiplomaLevel | null }

interface PosDraft {
  slug: string; title_ar: string; title_fr: string; diplomaLevel: DiplomaLevel; orderIndex: string; status: ContentStatus;
  rules: RulesDraft; sourceId: string | null; confidence: Confidence; needsVerification: boolean; quote: string;
}

function posDraft(p: AdminPosition | null, prefill?: PositionPrefill): PosDraft {
  const base: PosDraft = p
    ? {
      slug: p.slug, title_ar: p.title_ar, title_fr: p.title_fr, diplomaLevel: p.diplomaLevel, orderIndex: String(p.orderIndex), status: p.status,
      rules: rulesToDraft(sanitizeRules(p.eligibility as Record<string, unknown>)), sourceId: p.eligibilityProvenance.source?.id ?? null,
      confidence: p.eligibilityProvenance.confidence, needsVerification: p.eligibilityProvenance.needsVerification, quote: p.eligibilityProvenance.sourceQuote ?? '',
    }
    : { slug: '', title_ar: '', title_fr: '', diplomaLevel: 'BAC', orderIndex: '0', status: 'PUBLISHED', rules: rulesToDraft({}), sourceId: null, confidence: 'LOW', needsVerification: true, quote: '' };
  if (!prefill) return base;
  // Extracted values are suggestions: merged over the current rules, and the result stays "to verify".
  return {
    ...base,
    rules: prefill.rules ? rulesToDraft({ ...draftToRules(base.rules), ...Object.fromEntries(Object.entries(prefill.rules).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))) }) : base.rules,
    quote: prefill.quote ?? base.quote,
    sourceId: prefill.sourceId ?? base.sourceId,
    diplomaLevel: prefill.diplomaLevel ?? base.diplomaLevel,
    needsVerification: true,
  };
}

/** Create or edit a position and its eligibility rules (with provenance). Saving re-matches the family's open editions. */
export function PositionFormModal({ open, onClose, familySlug, position, prefill, onSaved }: {
  open: boolean; onClose: () => void; familySlug: string; position: AdminPosition | null; prefill?: PositionPrefill; onSaved?: (p: AdminPosition) => void;
}) {
  const { toast, toastError } = useToast();
  const [d, setD] = useState<PosDraft>(() => posDraft(position, prefill));
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setD(posDraft(position, prefill));
    wasOpen.current = open;
  }, [open, position, prefill]);
  const set = <K extends keyof PosDraft>(k: K, v: PosDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const issues = rulesIssues(d.rules);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (issues.length) return;
    setBusy(true);
    const body = {
      title_ar: d.title_ar.trim(), title_fr: d.title_fr.trim(), diplomaLevel: d.diplomaLevel, orderIndex: Number(d.orderIndex) || 0, status: d.status,
      eligibility: draftToRules(d.rules), eligibilitySourceId: d.sourceId, eligibilityConfidence: d.confidence,
      eligibilityNeedsVerification: d.needsVerification, eligibilityQuote: d.quote.trim() || null,
    };
    const slug = position?.slug ?? d.slug.trim();
    try {
      const saved = await api<AdminPosition>(`/admin/families/${familySlug}/positions/${encodeURIComponent(slug)}`, { method: position ? 'PATCH' : 'POST', body });
      toast({ tone: 'success', title: position ? 'Poste mis à jour' : 'Poste créé', body: 'Les candidats devenus éligibles aux sessions ouvertes de ce concours seront alertés.' });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={position ? `Poste : ${position.title_fr}` : 'Nouveau poste'}>
      <form onSubmit={save} className="flex flex-col gap-3">
        {prefill && <Alert tone="info">Valeurs pré-remplies depuis l’extraction : vérifiez chaque condition contre la citation avant d’enregistrer.</Alert>}
        {!position && (
          <Field label="Identifiant (slug)" htmlFor="pos-slug" hint="Minuscules, chiffres et tirets — ex. agent-de-police.">
            <Input id="pos-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={d.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} dir="ltr" />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Intitulé (FR)" htmlFor="pos-fr"><Input id="pos-fr" required minLength={2} value={d.title_fr} onChange={(e) => set('title_fr', e.target.value)} /></Field>
          <Field label="Intitulé (AR)" htmlFor="pos-ar"><Input id="pos-ar" required minLength={2} value={d.title_ar} onChange={(e) => set('title_ar', e.target.value)} dir="rtl" lang="ar" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Niveau de diplôme" htmlFor="pos-dipl">
            <Select id="pos-dipl" value={d.diplomaLevel} onChange={(e) => set('diplomaLevel', e.target.value as DiplomaLevel)}>
              {DIPLOMA_LEVELS.map((l) => <option key={l} value={l}>{DIPLOMA_LABELS[l].fr}</option>)}
            </Select>
          </Field>
          <Field label="Ordre" htmlFor="pos-order"><Input id="pos-order" type="number" min={0} max={1000} value={d.orderIndex} onChange={(e) => set('orderIndex', e.target.value)} /></Field>
          <Field label="Statut" htmlFor="pos-status">
            <Select id="pos-status" value={d.status} onChange={(e) => set('status', e.target.value as ContentStatus)}>
              {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{CONTENT_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-bold">Conditions de participation</legend>
          <EligibilityEditor value={d.rules} onChange={(r) => set('rules', r)} idPrefix="pos-el" />
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-bold">Provenance des conditions</legend>
          <Field label="Source" htmlFor="pos-src"><SourcePicker id="pos-src" value={d.sourceId} onChange={(v) => setD((x) => ({ ...x, sourceId: v, needsVerification: v ? x.needsVerification : true }))} /></Field>
          <Field label="Citation de la source" htmlFor="pos-quote" hint="Copiez le passage exact de l’avis (preuve de la condition)."><Textarea id="pos-quote" value={d.quote} onChange={(e) => set('quote', e.target.value)} dir="auto" /></Field>
          <Field label="Confiance" htmlFor="pos-conf">
            <Select id="pos-conf" value={d.confidence} onChange={(e) => set('confidence', e.target.value as Confidence)}>
              {CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
            </Select>
          </Field>
          <Toggle checked={!d.needsVerification} onChange={(v) => set('needsVerification', !v)} disabled={!d.sourceId && d.needsVerification} label="Conditions vérifiées contre la source" description="Sinon affichées « À vérifier / للتحقق » ; les alertes le mentionnent." />
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={busy} disabled={issues.length > 0}>{position ? 'Enregistrer' : 'Créer le poste'}</Button>
        </div>
      </form>
    </Modal>
  );
}

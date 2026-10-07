'use client';

import clsx from 'clsx';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarPlus, CircleCheck, CircleHelp, Crosshair, UserCheck } from 'lucide-react';
import type { DiplomaLevel, EligibilityRules } from '@ctn/shared';
import { DIPLOMA_LABELS, DIPLOMA_RANK, DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, Field, Modal, Select } from '@/components/ui';
import { EditionFormModal, type EditionPrefill } from './edition-form';
import { useAdminApi } from './hooks';
import { fmtDate, PHASE_KIND_LABEL, tunisToday } from './labels';
import { FamilySelect } from './pickers';
import { PositionFormModal, type PositionPrefill } from './position-form';
import type { EditionProposal, FactsProposal, FamilyDetail, Quoted } from './types';

const ARABIC = /[؀-ۿ]/;

/** Eligibility suggestions of a proposal in the API's rules format (min diploma = lowest level quoted). */
export function proposalRules(p: FactsProposal): { rules: Partial<EligibilityRules>; quote: string | null; diploma: DiplomaLevel | null } {
  const e = p.eligibility;
  const levels = e.diplomas.map((d) => d.level).filter((l): l is DiplomaLevel => !!l);
  const minLevel = levels.length ? levels.reduce((a, b) => (DIPLOMA_RANK[a] <= DIPLOMA_RANK[b] ? a : b)) : null;
  const other = e.other.map((o) => o.text);
  const rules: Partial<EligibilityRules> = {
    min_age: e.min_age?.value ?? null, max_age: e.max_age?.value ?? null, genders: e.genders?.value?.length ? e.genders.value : null,
    nationality: e.nationality?.value ?? null, min_diploma: minLevel, specialties: e.specialties.length ? e.specialties.map((s) => s.text) : null,
    min_height_cm_male: e.min_height_cm_male?.value ?? null, min_height_cm_female: e.min_height_cm_female?.value ?? null,
    marital_status: e.marital_status?.value === 'SINGLE' ? 'SINGLE' : null,
    other_ar: other.filter((t) => ARABIC.test(t)), other_fr: other.filter((t) => !ARABIC.test(t)),
  };
  const quotes = [e.min_age, e.max_age, e.genders, e.nationality, e.min_height_cm_male, e.min_height_cm_female, e.marital_status, ...e.diplomas, ...e.specialties, ...e.other]
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => x.source_quote.trim())
    .filter(Boolean);
  return { rules, quote: quotes.length ? [...new Set(quotes)].join(' … ') : null, diploma: minLevel };
}

export function editionPrefill(ed: EditionProposal, source: { id: string; url: string | null } | null): EditionPrefill {
  const today = tunisToday();
  const open = !!ed.registration_open && ed.registration_open <= today && (!ed.registration_deadline || ed.registration_deadline >= today);
  const ref = ed.registration_deadline ?? ed.exam_date ?? ed.registration_open;
  return {
    year: ed.year ?? (ref ? Number(ref.slice(0, 4)) : null),
    sessionLabel: ed.session_label, registrationOpen: ed.registration_open, registrationDeadline: ed.registration_deadline, examDate: ed.exam_date,
    positionsCount: ed.positions_count, status: open ? 'OPEN' : 'ANNOUNCED', sourceId: source?.id ?? null, announcementUrl: source?.url ?? null, confidence: 'MEDIUM',
  };
}

function QuoteLine({ q, onLocate }: { q: Pick<Quoted, 'source_quote' | 'page'> & { quote_verified?: boolean }; onLocate?: (quote: string, page: number | null) => void }) {
  return (
    <div className="flex items-start gap-1.5 text-xs">
      {q.quote_verified === false
        ? <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label="Citation introuvable telle quelle dans le texte" />
        : <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Citation retrouvée dans le texte" />}
      <blockquote className="flex-1 italic text-muted" dir="auto">« {q.source_quote} »{q.page != null && <span className="not-italic"> — p. {q.page}</span>}</blockquote>
      {onLocate && (
        <button type="button" onClick={() => onLocate(q.source_quote, q.page)} className="inline-flex shrink-0 items-center gap-1 rounded px-1 font-semibold text-primary hover:bg-primary-soft" title="Voir dans le texte">
          <Crosshair className="size-3.5" aria-hidden />Voir
        </button>
      )}
    </div>
  );
}

function Item({ title, children, quote, onLocate }: { title: ReactNode; children?: ReactNode; quote: Pick<Quoted, 'source_quote' | 'page'> & { quote_verified?: boolean }; onLocate?: (quote: string, page: number | null) => void }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border p-2">
      <div className="text-sm"><span className="font-semibold">{title}</span>{children && <> : {children}</>}</div>
      <QuoteLine q={quote} onLocate={onLocate} />
    </li>
  );
}

/**
 * Extraction proposal (DRAFT, nothing applied) shown item by item with its verbatim quote, plus buttons that copy the
 * values into an edition form or a position's eligibility form. Everything copied stays "to verify".
 */
export function ProposalPanel({ proposal, source, defaultFamily, onLocate }: {
  proposal: FactsProposal; source: { id: string; url: string | null } | null; defaultFamily?: string | null; onLocate?: (quote: string, page: number | null) => void;
}) {
  const [editionPrefillState, setEditionPrefill] = useState<EditionPrefill | null>(null);
  const [positionTarget, setPositionTarget] = useState<boolean>(false);
  const e = proposal.eligibility;
  const elig = useMemo(() => proposalRules(proposal), [proposal]);
  const hasEligibility = Object.values(elig.rules).some((v) => v != null && !(Array.isArray(v) && !v.length));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="warning">Brouillon — à vérifier</Badge>
        <Badge tone={proposal.method === 'AI' ? 'accent' : 'neutral'}>{proposal.method === 'AI' ? 'Extraction IA' : 'Extraction heuristique'}</Badge>
        {proposal.family_slug && <Badge tone="primary">{proposal.family_slug}</Badge>}
      </div>
      {proposal.warnings.filter((w) => !w.startsWith('DRAFT')).map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
      {!source && <Alert tone="info">Ce document n’est rattaché à aucune source : choisissez-en une dans le formulaire avant de marquer quoi que ce soit comme vérifié.</Alert>}

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">Sessions ({proposal.editions.length})</h3>
        {proposal.editions.length ? proposal.editions.map((ed, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
            <ul className="flex flex-col gap-1 text-sm">
              <li>Année : <b>{ed.year ?? '—'}</b>{ed.session_label ? ` · ${ed.session_label}` : ''}</li>
              <li>Ouverture : <b>{fmtDate(ed.registration_open)}</b> · Clôture : <b>{fmtDate(ed.registration_deadline)}</b> · Examen : <b>{fmtDate(ed.exam_date)}</b></li>
              <li>Postes : <b>{ed.positions_count ?? '—'}</b></li>
            </ul>
            <QuoteLine q={ed} onLocate={onLocate} />
            {ed.field_quotes && Object.entries(ed.field_quotes).map(([k, fq]) => fq && <div key={k} className="ps-4"><span className="text-xs font-semibold">{k}</span><QuoteLine q={fq} onLocate={onLocate} /></div>)}
            <Button size="sm" className="self-start" onClick={() => setEditionPrefill(editionPrefill(ed, source))}><CalendarPlus className="size-4" aria-hidden />Copier dans une nouvelle session</Button>
          </div>
        )) : <p className="text-sm text-muted">Aucune date de session trouvée.</p>}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Conditions de participation</h3>
          {hasEligibility && <Button size="sm" variant="secondary" onClick={() => setPositionTarget(true)}><UserCheck className="size-4" aria-hidden />Copier dans les conditions d’un poste</Button>}
        </div>
        <ul className="flex flex-col gap-1.5">
          {e.min_age && <Item title="Âge minimum" quote={e.min_age} onLocate={onLocate}>{e.min_age.value} ans</Item>}
          {e.max_age && <Item title="Âge maximum" quote={e.max_age} onLocate={onLocate}>{e.max_age.value} ans</Item>}
          {e.genders && <Item title="Sexe" quote={e.genders} onLocate={onLocate}>{e.genders.value.map((g) => (g === 'M' ? 'hommes' : 'femmes')).join(', ')}</Item>}
          {e.nationality && <Item title="Nationalité" quote={e.nationality} onLocate={onLocate}>{e.nationality.value}</Item>}
          {e.diplomas.map((d, i) => <Item key={`d${i}`} title="Diplôme" quote={d} onLocate={onLocate}>{d.level ? DIPLOMA_LABELS[d.level]?.fr : '?'} <span className="text-muted" dir="auto">({d.text})</span></Item>)}
          {e.specialties.map((s, i) => <Item key={`s${i}`} title="Spécialité" quote={s} onLocate={onLocate}><span dir="auto">{s.text}</span></Item>)}
          {e.min_height_cm_male && <Item title="Taille min. hommes" quote={e.min_height_cm_male} onLocate={onLocate}>{e.min_height_cm_male.value} cm</Item>}
          {e.min_height_cm_female && <Item title="Taille min. femmes" quote={e.min_height_cm_female} onLocate={onLocate}>{e.min_height_cm_female.value} cm</Item>}
          {e.marital_status && <Item title="Situation familiale" quote={e.marital_status} onLocate={onLocate}>{e.marital_status.value}</Item>}
          {e.other.map((o, i) => <Item key={`o${i}`} title="Autre condition" quote={o} onLocate={onLocate}><span dir="auto">{o.text}</span></Item>)}
          {!hasEligibility && <li className="text-sm text-muted">Aucune condition trouvée.</li>}
        </ul>
      </section>

      {proposal.phases.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-bold">Épreuves ({proposal.phases.length})</h3>
          <ul className="flex flex-col gap-1.5">
            {proposal.phases.map((p, i) => (
              <Item key={i} title={`${p.order}. ${p.name}`} quote={p} onLocate={onLocate}>
                {PHASE_KIND_LABEL[p.kind] ?? p.kind}{p.is_eliminatory ? ' · éliminatoire' : ''}{p.duration_minutes ? ` · ${p.duration_minutes} min` : ''}
              </Item>
            ))}
          </ul>
        </section>
      )}
      {proposal.subjects.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-bold">Matières ({proposal.subjects.length})</h3>
          <ul className="flex flex-col gap-1.5">
            {proposal.subjects.map((s, i) => (
              <Item key={i} title={<span dir="auto">{s.name}</span>} quote={s} onLocate={onLocate}>
                {s.domain ? DOMAIN_LABELS[s.domain]?.fr : 'domaine ?'}{s.coefficient != null ? ` · coef. ${s.coefficient}` : ''}{s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}
              </Item>
            ))}
          </ul>
        </section>
      )}
      {proposal.required_documents.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-bold">Pièces à fournir ({proposal.required_documents.length})</h3>
          <ul className="flex flex-col gap-1.5">
            {proposal.required_documents.map((d, i) => <Item key={i} title={<span dir="auto">{d.text}</span>} quote={d} onLocate={onLocate} />)}
          </ul>
        </section>
      )}

      <EditionFormModal
        open={!!editionPrefillState}
        onClose={() => setEditionPrefill(null)}
        familySlug={defaultFamily ?? proposal.family_slug ?? null}
        prefill={editionPrefillState ?? undefined}
        title="Nouvelle session (depuis l’extraction)"
      />
      <PositionPicker
        open={positionTarget}
        onClose={() => setPositionTarget(false)}
        defaultFamily={defaultFamily ?? proposal.family_slug ?? ''}
        prefill={{ rules: elig.rules, quote: elig.quote, sourceId: source?.id ?? null, diplomaLevel: elig.diploma }}
      />
    </div>
  );
}

/** Chooses the family + position that receives the extracted eligibility, then opens its form pre-filled. */
function PositionPicker({ open, onClose, defaultFamily, prefill }: { open: boolean; onClose: () => void; defaultFamily: string; prefill: PositionPrefill }) {
  const [family, setFamily] = useState(defaultFamily);
  const [positionSlug, setPositionSlug] = useState('');
  const [editing, setEditing] = useState(false);
  // The native dialog fires "close" when we swap it for the position form: that must not cancel the whole flow.
  const editingRef = useRef(false);
  editingRef.current = editing;
  const { data } = useAdminApi<FamilyDetail>(open && family ? `/admin/families/${family}` : null);
  const positions = data?.slug === family ? data.positions : [];
  const position = positions.find((p) => p.slug === positionSlug) ?? null;

  return (
    <>
      <Modal open={open && !editing} onClose={() => { if (!editingRef.current) onClose(); }} title="Appliquer les conditions à un poste">
        <div className="flex flex-col gap-3">
          <Field label="Concours" htmlFor="pp-family"><FamilySelect id="pp-family" value={family} onChange={(v) => { setFamily(v); setPositionSlug(''); }} allowEmpty={false} /></Field>
          <Field label="Poste" htmlFor="pp-pos">
            <Select id="pp-pos" value={positionSlug} onChange={(e) => setPositionSlug(e.target.value)} disabled={!family}>
              <option value="">— Nouveau poste —</option>
              {positions.map((p) => <option key={p.slug} value={p.slug}>{p.title_fr} ({p.slug})</option>)}
            </Select>
          </Field>
          <p className="text-xs text-muted">Les valeurs extraites remplacent les conditions correspondantes ; le reste est conservé. Le poste repasse « À vérifier ».</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button disabled={!family} onClick={() => setEditing(true)}>Ouvrir le formulaire</Button>
          </div>
        </div>
      </Modal>
      {family && (
        <PositionFormModal
          open={open && editing}
          onClose={() => { setEditing(false); onClose(); }}
          familySlug={family}
          position={position}
          prefill={prefill}
        />
      )}
    </>
  );
}

/** Splits `text` around occurrences of `quote` (whitespace-insensitive) for <mark> highlighting. */
export function highlight(text: string, quote: string | null): ReactNode {
  if (!quote) return text;
  const words = quote.trim().split(/\s+/).filter(Boolean).slice(0, 60).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return text;
  let re: RegExp;
  try {
    re = new RegExp(words.join('\\s+'), 'gi');
  } catch {
    return text;
  }
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(<mark key={i} className={clsx('rounded bg-warning-soft px-0.5 text-text ring-2 ring-warning')}>{m[0]}</mark>);
    last = i + m[0].length;
  }
  if (!out.length) return text;
  out.push(text.slice(last));
  return out;
}

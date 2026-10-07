'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import type { Confidence, SourceType } from '@ctn/shared';
import { CONFIDENCES, FIELD_LABELS, SOURCE_TYPES } from '@ctn/shared/dist/enums';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { FAMILIES_LOOKUP, invalidateLookup, SOURCES_LOOKUP, useLookup } from './hooks';
import { CONFIDENCE_LABEL, SOURCE_TYPE_LABEL } from './labels';
import { useToast } from './toast';
import type { FamilyListItem, Paged, SourceRow } from './types';
import { IsolateDialog } from './ui';

export function useSources() {
  const r = useLookup<Paged<SourceRow>>(SOURCES_LOOKUP);
  return { sources: r.data?.items ?? [], loading: r.loading, error: r.error };
}

export function useFamilies() {
  const r = useLookup<FamilyListItem[]>(FAMILIES_LOOKUP);
  return { families: r.data ?? [], loading: r.loading, error: r.error };
}

/** Family <select> (French name, grouped by field). `allowEmpty` adds a "—" choice with `emptyLabel`. */
export function FamilySelect({ id, value, onChange, allowEmpty = true, emptyLabel = 'Tous les concours', required, disabled }: {
  id: string; value: string; onChange: (slug: string) => void; allowEmpty?: boolean; emptyLabel?: string; required?: boolean; disabled?: boolean;
}) {
  const { families, loading } = useFamilies();
  const groups = useMemo(() => {
    const m = new Map<string, FamilyListItem[]>();
    for (const f of families) m.set(f.field, [...(m.get(f.field) ?? []), f]);
    return [...m.entries()];
  }, [families]);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled || loading}>
      {allowEmpty && <option value="">{loading ? 'Chargement…' : emptyLabel}</option>}
      {!allowEmpty && !value && <option value="" disabled>{loading ? 'Chargement…' : 'Choisir un concours'}</option>}
      {groups.map(([field, list]) => (
        <optgroup key={field} label={FIELD_LABELS[field as keyof typeof FIELD_LABELS]?.fr ?? field}>
          {list.map((f) => <option key={f.slug} value={f.slug}>{f.name_fr || f.name_ar} ({f.slug})</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

/** Source <select> with a filter box and a "new source" shortcut (verifying something always needs a source). */
export function SourcePicker({ id, value, onChange, allowEmpty = true }: { id: string; value: string | null; onChange: (id: string | null) => void; allowEmpty?: boolean }) {
  const { sources, loading } = useSources();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? sources.filter((s) => `${s.title} ${s.url ?? ''} ${s.publisher ?? ''}`.toLowerCase().includes(f)) : sources;
    // Keep the selected source visible even when filtered out.
    const selected = value ? sources.find((s) => s.id === value) : undefined;
    return selected && !list.includes(selected) ? [selected, ...list] : list;
  }, [sources, filter, value]);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={loading} className="min-w-0 flex-1">
          {allowEmpty && <option value="">{loading ? 'Chargement…' : '— Aucune source —'}</option>}
          {shown.map((s) => <option key={s.id} value={s.id}>[{SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}] {s.title}</option>)}
        </Select>
        <Button type="button" variant="secondary" onClick={() => setCreating(true)} aria-label="Nouvelle source" title="Nouvelle source"><Plus className="size-4" aria-hidden /></Button>
      </div>
      {sources.length > 12 && (
        <Input aria-label="Filtrer les sources" placeholder="Filtrer les sources…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 text-sm" />
      )}
      {/* Portaled: the picker usually sits inside another form, and forms must not nest. */}
      {creating && createPortal(
        <IsolateDialog><SourceFormModal open onClose={() => setCreating(false)} onSaved={(s) => onChange(s.id)} /></IsolateDialog>,
        document.getElementById('admin-portal') ?? document.body,
      )}
    </div>
  );
}

export interface SourceDraft { title: string; url: string; publisher: string; sourceType: SourceType; publicationDate: string; confidence: Confidence; notes: string }
const EMPTY_SOURCE: SourceDraft = { title: '', url: '', publisher: '', sourceType: 'OFFICIAL', publicationDate: '', confidence: 'MEDIUM', notes: '' };

/** Create (no `source`) or edit a source (SourceUpsertInput). */
export function SourceFormModal({ open, onClose, onSaved, source, initial }: { open: boolean; onClose: () => void; onSaved?: (s: SourceRow) => void; source?: SourceRow | null; initial?: Partial<SourceDraft> }) {
  const { toast, toastError } = useToast();
  const [d, setD] = useState<SourceDraft>(EMPTY_SOURCE);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    // Reset only when the dialog opens (parents may pass a fresh `initial` object on every render).
    if (open && !wasOpen.current) {
      setD(source
        ? { title: source.title, url: source.url ?? '', publisher: source.publisher ?? '', sourceType: source.sourceType, publicationDate: source.publicationDate ?? '', confidence: source.confidence, notes: source.notes ?? '' }
        : { ...EMPTY_SOURCE, ...initial });
    }
    wasOpen.current = open;
  }, [open, source, initial]);
  const set = <K extends keyof SourceDraft>(k: K, v: SourceDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    // React events bubble through portals: never let this submit reach an enclosing form.
    e.stopPropagation();
    setBusy(true);
    const body = {
      title: d.title.trim(), url: d.url.trim() || null, publisher: d.publisher.trim() || null, sourceType: d.sourceType,
      publicationDate: d.publicationDate || null, confidence: d.confidence, notes: d.notes.trim() || null,
    };
    try {
      const saved = source
        ? await api<SourceRow>(`/admin/sources/${source.id}`, { method: 'PATCH', body })
        : await api<SourceRow>('/admin/sources', { method: 'POST', body });
      invalidateLookup(SOURCES_LOOKUP);
      toast({ tone: 'success', title: source ? 'Source mise à jour' : 'Source créée' });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={source ? 'Modifier la source' : 'Nouvelle source'}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Titre" htmlFor="src-title"><Input id="src-title" required minLength={2} value={d.title} onChange={(e) => set('title', e.target.value)} dir="auto" /></Field>
        <Field label="URL" htmlFor="src-url" hint="Lien vers l’avis officiel, le JORT, la page du ministère…"><Input id="src-url" type="url" value={d.url} onChange={(e) => set('url', e.target.value)} dir="ltr" placeholder="https://" /></Field>
        <Field label="Éditeur" htmlFor="src-pub"><Input id="src-pub" value={d.publisher} onChange={(e) => set('publisher', e.target.value)} dir="auto" placeholder="Ministère de l’Intérieur…" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" htmlFor="src-type">
            <Select id="src-type" value={d.sourceType} onChange={(e) => set('sourceType', e.target.value as SourceType)}>
              {SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_TYPE_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field label="Confiance" htmlFor="src-conf">
            <Select id="src-conf" value={d.confidence} onChange={(e) => set('confidence', e.target.value as Confidence)}>
              {CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Date de publication" htmlFor="src-date"><Input id="src-date" type="date" value={d.publicationDate} onChange={(e) => set('publicationDate', e.target.value)} /></Field>
        <Field label="Notes" htmlFor="src-notes"><Textarea id="src-notes" value={d.notes} onChange={(e) => set('notes', e.target.value)} dir="auto" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={busy}>{source ? 'Enregistrer' : 'Créer la source'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export { FAMILIES_LOOKUP, SOURCES_LOOKUP };

'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, BellRing, Check, CheckCheck, Keyboard, Pencil, RotateCcw, Send, X } from 'lucide-react';
import type { ContentStatus } from '@ctn/shared';
import { CONTENT_STATUSES, DOMAIN_LABELS, DOMAINS } from '@ctn/shared/dist/enums';
import { Badge, Button, Field, Input, Modal, Select, Tabs, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi, useUrlSync } from './hooks';
import {
  ANNOUNCE_BLOCK_LABEL, CONTENT_STATUS_LABEL, EDITION_STATUS_LABEL, fmtDate, fmtDateTime, fmtPct, LANGUAGE_LABEL, ORIGIN_LABEL, qs, safeHref, truncate,
} from './labels';
import { FamilySelect } from './pickers';
import { QuestionPreview } from './question-preview';
import { useAdmin } from './shell';
import { useToast } from './toast';
import type {
  AdminEdition, AdminFact, AdminLessonDetail, AdminQuestionDetail, BulkReviewResult, ReviewAction, ReviewEntity, ReviewItem, ReviewQueueResponse,
  ReviewResult,
} from './types';
import {
  AdminPage, Checkbox, ConfidenceBadge, Empty, ErrorBox, FilterBar, FilterField, JsonBlock, KV, Loading, SourceLink, StatusBadge, useConfirm,
  VerifyBadge,
} from './ui';

const ENTITY_TABS: { value: ReviewEntity; label: string }[] = [
  { value: 'question', label: 'Questions' },
  { value: 'fact', label: 'Faits' },
  { value: 'edition', label: 'Sessions' },
  { value: 'lesson', label: 'Leçons' },
];

/** Labels of the actions per entity: for facts and editions "approve" means "verified against its source". */
const ACTION_LABEL: Record<'content' | 'fact', Record<ReviewAction, string>> = {
  content: { approve: 'Approuver', publish: 'Approuver + publier', reject: 'Rejeter', archive: 'Archiver', to_draft: 'Repasser en brouillon' },
  fact: { approve: 'Marquer vérifié', publish: 'Vérifié + publier', reject: 'Remettre à vérifier', archive: 'Archiver', to_draft: 'Repasser en brouillon' },
};

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
};

export function ReviewView() {
  const sp = useSearchParams();
  const router = useRouter();
  const { refreshStats } = useAdmin();
  const { toast, toastError } = useToast();
  const confirm = useConfirm();

  const [entity, setEntity] = useState<ReviewEntity>(() => (ENTITY_TABS.some((t) => t.value === sp.get('entity')) ? (sp.get('entity') as ReviewEntity) : 'question'));
  const [status, setStatus] = useState<string>(sp.get('status') ?? '');
  const [familySlug, setFamilySlug] = useState(sp.get('familySlug') ?? '');
  const [domain, setDomain] = useState(sp.get('domain') ?? '');
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [lessonEdit, setLessonEdit] = useState<AdminLessonDetail | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const path = `/admin/review${qs({ entity, status, familySlug: entity === 'lesson' ? '' : familySlug, domain: entity === 'question' ? domain : '', limit: 100 })}`;
  const { data, error, loading, reload, setData } = useAdminApi<ReviewQueueResponse>(path);
  const items = useMemo(() => (data?.entity === entity ? data.items : []), [data, entity]);
  const current = items[Math.min(index, Math.max(0, items.length - 1))] as ReviewItem | undefined;
  const kind = entity === 'fact' || entity === 'edition' ? 'fact' : 'content';

  useEffect(() => {
    setIndex(0);
    setSelected(new Set());
  }, [path]);

  // Keep the URL shareable (entity + filters) without adding history entries.
  useUrlSync(`/admin/review${qs({ entity, status, familySlug, domain })}`);

  const removeItems = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setData((d) => (d ? { ...d, items: d.items.filter((i) => !gone.has(i.id)), total: Math.max(0, d.total - ids.length) } : d));
    setSelected((s) => new Set([...s].filter((x) => !gone.has(x))));
  }, [setData]);

  const act = useCallback(async (item: ReviewItem, action: ReviewAction) => {
    let comment: string | undefined;
    if (action === 'reject' || action === 'archive') {
      const r = await confirm.ask({
        title: action === 'reject' ? `${ACTION_LABEL[kind].reject} — motif` : 'Archiver cet élément ?',
        body: action === 'reject'
          ? (entity === 'question' && (item as AdminQuestionDetail).origin === 'AI_GENERATED'
            ? 'Une question générée par IA rejetée est archivée (elle ne reviendra pas dans la file).'
            : 'Le motif est conservé dans l’historique de revue.')
          : 'L’élément disparaît du site et de la file de revue.',
        confirmLabel: action === 'reject' ? 'Rejeter' : 'Archiver',
        comment: { label: 'Commentaire', required: action === 'reject', placeholder: 'Ex. : clé de réponse fausse, option B aussi correcte…' },
      });
      if (!r) return;
      comment = r.comment || undefined;
    }
    setBusy(true);
    try {
      const res = await api<ReviewResult>(`/admin/review/${entity}/${item.id}`, { method: 'POST', body: { action, ...(comment ? { comment } : {}) } });
      const stillQueued = res.item && matchesQueue(res.item, entity, status);
      if (stillQueued && res.item) setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === item.id ? res.item! : i)) } : d));
      else removeItems([item.id]);
      const alerts = res.alerts?.alerts;
      toast({
        tone: 'success',
        title: `${ACTION_LABEL[kind][action]} : ${CONTENT_STATUS_LABEL[res.from]} → ${CONTENT_STATUS_LABEL[res.status]}`,
        body: alerts
          ? `Alertes envoyées : ${alerts.matchedUsers} candidat(s) correspondant(s), ${alerts.notified} notifié(s).`
          : res.alerts?.updateNotified
            ? `${res.alerts.updateNotified} abonné(s) prévenu(s) de la mise à jour.`
            : res.needsVerification === false ? 'Marqué comme vérifié.' : undefined,
      });
      void refreshStats();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }, [confirm, entity, kind, refreshStats, removeItems, setData, status, toast, toastError]);

  const bulk = useCallback(async (action: ReviewAction) => {
    const ids = [...selected];
    if (!ids.length) return;
    let comment: string | undefined;
    const needsConfirm = action === 'reject' || action === 'archive' || action === 'publish';
    if (needsConfirm) {
      const r = await confirm.ask({
        title: `${ACTION_LABEL[kind][action]} ${ids.length} élément(s) ?`,
        body: action === 'publish'
          ? 'Vous attestez avoir relu chacun de ces éléments : ils deviennent visibles par les candidats.'
          : 'Cette action s’applique à toute la sélection.',
        tone: action === 'publish' ? 'primary' : 'danger',
        confirmLabel: ACTION_LABEL[kind][action],
        comment: action === 'reject' ? { label: 'Motif (commun à la sélection)', required: true } : undefined,
      });
      if (!r) return;
      comment = r.comment || undefined;
    }
    setBusy(true);
    try {
      let ok: string[] = [];
      let failed: { id: string; error: string }[] = [];
      if (entity === 'question') {
        const res = await api<BulkReviewResult>('/admin/review/questions/bulk', { method: 'POST', body: { ids, action, ...(comment ? { comment } : {}) } });
        ok = res.ok.map((x) => x.id);
        failed = res.failed;
      } else {
        for (const id of ids) {
          try {
            await api<ReviewResult>(`/admin/review/${entity}/${id}`, { method: 'POST', body: { action, ...(comment ? { comment } : {}) } });
            ok.push(id);
          } catch (e) {
            failed.push({ id, error: e instanceof Error ? e.message : 'ERROR' });
          }
        }
      }
      removeItems(ok);
      toast({
        tone: failed.length ? 'warning' : 'success',
        title: `${ok.length} élément(s) traité(s)${failed.length ? `, ${failed.length} en échec` : ''}`,
        details: failed.slice(0, 6).map((f) => `${f.id.slice(0, 8)}… : ${f.error}`),
      });
      void refreshStats();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }, [confirm, entity, kind, refreshStats, removeItems, selected, toast, toastError]);

  const edit = useCallback((item: ReviewItem) => {
    if (item.entity === 'question') router.push(`/admin/questions/${item.id}?from=review`);
    else if (item.entity === 'edition') router.push(`/admin/concours/${item.familySlug}?edition=${item.id}`);
    else if (item.entity === 'fact') router.push(`/admin/facts?familySlug=${item.familySlug}&kind=fact`);
    else setLessonEdit(item);
  }, [router]);

  // Keyboard shortcuts: J/K navigate, A approve, P approve+publish, R reject, E edit, X select, ? help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase();
      if (k === '?') { setHelp(true); return; }
      if (!items.length) return;
      if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); return; }
      if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); return; }
      if (!current || busy) return;
      if (k === 'a') { e.preventDefault(); void act(current, 'approve'); }
      else if (k === 'p') { e.preventDefault(); void act(current, 'publish'); }
      else if (k === 'r') { e.preventDefault(); void act(current, 'reject'); }
      else if (k === 'e') { e.preventDefault(); edit(current); }
      else if (k === 'x') {
        e.preventDefault();
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(current.id)) n.delete(current.id);
          else n.add(current.id);
          return n;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, current, busy, act, edit]);

  // Keep the current item in view in the list.
  useEffect(() => {
    document.getElementById(`rq-${current?.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [current?.id]);

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const statusOptions = kind === 'fact'
    ? [{ v: '', l: 'À vérifier (tous statuts)' }, ...CONTENT_STATUSES.map((s) => ({ v: s, l: CONTENT_STATUS_LABEL[s] }))]
    : CONTENT_STATUSES.map((s) => ({ v: s, l: CONTENT_STATUS_LABEL[s] }));

  return (
    <AdminPage
      title="File de revue"
      subtitle="Rien n’est publié sans relecture humaine. Les faits non vérifiés restent affichés « À vérifier / للتحقق »."
      actions={<Button size="sm" variant="secondary" onClick={() => setHelp(true)}><Keyboard className="size-4" aria-hidden />Raccourcis</Button>}
    >
      <Tabs tabs={ENTITY_TABS} value={entity} onChange={(v) => { setEntity(v); setStatus(''); }} />

      <FilterBar>
        <FilterField label="Statut" htmlFor="rq-status">
          <Select id="rq-status" value={status || (kind === 'content' ? 'AI_REVIEWED' : '')} onChange={(e) => setStatus(e.target.value)}>
            {statusOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </FilterField>
        {entity !== 'lesson' && (
          <FilterField label="Concours" htmlFor="rq-family">
            <FamilySelect id="rq-family" value={familySlug} onChange={setFamilySlug} />
          </FilterField>
        )}
        {entity === 'question' && (
          <FilterField label="Domaine" htmlFor="rq-domain">
            <Select id="rq-domain" value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">Tous</option>
              {DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABELS[d].fr}</option>)}
            </Select>
          </FilterField>
        )}
        <Button variant="ghost" size="sm" onClick={() => void reload()} className="self-end"><RotateCcw className="size-4" aria-hidden />Recharger</Button>
      </FilterBar>

      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : loading && !data ? <Loading /> : !items.length ? (
        <Empty title="File vide" body={kind === 'fact' ? 'Aucun élément à vérifier avec ces filtres.' : 'Aucun élément dans ce statut. Bravo !'} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-2 text-sm">
            <Checkbox
              checked={allSelected}
              onChange={(v) => setSelected(v ? new Set(items.map((i) => i.id)) : new Set())}
              label={selected.size ? `${selected.size} sélectionné(s)` : `Tout sélectionner (${items.length}${data && data.total > items.length ? ` affichés sur ${data.total}` : ''})`}
            />
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void bulk('approve')}><Check className="size-4" aria-hidden />{ACTION_LABEL[kind].approve}</Button>
                <Button size="sm" disabled={busy} onClick={() => void bulk('publish')}><Send className="size-4" aria-hidden />{ACTION_LABEL[kind].publish}</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void bulk('reject')}><X className="size-4" aria-hidden />{ACTION_LABEL[kind].reject}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void bulk('archive')}><Archive className="size-4" aria-hidden />Archiver</Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
            <ul className="flex max-h-[38vh] flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-surface p-1 lg:max-h-[calc(100dvh-260px)]" aria-label="Éléments à relire">
              {items.map((it, i) => (
                <li key={it.id} id={`rq-${it.id}`} className={clsx('flex items-start gap-2 rounded-lg p-2', i === index ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                  <input
                    type="checkbox"
                    aria-label="Sélectionner"
                    className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                    checked={selected.has(it.id)}
                    onChange={(e) => setSelected((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(it.id);
                      else n.delete(it.id);
                      return n;
                    })}
                  />
                  <button type="button" className="min-w-0 flex-1 text-start" onClick={() => { setIndex(i); detailRef.current?.focus({ preventScroll: true }); }} aria-current={i === index ? 'true' : undefined}>
                    <ItemSummary item={it} />
                  </button>
                </li>
              ))}
            </ul>

            <div ref={detailRef} tabIndex={-1} className="flex min-w-0 flex-col gap-3 outline-none">
              {current && (
                <>
                  <ActionBar item={current} kind={kind} busy={busy} index={index} count={items.length} onAct={(a) => void act(current, a)} onEdit={() => edit(current)} onNav={(d) => setIndex((i) => Math.max(0, Math.min(items.length - 1, i + d)))} />
                  <ItemDetail item={current} />
                </>
              )}
            </div>
          </div>
        </>
      )}

      <Modal open={help} onClose={() => setHelp(false)} title="Raccourcis clavier">
        <ul className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          {[['J / ↓', 'Élément suivant'], ['K / ↑', 'Élément précédent'], ['A', 'Approuver (faits : marquer vérifié)'], ['P', 'Approuver + publier'], ['R', 'Rejeter (motif demandé)'], ['E', 'Modifier dans l’éditeur'], ['X', 'Ajouter / retirer de la sélection'], ['?', 'Cette aide']].map(([k, l]) => (
            <li key={k} className="contents"><kbd className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs">{k}</kbd><span>{l}</span></li>
          ))}
        </ul>
      </Modal>
      <LessonEditModal lesson={lessonEdit} onClose={() => setLessonEdit(null)} onSaved={(l) => { setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === l.id ? l : i)) } : d)); }} />
      {confirm.element}
    </AdminPage>
  );
}

/** After an action, does the item still belong to the current queue (status filter / "to verify")? */
function matchesQueue(item: ReviewItem, entity: ReviewEntity, status: string): boolean {
  if (entity === 'question' || entity === 'lesson') return (item as AdminQuestionDetail | AdminLessonDetail).status === (status || 'AI_REVIEWED');
  if (status) return (entity === 'edition' ? (item as AdminEdition).contentStatus : (item as AdminFact).status) === status;
  return (item as AdminFact | AdminEdition).needsVerification;
}

function ItemSummary({ item }: { item: ReviewItem }) {
  switch (item.entity) {
    case 'question':
      return (
        <span className="flex flex-col gap-1">
          <span className="line-clamp-2 text-sm font-semibold" dir="auto">{item.stem}</span>
          <span className="flex flex-wrap gap-1">
            <Badge tone="neutral">{DOMAIN_LABELS[item.domain]?.fr}</Badge>
            {item.origin === 'AI_GENERATED' && <Badge tone="accent">IA</Badge>}
            {item.stats.openReports > 0 && <Badge tone="danger">{item.stats.openReports} signal.</Badge>}
          </span>
        </span>
      );
    case 'lesson':
      return <span className="flex flex-col gap-1"><span className="line-clamp-2 text-sm font-semibold" dir="auto">{item.title}</span><span className="text-xs text-muted">{item.topic.title_fr}</span></span>;
    case 'fact':
      return (
        <span className="flex flex-col gap-1">
          <span className="line-clamp-2 text-sm font-semibold" dir="auto">{item.display_fr || item.display_ar}</span>
          <span className="text-xs text-muted">{item.familySlug}{item.positionSlug ? ` · ${item.positionSlug}` : ''} · {item.key}</span>
        </span>
      );
    case 'edition':
      return (
        <span className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{item.familyName_fr} {item.year}{item.sessionLabel ? ` — ${item.sessionLabel}` : ''}</span>
          <span className="flex flex-wrap gap-1"><Badge tone="info">{EDITION_STATUS_LABEL[item.status]}</Badge><StatusBadge status={item.contentStatus} /></span>
        </span>
      );
  }
}

function ActionBar({ item, kind, busy, index, count, onAct, onEdit, onNav }: {
  item: ReviewItem; kind: 'content' | 'fact'; busy: boolean; index: number; count: number;
  onAct: (a: ReviewAction) => void; onEdit: () => void; onNav: (d: number) => void;
}) {
  const label = ACTION_LABEL[kind];
  return (
    <div className="sticky top-14 z-10 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface p-2 shadow-sm lg:top-2">
      <span className="me-auto text-xs text-muted tabular-nums">{index + 1} / {count}</span>
      <Button size="sm" variant="ghost" onClick={() => onNav(-1)} disabled={index === 0} aria-label="Précédent (K)">K</Button>
      <Button size="sm" variant="ghost" onClick={() => onNav(1)} disabled={index >= count - 1} aria-label="Suivant (J)">J</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAct('approve')} title="A"><Check className="size-4" aria-hidden />{label.approve} <kbd className="text-xs text-muted">A</kbd></Button>
      <Button size="sm" disabled={busy} onClick={() => onAct('publish')} title="P"><CheckCheck className="size-4" aria-hidden />{label.publish} <kbd className="text-xs opacity-70">P</kbd></Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAct('reject')} title="R"><X className="size-4 text-danger" aria-hidden />{label.reject} <kbd className="text-xs text-muted">R</kbd></Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit} title="E"><Pencil className="size-4" aria-hidden />Modifier <kbd className="text-xs text-muted">E</kbd></Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAct('archive')} aria-label="Archiver"><Archive className="size-4" aria-hidden /></Button>
      {item.entity === 'edition' && (
        <p className="w-full text-xs text-muted">
          <BellRing className="me-1 inline size-3.5 text-primary" aria-hidden />
          Publier une session « Annoncée » ou « Inscriptions ouvertes » déclenche immédiatement les alertes aux candidats dont le profil correspond.
        </p>
      )}
    </div>
  );
}

function ItemDetail({ item }: { item: ReviewItem }) {
  switch (item.entity) {
    case 'question': return <QuestionDetail q={item} />;
    case 'lesson': return <LessonDetail l={item} />;
    case 'fact': return <FactDetail f={item} />;
    case 'edition': return <EditionDetail e={item} />;
  }
}

function QuestionDetail({ q }: { q: AdminQuestionDetail }) {
  return (
    <div className="flex flex-col gap-3">
      <QuestionPreview q={{ ...q, topicLabel: q.topic.title_fr, sourceLabel: q.source?.title ?? null }} />
      {q.lastReview?.comment && (
        <div className={clsx('rounded-xl p-3 text-sm', q.lastReview.toStatus === 'AI_REVIEWED' ? 'bg-info-soft' : 'bg-warning-soft')}>
          <p className="font-semibold">Dernière revue ({CONTENT_STATUS_LABEL[q.lastReview.toStatus as ContentStatus] ?? q.lastReview.toStatus}) · {q.lastReview.reviewer?.name ?? 'automatique'} · {fmtDateTime(q.lastReview.at)}</p>
          <p dir="auto">{q.lastReview.comment}</p>
        </div>
      )}
      <div className="card grid gap-4 p-4 md:grid-cols-2">
        <KV items={[
          ['Statut', <StatusBadge key="s" status={q.status} />],
          ['Thème', <span key="t"><code className="text-xs">{q.topic.key}</code> · {q.topic.title_fr} <span lang="ar" dir="rtl">· {q.topic.title_ar}</span></span>],
          ['Langue', LANGUAGE_LABEL[q.language] ?? q.language],
          ['Origine', ORIGIN_LABEL[q.origin] ?? q.origin],
          ['Modèle IA', q.ai ? `${q.ai.model}${q.ai.promptVersion ? ` (${q.ai.promptVersion})` : ''}` : '—'],
          ['Année', q.year ?? '—'],
          ['Valide jusqu’au', fmtDate(q.validUntil)],
          ['Version', `v${q.version}`],
        ]} />
        <KV items={[
          ['Source', <SourceLink key="src" source={q.source} compact />],
          ['Concours', q.isGeneral ? `Général${q.families.length ? ` + ${q.families.map((f) => f.slug).join(', ')}` : ''}` : q.families.map((f) => f.slug).join(', ') || '—'],
          ['Tags', q.tags.length ? q.tags.join(', ') : '—'],
          ['Stats', q.stats.attempts ? `${q.stats.attempts} réponses · ${fmtPct(q.stats.accuracy)} de réussite` : 'Jamais posée'],
          ['Signalements', q.stats.openReports ? <Link key="r" className="font-semibold text-danger underline" href={`/admin/reports?questionId=${q.id}`}>{q.stats.openReports} ouvert(s)</Link> : '0'],
          ['Créée', `${fmtDateTime(q.createdAt)}${q.createdBy?.name ? ` par ${q.createdBy.name}` : ''}`],
          ['Relue', q.reviewedAt ? `${fmtDateTime(q.reviewedAt)}${q.reviewedBy?.name ? ` par ${q.reviewedBy.name}` : ''}` : '—'],
        ]} />
        {q.objectives.length > 0 && (
          <div className="md:col-span-2">
            <p className="mb-1 text-sm font-semibold">Objectifs</p>
            <ul className="flex flex-col gap-1 text-sm">
              {q.objectives.map((o) => <li key={o.key}><code className="text-xs">{o.key}</code> · {o.text_fr} <span className="text-muted" lang="ar" dir="rtl">· {o.text_ar}</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function LessonDetail({ l }: { l: AdminLessonDetail }) {
  return (
    <article className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={l.status} />
        <Badge tone="neutral">{LANGUAGE_LABEL[l.language] ?? l.language}</Badge>
        <Badge tone="neutral">{l.estMinutes} min</Badge>
        <Badge tone="primary">{l.topic.title_fr}</Badge>
        <Badge tone={l.origin === 'AI_GENERATED' ? 'accent' : 'neutral'}>{ORIGIN_LABEL[l.origin] ?? l.origin}</Badge>
      </div>
      <h3 className="text-lg font-bold" dir="auto">{l.title}</h3>
      <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm leading-relaxed" dir="auto">{l.bodyMd}</div>
      {l.lastReview?.comment && <p className="text-sm text-muted" dir="auto">Dernière revue : {l.lastReview.comment}</p>}
    </article>
  );
}

function FactDetail({ f }: { f: AdminFact }) {
  return (
    <article className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-1.5">
        <VerifyBadge needsVerification={f.needsVerification} />
        <StatusBadge status={f.status} />
        <ConfidenceBadge c={f.confidence} />
        <Badge tone="neutral">{f.key}</Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div><p className="text-xs text-muted">Français</p><p className="font-semibold">{f.display_fr}</p>{f.details_fr && <p className="text-sm text-muted">{f.details_fr}</p>}</div>
        <div lang="ar" dir="rtl"><p className="text-xs text-muted">العربية</p><p className="font-semibold">{f.display_ar}</p>{f.details_ar && <p className="text-sm text-muted">{f.details_ar}</p>}</div>
      </div>
      {f.value !== null && f.value !== undefined && <div><p className="text-xs font-semibold text-muted">Valeur</p><JsonBlock value={f.value} /></div>}
      <KV items={[
        ['Concours', <Link key="c" className="underline" href={`/admin/concours/${f.familySlug}`}>{f.familyName_fr}</Link>],
        ['Poste', f.positionSlug ?? 'Tous les postes'],
        ['Source', <SourceLink key="s" source={f.source} />],
        ['Page', f.sourcePage ?? '—'],
        ['Vérifié le', fmtDate(f.lastVerifiedAt)],
      ]} />
      {f.sourceQuote
        ? <blockquote className="border-s-4 border-primary bg-surface-2 p-3 text-sm italic" dir="auto">« {f.sourceQuote} »</blockquote>
        : <p className="text-sm text-warning">Aucune citation de la source : ajoutez-la depuis « Faits à vérifier » avant de valider.</p>}
      {!f.source && <p className="text-sm font-semibold text-danger">Sans source, ce fait ne peut pas être marqué vérifié.</p>}
    </article>
  );
}

function EditionDetail({ e }: { e: AdminEdition }) {
  const href = safeHref(e.announcementUrl);
  return (
    <article className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-1.5">
        <VerifyBadge needsVerification={e.needsVerification} />
        <StatusBadge status={e.contentStatus} />
        <Badge tone="info">{EDITION_STATUS_LABEL[e.status]}</Badge>
        {e.effectiveStatus !== e.status && <Badge tone="neutral">Effectif : {EDITION_STATUS_LABEL[e.effectiveStatus]}</Badge>}
        <ConfidenceBadge c={e.confidence} />
      </div>
      <h3 className="text-lg font-bold">{e.familyName_fr} — {e.year}{e.sessionLabel ? ` (${e.sessionLabel})` : ''} <span className="text-base font-semibold text-muted" lang="ar" dir="rtl">{e.familyName_ar}</span></h3>
      <KV items={[
        ['Ouverture inscriptions', fmtDate(e.registrationOpen)],
        ['Date limite', fmtDate(e.registrationDeadline)],
        ['Examen', fmtDate(e.examDate)],
        ['Postes ouverts', e.positionsCount ?? '—'],
        ['Postes ciblés', e.positionSlugs.length ? e.positionSlugs.join(', ') : 'Tous les postes du concours'],
        ['Avis', href ? <a key="a" href={href} target="_blank" rel="noopener noreferrer" className="underline">{truncate(href, 60)}</a> : '—'],
        ['Source', <SourceLink key="s" source={e.source} />],
      ]} />
      <div className={clsx('rounded-xl p-3 text-sm', e.alerts.announceable ? 'bg-success-soft' : 'bg-surface-2')}>
        <p className="flex items-center gap-1.5 font-semibold"><BellRing className="size-4" aria-hidden />Alertes candidats</p>
        {e.alerts.sentAt
          ? <p>Envoyées le {fmtDateTime(e.alerts.sentAt)} : {e.alerts.matchedUsers} correspondant(s), {e.alerts.notifiedUsers} notifié(s).</p>
          : e.alerts.announceable
            ? <p>Prête : les candidats correspondants seront notifiés (tâche horaire ou bouton « Notifier » dans la fiche concours).</p>
            : <p>Pas encore d’alerte : {ANNOUNCE_BLOCK_LABEL[e.alerts.blockedBy ?? ''] ?? e.alerts.blockedBy}.</p>}
      </div>
      <Link href={`/admin/concours/${e.familySlug}?edition=${e.id}`} className="self-start text-sm font-semibold text-primary underline">Ouvrir dans la fiche concours</Link>
    </article>
  );
}

function LessonEditModal({ lesson, onClose, onSaved }: { lesson: AdminLessonDetail | null; onClose: () => void; onSaved: (l: AdminLessonDetail) => void }) {
  const { toast, toastError } = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!lesson) return;
    setTitle(lesson.title);
    setBody(lesson.bodyMd);
    setMinutes(lesson.estMinutes);
  }, [lesson]);
  async function save(publish: boolean) {
    if (!lesson) return;
    setBusy(true);
    try {
      const r = await api<AdminLessonDetail>(`/admin/lessons/${lesson.id}${publish ? '?publish=true' : ''}`, { method: 'PATCH', body: { title, bodyMd: body, estMinutes: minutes } });
      toast({ tone: 'success', title: publish ? 'Leçon enregistrée et publiée' : 'Leçon enregistrée (relue)' });
      onSaved(r);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!lesson} onClose={onClose} title="Modifier la leçon">
      <div className="flex flex-col gap-3">
        <Field label="Titre" htmlFor="ls-title"><Input id="ls-title" value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" /></Field>
        <Field label="Durée estimée (min)" htmlFor="ls-min"><Input id="ls-min" type="number" min={1} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} /></Field>
        <Field label="Contenu (Markdown)" htmlFor="ls-body" hint="Enregistrer fait de vous le relecteur humain (statut « Relu »).">
          <Textarea id="ls-body" rows={14} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" className="font-mono text-sm" />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="secondary" loading={busy} onClick={() => void save(false)}>Enregistrer</Button>
          <Button loading={busy} onClick={() => void save(true)}>Enregistrer + publier</Button>
        </div>
      </div>
    </Modal>
  );
}

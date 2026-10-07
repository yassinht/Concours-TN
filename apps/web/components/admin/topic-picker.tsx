'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Domain, SyllabusNodeDTO } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Badge, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useDebounced } from './hooks';
import { Checkbox, ListInput } from './ui';

interface TopicHit { key: string; title_ar: string; title_fr: string; domain: Domain }
export interface TopicInfo { key: string; title_ar: string; title_fr: string; domain: Domain; level: string; objectives: { key: string; text_ar: string; text_fr: string; nodeKey: string }[] }

/** Topic + objectives of a syllabus key (public catalog: the topic itself and its direct children). */
export async function loadTopic(key: string): Promise<TopicInfo | null> {
  try {
    const r = await api<{ topic: SyllabusNodeDTO }>(`/catalog/lessons/${encodeURIComponent(key)}`);
    const t = r.topic;
    const objectives = [
      ...t.objectives.map((o) => ({ ...o, nodeKey: t.key })),
      ...(t.children ?? []).flatMap((c) => c.objectives.map((o) => ({ ...o, nodeKey: c.key }))),
    ];
    return { key: t.key, title_ar: t.title_ar, title_fr: t.title_fr, domain: t.domain, level: t.level, objectives };
  } catch {
    return null;
  }
}

/** Search box over syllabus topics (/catalog/search) that resolves the chosen key. */
export function TopicSearch({ id, value, onPick, placeholder }: { id: string; value: string; onPick: (key: string, hit?: TopicHit) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [hits, setHits] = useState<TopicHit[]>([]);
  const [open, setOpen] = useState(false);
  const dq = useDebounced(text.trim(), 250);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (dq.length < 2 || dq === value) {
      setHits([]);
      return;
    }
    let alive = true;
    api<{ topics: TopicHit[] }>(`/catalog/search?q=${encodeURIComponent(dq)}`)
      .then((r) => alive && setHits(r.topics))
      .catch(() => alive && setHits([]));
    return () => {
      alive = false;
    };
  }, [dq, value]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        id={id}
        value={text}
        placeholder={placeholder ?? 'Rechercher un thème (titre ou clé)…'}
        className="ps-9"
        dir="auto"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={`${id}-list`}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const exact = hits.find((h) => h.key === text.trim());
            onPick(text.trim(), exact);
            setOpen(false);
          }
        }}
      />
      {open && hits.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg">
          {hits.map((h) => (
            <li key={h.key} role="option" aria-selected={h.key === value}>
              <button type="button" className="flex w-full flex-col items-start rounded-lg p-2 text-start hover:bg-surface-2" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(h.key, h); setText(h.key); setOpen(false); }}>
                <span className="text-sm font-semibold">{h.title_fr} <span className="font-normal text-muted" lang="ar" dir="rtl">· {h.title_ar}</span></span>
                <span className="text-xs text-muted"><code>{h.key}</code> · {DOMAIN_LABELS[h.domain]?.fr}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Topic picker + objectives checklist (objectives of the topic and its sub-topics; other keys typed by hand). */
export function TopicObjectivesEditor({ topicKey, objectiveKeys, onTopic, onObjectives, onTopicLoaded }: {
  topicKey: string; objectiveKeys: string[];
  onTopic: (key: string) => void; onObjectives: (keys: string[]) => void; onTopicLoaded?: (t: TopicInfo | null) => void;
}) {
  const [topic, setTopic] = useState<TopicInfo | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'missing'>('idle');

  useEffect(() => {
    if (!topicKey) {
      setTopic(null);
      setState('idle');
      return;
    }
    let alive = true;
    setState('loading');
    void loadTopic(topicKey).then((t) => {
      if (!alive) return;
      setTopic(t);
      setState(t ? 'idle' : 'missing');
      onTopicLoaded?.(t);
    });
    return () => {
      alive = false;
    };
    // onTopicLoaded is a callback prop: only the key should trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey]);

  const known = useMemo(() => new Set(topic?.objectives.map((o) => o.key) ?? []), [topic]);
  const extra = objectiveKeys.filter((k) => !known.has(k));
  const toggle = (key: string, on: boolean) => onObjectives(on ? [...new Set([...objectiveKeys, key])] : objectiveKeys.filter((k) => k !== key));

  return (
    <div className="flex flex-col gap-3">
      <TopicSearch id="q-topic" value={topicKey} onPick={(k) => onTopic(k)} />
      {state === 'loading' && <p className="text-xs text-muted">Chargement du thème…</p>}
      {state === 'missing' && <p className="text-xs text-warning">Thème introuvable dans le programme publié : vérifiez la clé (les objectifs se saisissent alors à la main).</p>}
      {topic && (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
          <p className="text-sm">
            <span className="font-semibold">{topic.title_fr}</span> <span className="text-muted" lang="ar" dir="rtl">· {topic.title_ar}</span>
            <span className="ms-2 inline-flex gap-1"><Badge tone="neutral">{DOMAIN_LABELS[topic.domain]?.fr}</Badge><Badge tone={topic.level === 'TOPIC' ? 'primary' : 'warning'}>{topic.level}</Badge></span>
          </p>
          {topic.objectives.length ? (
            <fieldset className="flex flex-col gap-0.5">
              <legend className="mb-1 text-xs font-semibold text-muted">Objectifs pédagogiques (au moins un)</legend>
              {topic.objectives.map((o) => (
                <Checkbox
                  key={o.key}
                  checked={objectiveKeys.includes(o.key)}
                  onChange={(v) => toggle(o.key, v)}
                  label={<span><code className="text-xs">{o.key}</code> · {o.text_fr} <span className="text-muted" lang="ar" dir="rtl">· {o.text_ar}</span></span>}
                />
              ))}
            </fieldset>
          ) : <p className="text-xs text-muted">Ce thème n’a pas d’objectif listé : saisissez une clé d’objectif d’un thème parent.</p>}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="q-obj-extra" className="text-xs font-semibold text-muted">Autres clés d’objectifs (thème parent, une par ligne)</label>
        <ListInput id="q-obj-extra" value={extra} dir="ltr" onChange={(list) => onObjectives([...objectiveKeys.filter((k) => known.has(k)), ...list])} placeholder="cg.histoire.obj1" />
      </div>
      {objectiveKeys.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {objectiveKeys.map((k) => (
            <span key={k} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', known.has(k) ? 'bg-primary-soft text-primary' : 'bg-surface-2')}>
              <code>{k}</code>
              <button type="button" onClick={() => toggle(k, false)} aria-label={`Retirer ${k}`} className="rounded-full hover:text-danger"><X className="size-3" aria-hidden /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

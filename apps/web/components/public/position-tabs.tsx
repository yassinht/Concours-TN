'use client';

import clsx from 'clsx';
import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '@/components/providers';

/**
 * Tabs over server-rendered panels. Inactive panels use hidden="until-found" so find-in-page and
 * text-fragment links still reach them (the `beforematch` event switches to the matching tab).
 */
export function PositionTabs({ tabs, panels }: { tabs: { key: string; label: string }[]; panels: ReactNode[] }) {
  const tr = useT();
  const id = useId();
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const rtl = document.documentElement.dir === 'rtl';
    const next = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const i = e.key === 'Home' ? 0 : tabs.length - 1;
      setActive(i);
      tabRefs.current[i]?.focus();
      return;
    }
    if (!next) return;
    e.preventDefault();
    const i = (active + next + tabs.length) % tabs.length;
    setActive(i);
    tabRefs.current[i]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold text-muted" id={`${id}-label`}>{tr({ ar: 'اختر الرتبة', fr: 'Choisissez le grade' })}</p>
        <div role="tablist" aria-labelledby={`${id}-label`} onKeyDown={onKey} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {tabs.map((tab, i) => (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${id}-tab-${i}`}
              aria-selected={i === active}
              aria-controls={`${id}-panel-${i}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              className={clsx(
                'min-h-11 shrink-0 whitespace-nowrap rounded-xl border px-4 text-sm font-semibold transition',
                i === active ? 'border-primary bg-primary text-primary-contrast' : 'border-border bg-surface hover:bg-surface-2',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {panels.map((panel, i) => (
        <Panel key={tabs[i]?.key ?? i} id={`${id}-panel-${i}`} labelledBy={`${id}-tab-${i}`} active={i === active} onMatch={() => setActive(i)}>
          {panel}
        </Panel>
      ))}
    </div>
  );
}

function Panel({ id, labelledBy, active, onMatch, children }: { id: string; labelledBy: string; active: boolean; onMatch: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const match = useCallback(() => onMatch(), [onMatch]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React only knows boolean `hidden`; upgrade it to until-found after each commit.
    if (!active) el.setAttribute('hidden', 'until-found');
    el.addEventListener('beforematch', match);
    return () => el.removeEventListener('beforematch', match);
  }, [active, match]);
  return (
    <div ref={ref} id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={!active} tabIndex={0} className="outline-none">
      {children}
    </div>
  );
}

'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Domain } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { ProgressBar, scoreTone } from '@/components/ui';
import { useT } from '@/components/providers';

const TONE_TEXT = { danger: 'text-danger', warning: 'text-warning', success: 'text-success', primary: 'text-primary', accent: 'text-accent', info: 'text-info' } as const;

/** Circular score (0..100) with the value in the middle. Colour follows scoreTone; the number is always printed. */
export function ScoreRing({ value, size = 132, label, sub, tone }: { value: number; size?: number; label: string; sub?: ReactNode; tone?: keyof typeof TONE_TEXT }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const stroke = Math.max(8, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const t = tone ?? scoreTone(v);
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${v}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-2" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke="currentColor" className={clsx(TONE_TEXT[t], 'transition-[stroke-dashoffset] duration-700')}
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden>
        <span className="text-3xl font-extrabold tabular-nums" dir="ltr">{v}%</span>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
    </div>
  );
}

/** Small line chart of a 0..max series (readiness history, physical tests). Always left→right in time, whatever the page direction. */
export function Sparkline({ values, max, min, height = 48, width = 220, label, className, invert }: {
  values: number[]; max?: number; min?: number; height?: number; width?: number; label: string; className?: string; invert?: boolean;
}) {
  if (values.length === 0) return null;
  const hi = max ?? Math.max(...values);
  const lo = min ?? Math.min(...values);
  const span = hi - lo || 1;
  const pad = 4;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const y = (v: number) => {
    const n = (v - lo) / span;
    return pad + (invert ? n : 1 - n) * (height - pad * 2);
  };
  const pts = values.map((v, i) => `${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const last = values[values.length - 1];
  const area = `${pad},${height - pad} ${pts.join(' ')} ${(pad + (values.length - 1) * step).toFixed(1)},${height - pad}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={clsx('h-12 w-full text-primary', className)} role="img" aria-label={label} preserveAspectRatio="none" style={{ direction: 'ltr' }}>
      <polygon points={area} fill="currentColor" opacity={0.12} />
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {values.length === 1 ? <circle cx={pad} cy={y(last)} r={3} fill="currentColor" /> : <circle cx={pad + (values.length - 1) * step} cy={y(last)} r={3} fill="currentColor" />}
    </svg>
  );
}

/** Daily activity bars (answered, with the correct share filled). Oldest left. */
export function ActivityBars({ days, label }: { days: { date: string; answered: number; correct: number }[]; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.answered));
  const w = 8;
  const gap = 3;
  const h = 64;
  const width = days.length * (w + gap);
  return (
    <svg viewBox={`0 0 ${width} ${h}`} className="h-20 w-full" role="img" aria-label={label} preserveAspectRatio="none" style={{ direction: 'ltr' }}>
      {days.map((d, i) => {
        const bh = d.answered ? Math.max(3, (d.answered / max) * (h - 2)) : 2;
        const ch = d.answered ? (d.correct / d.answered) * bh : 0;
        const x = i * (w + gap);
        return (
          <g key={d.date}>
            <title>{`${d.date}: ${d.correct}/${d.answered}`}</title>
            <rect x={x} y={h - bh} width={w} height={bh} rx={2} className={d.answered ? 'fill-primary-soft' : 'fill-surface-2'} />
            {ch > 0 && <rect x={x} y={h - ch} width={w} height={ch} rx={2} className="fill-primary" />}
          </g>
        );
      })}
    </svg>
  );
}

/** One labelled bar per domain (score 0..100), coloured by scoreTone with the percentage printed. */
export function DomainBars({ rows }: { rows: { domain: Domain; score: number; detail?: ReactNode }[] }) {
  const tr = useT();
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.domain} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">{tr(DOMAIN_LABELS[r.domain])}</span>
            <span className="tabular-nums text-muted">{r.detail ?? null} <span className={clsx('font-bold', TONE_TEXT[scoreTone(r.score)])} dir="ltr">{Math.round(r.score)}%</span></span>
          </div>
          <ProgressBar value={r.score} tone={scoreTone(r.score)} label={tr(DOMAIN_LABELS[r.domain])} />
        </li>
      ))}
    </ul>
  );
}

/** Mastery (0..1 or null) as a thin bar with a text level, so colour is never the only signal. */
export function MasteryMeter({ mastery, compact }: { mastery: number | null | undefined; compact?: boolean }) {
  const tr = useT();
  if (mastery == null) {
    return <span className="text-xs text-muted">{tr({ ar: 'لم تتدرب بعد', fr: 'Pas encore travaillé' })}</span>;
  }
  const v = Math.round(mastery * 100);
  const tone = scoreTone(v);
  const level = v >= 65 ? { ar: 'متمكّن', fr: 'Maîtrisé' } : v >= 45 ? { ar: 'في تقدّم', fr: 'En progrès' } : { ar: 'ضعيف', fr: 'Fragile' };
  return (
    <div className={clsx('flex items-center gap-2', compact ? 'w-28' : 'w-full')}>
      <ProgressBar value={v} tone={tone} className="h-1.5 flex-1" label={tr({ ar: 'درجة التمكن', fr: 'Maîtrise' })} />
      <span className={clsx('shrink-0 text-xs font-semibold tabular-nums', TONE_TEXT[tone])}>
        <span dir="ltr">{v}%</span>{!compact && <> · {tr(level)}</>}
      </span>
    </div>
  );
}

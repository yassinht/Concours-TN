import { BookOpen } from 'lucide-react';
import type { Locale, SyllabusNodeDTO } from '@ctn/shared';
import { Badge, ProgressBar, scoreTone } from '@/components/ui';
import { t } from '@/lib/i18n';
import { DOMAIN_LABELS, SCOPE_LABELS, countLabel, loc } from './labels';
import { Disclosure } from './sections';

function MasteryBar({ locale, value }: { locale: Locale; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="flex w-28 shrink-0 items-center gap-2">
      <ProgressBar value={pct} tone={scoreTone(pct)} label={t(locale, { ar: 'نسبة الإتقان', fr: 'Maîtrise' })} />
      <span className="text-xs tabular-nums text-muted">{pct}%</span>
    </span>
  );
}

function NodeLine({ locale, node, depth }: { locale: Locale; node: SyllabusNodeDTO; depth: number }) {
  const scope = SCOPE_LABELS[node.scope];
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={depth === 0 ? 'font-semibold text-text' : 'text-text'}>{loc(locale, node, 'title')}</span>
        {node.hasLesson && (
          <span className="inline-flex items-center gap-1 text-xs text-primary"><BookOpen className="size-3.5" aria-hidden />{t(locale, { ar: 'درس', fr: 'Leçon' })}</span>
        )}
        {node.scope === 'SUGGESTED' && <Badge tone={scope.tone}>{t(locale, scope)}</Badge>}
        {node.questionCount > 0 && <span className="text-xs text-muted">{countLabel(locale, node.questionCount, 'question')}</span>}
        {node.mastery != null && <MasteryBar locale={locale} value={node.mastery} />}
      </div>
      {node.children && node.children.length > 0 && depth < 2 && (
        <ul className="flex flex-col gap-1.5 border-s border-border ps-4 text-sm">
          {node.children.map((c) => <NodeLine key={c.key} locale={locale} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

/** Collapsible programme outline: subjects → units → topics, with scope (official / inferred / suggested) per subject. */
export function SyllabusOutline({ locale, nodes }: { locale: Locale; nodes: SyllabusNodeDTO[] }) {
  return (
    <div className="flex flex-col gap-2">
      {nodes.map((s) => {
        const scope = SCOPE_LABELS[s.scope];
        return (
          <Disclosure
            key={s.key}
            summary={
              <span className="flex flex-wrap items-center gap-2">
                <span>{loc(locale, s, 'title')}</span>
                <Badge tone={scope.tone}>{t(locale, scope)}</Badge>
                <span className="text-xs font-normal text-muted">{t(locale, DOMAIN_LABELS[s.domain])} · {countLabel(locale, s.questionCount, 'question')}</span>
                {s.mastery != null && <MasteryBar locale={locale} value={s.mastery} />}
              </span>
            }
          >
            {s.children && s.children.length > 0 ? (
              <ul className="flex flex-col gap-2.5 pt-1">
                {s.children.map((c) => <NodeLine key={c.key} locale={locale} node={c} depth={0} />)}
              </ul>
            ) : s.objectives.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
                {s.objectives.map((o) => <li key={o.key}>{loc(locale, o, 'text')}</li>)}
              </ul>
            ) : (
              <p className="text-sm">{t(locale, { ar: 'التفاصيل قيد الإعداد.', fr: 'Détails en préparation.' })}</p>
            )}
            {s.source && (
              <p className="mt-3 text-xs">
                {t(locale, { ar: 'المصدر', fr: 'Source' })}:{' '}
                {s.source.url ? <a href={s.source.url} target="_blank" rel="noopener noreferrer" className="underline">{s.source.title}</a> : s.source.title}
              </p>
            )}
          </Disclosure>
        );
      })}
    </div>
  );
}

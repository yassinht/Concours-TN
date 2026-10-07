'use client';

import { BadgeCheck, CircleHelp, ExternalLink, Newspaper, Users } from 'lucide-react';
import type { Provenance } from '@ctn/shared';
import { formatDate } from '@/lib/i18n';
import { useLocale, useT } from '@/components/providers';
import { Badge } from './index';

/**
 * Trust badge shown next to every fact about a concours.
 * 🟢 official & verified · 🟡 secondary · ⚪ community · ❔ suggestion to verify
 */
export function ProvenanceBadge({ p, compact }: { p: Provenance; compact?: boolean }) {
  const tr = useT();
  const { locale } = useLocale();
  const st = p.source?.sourceType;
  let badge;
  if (p.needsVerification || !p.source || st === 'SUGGESTED') {
    badge = <Badge tone="warning" title={tr({ ar: 'معلومة مقترحة لم يتم التحقق منها رسميًا بعد', fr: 'Information suggérée, pas encore vérifiée officiellement' })}><CircleHelp className="size-3.5" />{tr({ ar: 'للتحقق', fr: 'À vérifier' })}</Badge>;
  } else if (st === 'OFFICIAL') {
    badge = <Badge tone="success"><BadgeCheck className="size-3.5" />{tr({ ar: 'رسمي', fr: 'Officiel' })}</Badge>;
  } else if (st === 'SECONDARY') {
    badge = <Badge tone="info"><Newspaper className="size-3.5" />{tr({ ar: 'مصدر ثانوي', fr: 'Source secondaire' })}</Badge>;
  } else {
    badge = <Badge tone="neutral"><Users className="size-3.5" />{tr({ ar: 'تجارب مترشحين', fr: 'Communauté' })}</Badge>;
  }
  if (compact || !p.source) return badge;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted">
      {badge}
      {p.source.url ? (
        <a href={p.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-text">
          {p.source.title}<ExternalLink className="size-3" />
        </a>
      ) : <span>{p.source.title}</span>}
      {p.lastVerifiedAt && <span>· {tr({ ar: 'آخر تحقق', fr: 'Vérifié le' })} {formatDate(locale, p.lastVerifiedAt)}</span>}
    </span>
  );
}

'use client';

import clsx from 'clsx';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { BookOpen, CalendarClock, ClipboardCheck, Crown, ExternalLink, Flame, Info, Megaphone, Radar } from 'lucide-react';
import type { NotificationDTO, NotificationType } from '@ctn/shared';
import { useLocale, useT } from '@/components/providers';
import type { Bi } from '@/lib/i18n';
import { linkTarget, relativeTime } from './format';

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

export const NOTIFICATION_META: Record<NotificationType, { icon: Icon; cls: string; label: Bi }> = {
  CONCOURS_MATCH: { icon: Radar, cls: 'bg-primary-soft text-primary', label: { ar: 'مناظرة تناسبك', fr: 'Concours pour vous' } },
  CONCOURS_UPDATE: { icon: Megaphone, cls: 'bg-info-soft text-info', label: { ar: 'تحديث مناظرة', fr: 'Mise à jour' } },
  DEADLINE_REMINDER: { icon: CalendarClock, cls: 'bg-warning-soft text-warning', label: { ar: 'تذكير بآخر أجل', fr: 'Rappel de clôture' } },
  EXAM_REMINDER: { icon: ClipboardCheck, cls: 'bg-accent-soft text-accent', label: { ar: 'تذكير بالامتحان', fr: 'Rappel d’examen' } },
  STUDY_REMINDER: { icon: BookOpen, cls: 'bg-primary-soft text-primary', label: { ar: 'تذكير بالمراجعة', fr: 'Rappel de révision' } },
  STREAK_AT_RISK: { icon: Flame, cls: 'bg-accent-soft text-accent', label: { ar: 'سلسلتك في خطر', fr: 'Série en danger' } },
  SUBSCRIPTION: { icon: Crown, cls: 'bg-warning-soft text-warning', label: { ar: 'الاشتراك', fr: 'Abonnement' } },
  SYSTEM: { icon: Info, cls: 'bg-surface-2 text-muted', label: { ar: 'معلومة', fr: 'Information' } },
};

export function NotificationIcon({ type, className }: { type: NotificationType; className?: string }) {
  const meta = NOTIFICATION_META[type] ?? NOTIFICATION_META.SYSTEM;
  const Icon = meta.icon;
  return (
    <span className={clsx('inline-flex size-10 shrink-0 items-center justify-center rounded-full', meta.cls, className)}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

/** One inbox row: unread dot + bold title, relative time; opening it marks it read and follows its link. */
export function NotificationRow({ n, onOpen, compact }: { n: NotificationDTO; onOpen: (n: NotificationDTO) => void; compact?: boolean }) {
  const tr = useT();
  const { locale } = useLocale();
  const meta = NOTIFICATION_META[n.type] ?? NOTIFICATION_META.SYSTEM;
  const unread = !n.readAt;
  const target = linkTarget(n.url);
  const body = (
    <>
      <NotificationIcon type={n.type} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-xs text-muted">
          <span>{tr(meta.label)}</span>
          <span aria-hidden>·</span>
          <time dateTime={n.createdAt}>{relativeTime(locale, n.createdAt)}</time>
          {unread && <span className="sr-only">{tr({ ar: '(غير مقروء)', fr: '(non lu)' })}</span>}
        </span>
        <span className={clsx('leading-snug', unread ? 'font-bold' : 'font-semibold text-text/90')} dir="auto">{n.title}</span>
        {n.body && <span className={clsx('whitespace-pre-line text-sm text-muted', compact && 'line-clamp-2')} dir="auto">{n.body}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-center gap-2 pt-1">
        {unread && <span className="size-2.5 rounded-full bg-accent" aria-hidden />}
        {target?.external && <ExternalLink className="size-4 text-muted" aria-hidden />}
      </span>
    </>
  );
  const cls = clsx('flex w-full items-start gap-3 rounded-xl p-3 text-start transition hover:bg-surface-2', unread && 'bg-primary-soft/40');
  if (target && !target.external) {
    return <Link href={target.href} onClick={() => onOpen(n)} className={cls}>{body}</Link>;
  }
  if (target?.external) {
    return <a href={target.href} target="_blank" rel="noopener noreferrer" onClick={() => onOpen(n)} className={cls}>{body}</a>;
  }
  return <button type="button" onClick={() => onOpen(n)} className={cls}>{body}</button>;
}

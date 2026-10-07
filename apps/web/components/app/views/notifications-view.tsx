'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BellOff, CheckCheck, Settings2 } from 'lucide-react';
import type { NotificationDTO, NotificationType } from '@ctn/shared';
import { Button, EmptyState, Tabs } from '@/components/ui';
import { useT } from '@/components/providers';
import { api } from '@/lib/api';
import type { Bi } from '@/lib/i18n';
import { ErrorState, PageHeader, Skeleton } from '../bits';
import { tunisToday } from '../format';
import { NotificationRow } from '../notifications';
import { useShell } from '../shell';

const PAGE = 30;
type Filter = 'all' | 'unread' | 'concours';
const CONCOURS_TYPES: NotificationType[] = ['CONCOURS_MATCH', 'CONCOURS_UPDATE', 'DEADLINE_REMINDER', 'EXAM_REMINDER'];

function dayKey(iso: string): string {
  return tunisToday(new Date(iso));
}

function dayLabel(key: string, today: string): Bi {
  if (key === today) return { ar: 'اليوم', fr: 'Aujourd’hui' };
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (key === y.toISOString().slice(0, 10)) return { ar: 'أمس', fr: 'Hier' };
  const d = new Date(`${key}T12:00:00Z`);
  return {
    ar: new Intl.DateTimeFormat('ar-TN-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }).format(d),
    fr: new Intl.DateTimeFormat('fr-TN', { weekday: 'long', day: 'numeric', month: 'long' }).format(d),
  };
}

export function NotificationsView() {
  const tr = useT();
  const { setUnread } = useShell();
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async (before?: string) => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (before) q.set('before', before);
    const r = await api<{ items: NotificationDTO[]; unread: number }>(`/me/notifications?${q}`);
    setUnread(r.unread);
    setHasMore(r.items.length === PAGE);
    return r.items;
  }, [setUnread]);

  const initial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await load());
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void initial();
  }, [initial]);

  async function more() {
    const last = items.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await load(last.createdAt);
      setItems((prev) => [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]);
    } catch (e) {
      setError(e);
    } finally {
      setLoadingMore(false);
    }
  }

  function open(n: NotificationDTO) {
    if (n.readAt) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: now } : x)));
    setUnread((u) => u - 1);
    api(`/me/notifications/${n.id}/read`, { method: 'POST', body: {} }).catch(() => {});
  }

  async function markAll() {
    setMarkingAll(true);
    try {
      await api('/me/notifications/read-all', { method: 'POST', body: {} });
      const now = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })));
      setUnread(0);
    } catch (e) {
      setError(e);
    } finally {
      setMarkingAll(false);
    }
  }

  const visible = useMemo(
    () => items.filter((n) => (filter === 'unread' ? !n.readAt : filter === 'concours' ? CONCOURS_TYPES.includes(n.type) : true)),
    [items, filter],
  );
  const groups = useMemo(() => {
    const out: { key: string; items: NotificationDTO[] }[] = [];
    for (const n of visible) {
      const k = dayKey(n.createdAt);
      const g = out.at(-1);
      if (g && g.key === k) g.items.push(n);
      else out.push({ key: k, items: [n] });
    }
    return out;
  }, [visible]);
  const unreadCount = items.filter((n) => !n.readAt).length;
  const today = tunisToday();

  return (
    <>
      <PageHeader
        title={tr({ ar: 'الإشعارات', fr: 'Notifications' })}
        actions={
          <>
            {unreadCount > 0 && (
              <Button size="sm" variant="secondary" onClick={markAll} loading={markingAll} className="min-h-11">
                <CheckCheck className="size-4" aria-hidden />
                {tr({ ar: 'تعليم الكل كمقروء', fr: 'Tout marquer comme lu' })}
              </Button>
            )}
            <Link href="/app/profile#alerts" className="inline-flex size-11 items-center justify-center rounded-xl border border-border hover:bg-surface-2" aria-label={tr({ ar: 'إعدادات التنبيهات', fr: 'Réglages des alertes' })}>
              <Settings2 className="size-5" aria-hidden />
            </Link>
          </>
        }
      />

      <div className="mb-3">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'all', label: tr({ ar: 'الكل', fr: 'Toutes' }) },
            { value: 'unread', label: `${tr({ ar: 'غير مقروءة', fr: 'Non lues' })}${unreadCount ? ` (${unreadCount})` : ''}` },
            { value: 'concours', label: tr({ ar: 'المناظرات', fr: 'Concours' }) },
          ]}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : error && items.length === 0 ? (
        <ErrorState error={error} onRetry={initial} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<BellOff className="size-8" aria-hidden />}
          title={filter === 'unread' ? tr({ ar: 'لا إشعارات غير مقروءة', fr: 'Aucune notification non lue' }) : tr({ ar: 'لا إشعارات بعد', fr: 'Pas encore de notification' })}
          body={tr({
            ar: 'ستجد هنا تنبيهات المناظرات التي تناسب ملفك، تذكيرات آخر أجل للترشح وتذكيرات المراجعة.',
            fr: 'Vous trouverez ici les concours qui correspondent à votre profil, les rappels de clôture et de révision.',
          })}
          action={<Link href="/app/alerts" className="font-semibold text-primary underline">{tr({ ar: 'المناظرات التي تناسبني', fr: 'Concours pour moi' })}</Link>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`day-${g.key}`}>
              <h2 id={`day-${g.key}`} className="mb-1 px-1 text-xs font-bold uppercase text-muted">{tr(dayLabel(g.key, today))}</h2>
              <ul className="card divide-y divide-border p-1">
                {g.items.map((n) => (
                  <li key={n.id}><NotificationRow n={n} onOpen={open} /></li>
                ))}
              </ul>
            </section>
          ))}
          {hasMore && (
            <Button variant="secondary" onClick={more} loading={loadingMore} className="self-center">
              {tr({ ar: 'عرض المزيد', fr: 'Afficher plus' })}
            </Button>
          )}
          {error != null && <ErrorState error={error} />}
        </div>
      )}
    </>
  );
}

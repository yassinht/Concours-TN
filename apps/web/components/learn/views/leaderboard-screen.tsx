'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { CalendarCheck, Crown, Medal, Trophy, UserPlus } from 'lucide-react';
import type { LeaderboardDTO } from '@ctn/shared';
import { Alert, ButtonLink, Card, EmptyState, Select, Tabs } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { ErrorState, PageHeader, Skeleton } from '@/components/app/bits';
import { bi } from '@/components/app/format';
import { useEnrollments, useSessionApi } from '../hooks';

type Period = 'week' | 'all';
const ALL = '__all__';

/** /app/leaderboard: weekly XP ranking for the primary concours (consistency is what is rewarded). */
export function LeaderboardScreen() {
  const tr = useT();
  const { locale } = useLocale();
  const { me } = useSession();
  const enr = useEnrollments();
  const [period, setPeriod] = useState<Period>('week');
  const [picked, setPicked] = useState<string | null>(null);
  const family = picked ?? enr.primary?.familySlug ?? (enr.data ? ALL : null);
  const qs = family && family !== ALL ? `familySlug=${encodeURIComponent(family)}&` : '';
  const board = useSessionApi<LeaderboardDTO>(family ? `/leaderboard?${qs}period=${period}` : null);
  const meInTop = board.data?.top.some((r) => r.isMe);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/app/progress"
        title={tr({ ar: 'الترتيب', fr: 'Classement' })}
        subtitle={tr({ ar: 'الترتيب يكافئ المواظبة: كل سؤال تجيب عنه يوميًا يمنحك نقاط خبرة.', fr: 'Le classement récompense la régularité : chaque question répondue rapporte de l’XP.' })}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {enr.list && enr.list.length > 0 && (
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="lb-family" className="text-sm font-semibold">{tr({ ar: 'المناظرة', fr: 'Concours' })}</label>
            <Select id="lb-family" value={family ?? ALL} onChange={(e) => setPicked(e.target.value)}>
              {enr.list.map((e) => <option key={e.id} value={e.familySlug}>{bi(locale, e.familyName_ar, e.familyName_fr)}</option>)}
              <option value={ALL}>{tr({ ar: 'كل المناظرات', fr: 'Tous les concours' })}</option>
            </Select>
          </div>
        )}
        <Tabs<Period>
          value={period}
          onChange={setPeriod}
          tabs={[
            { value: 'week', label: tr({ ar: 'هذا الأسبوع', fr: 'Cette semaine' }) },
            { value: 'all', label: tr({ ar: 'منذ البداية', fr: 'Depuis le début' }) },
          ]}
        />
      </div>

      {me?.isGuest && (
        <Alert tone="info" title={tr({ ar: 'الضيوف لا يظهرون في الترتيب', fr: 'Les invités n’apparaissent pas au classement' })}>
          <span className="flex flex-wrap items-center gap-2">
            {tr({ ar: 'أنشئ حسابًا مجانيًا لتظهر باسمك المختصر وتحافظ على نقاطك.', fr: 'Créez un compte gratuit pour apparaître (prénom + initiale) et garder vos points.' })}
            <ButtonLink href="/register?next=/app/leaderboard" size="sm" variant="secondary" className="min-h-11"><UserPlus className="size-4" aria-hidden />{tr({ ar: 'إنشاء حساب', fr: 'Créer un compte' })}</ButtonLink>
          </span>
        </Alert>
      )}

      {board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.reload()} />
      ) : !board.data ? (
        <div className="flex flex-col gap-2" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : board.data.top.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-8" aria-hidden />}
          title={tr({ ar: 'لا أحد في الترتيب بعد هذا الأسبوع', fr: 'Personne au classement cette semaine' })}
          body={tr({ ar: 'كن أول من يتدرب ويتصدر الترتيب!', fr: 'Soyez le premier à vous entraîner et prenez la tête !' })}
          action={<ButtonLink href="/app/practice">{tr({ ar: 'ابدأ التدرب', fr: 'S’entraîner' })}</ButtonLink>}
        />
      ) : (
        <Card className="p-2 sm:p-2">
          <ol className="flex flex-col">
            {board.data.top.map((r) => (
              <li
                key={`${r.rank}-${r.name}`}
                className={clsx('flex min-h-14 items-center gap-3 rounded-xl px-3', r.isMe && 'bg-primary-soft font-bold')}
                aria-current={r.isMe ? 'true' : undefined}
              >
                <RankMark rank={r.rank} />
                <span className="flex-1 truncate" dir="auto">{r.name}{r.isMe && <span className="ms-1 text-primary">({tr({ ar: 'أنت', fr: 'vous' })})</span>}</span>
                <span className="tabular-nums" dir="ltr">{r.xp.toLocaleString('fr-FR')} XP</span>
              </li>
            ))}
          </ol>
          {board.data.me && !meInTop && (
            <div className="mt-2 flex min-h-14 items-center gap-3 rounded-xl border-t border-border bg-primary-soft px-3 font-bold" aria-current="true">
              <span className="inline-flex w-9 justify-center tabular-nums">#{board.data.me.rank}</span>
              <span className="flex-1">{tr({ ar: 'أنت', fr: 'Vous' })}</span>
              <span className="tabular-nums" dir="ltr">{board.data.me.xp.toLocaleString('fr-FR')} XP</span>
            </div>
          )}
          {!board.data.me && !me?.isGuest && (
            <p className="mt-2 px-3 pb-2 text-sm text-muted">{tr({ ar: 'أجب عن أسئلة هذا الأسبوع لتدخل الترتيب.', fr: 'Répondez à des questions cette semaine pour entrer au classement.' })}</p>
          )}
        </Card>
      )}

      <p className="flex items-start gap-2 text-xs text-muted">
        <CalendarCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {tr({ ar: 'يُعاد الترتيب الأسبوعي كل يوم اثنين. تظهر الأسماء مختصرة فقط (الاسم + الحرف الأول من اللقب) ولا يُعرض أي بريد إلكتروني.', fr: 'Le classement hebdomadaire repart chaque lundi. Les noms sont seulement abrégés (prénom + initiale), aucun e-mail n’est affiché.' })}
      </p>
    </div>
  );
}

function RankMark({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex w-9 justify-center" aria-label="#1"><Crown className="size-6 text-warning" aria-hidden /></span>;
  if (rank <= 3) return <span className="inline-flex w-9 justify-center" aria-label={`#${rank}`}><Medal className={clsx('size-6', rank === 2 ? 'text-muted' : 'text-accent')} aria-hidden /></span>;
  return <span className="inline-flex w-9 justify-center text-sm font-bold tabular-nums text-muted">#{rank}</span>;
}

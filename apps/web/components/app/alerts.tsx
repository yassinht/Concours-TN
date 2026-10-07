'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { BellRing, CalendarClock, CalendarPlus, ChevronDown, ExternalLink, FileCheck2, GraduationCap, Share2, UserRound } from 'lucide-react';
import type { EditionDTO, EditionStatus, EligibilityResult } from '@ctn/shared';
import { Badge, Button } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { useLocale, useSession, useT } from '@/components/providers';
import { formatDate, type Bi } from '@/lib/i18n';
import { bi, daysFromToday, deadlineText, editionTitle, inDays, linkTarget } from './format';
import { DocumentChecklist } from './checklist';
import { EligibilityBadge, EligibilityChecks, needsProfileData, STATUS_RANK } from './eligibility';

/** One row of GET /me/alerts (one per matched position). */
export interface AlertRow {
  competition: EditionDTO;
  positionSlug: string | null;
  positionTitle_ar: string | null;
  positionTitle_fr: string | null;
  eligibility: EligibilityResult;
  createdAt: string;
}

export interface AlertGroup {
  competition: EditionDTO;
  positions: { slug: string | null; title_ar: string | null; title_fr: string | null; eligibility: EligibilityResult }[];
  best: EligibilityResult['status'];
  createdAt: string;
  needsProfile: boolean;
}

export const EDITION_STATUS: Record<EditionStatus, Bi & { tone: 'success' | 'info' | 'warning' | 'neutral' | 'primary' }> = {
  EXPECTED: { ar: 'متوقعة', fr: 'Attendu', tone: 'warning' },
  ANNOUNCED: { ar: 'معلن عنها', fr: 'Annoncé', tone: 'info' },
  OPEN: { ar: 'التسجيل مفتوح', fr: 'Inscriptions ouvertes', tone: 'success' },
  CLOSED: { ar: 'التسجيل مغلق', fr: 'Inscriptions closes', tone: 'neutral' },
  EXAM_DONE: { ar: 'أُجريت الاختبارات', fr: 'Épreuves passées', tone: 'neutral' },
  RESULTS: { ar: 'صدرت النتائج', fr: 'Résultats publiés', tone: 'primary' },
};

const ACTIVE: EditionStatus[] = ['OPEN', 'ANNOUNCED', 'EXPECTED'];

/** Groups per-position rows by edition; open editions first, then nearest deadline, then newest. */
export function groupAlerts(rows: AlertRow[]): AlertGroup[] {
  const byId = new Map<string, AlertGroup>();
  for (const r of rows) {
    let g = byId.get(r.competition.id);
    if (!g) {
      g = { competition: r.competition, positions: [], best: r.eligibility.status, createdAt: r.createdAt, needsProfile: false };
      byId.set(r.competition.id, g);
    }
    if (!g.positions.some((p) => p.slug === r.positionSlug)) {
      g.positions.push({ slug: r.positionSlug, title_ar: r.positionTitle_ar, title_fr: r.positionTitle_fr, eligibility: r.eligibility });
    }
    if (STATUS_RANK[r.eligibility.status] < STATUS_RANK[g.best]) g.best = r.eligibility.status;
    if (r.createdAt > g.createdAt) g.createdAt = r.createdAt;
    if (needsProfileData(r.eligibility)) g.needsProfile = true;
  }
  const rank = (e: EditionDTO) => (e.status === 'OPEN' ? 0 : e.status === 'ANNOUNCED' ? 1 : e.status === 'EXPECTED' ? 2 : 3);
  const key = (e: EditionDTO) => (e.registrationDeadline ?? e.examDate ?? '9999-12-31').slice(0, 10);
  return [...byId.values()]
    .map((g) => ({ ...g, positions: [...g.positions].sort((a, b) => STATUS_RANK[a.eligibility.status] - STATUS_RANK[b.eligibility.status]) }))
    .sort((a, b) => rank(a.competition) - rank(b.competition) || key(a.competition).localeCompare(key(b.competition)) || b.createdAt.localeCompare(a.createdAt));
}

export function isActiveEdition(e: EditionDTO): boolean {
  if (!ACTIVE.includes(e.status)) return false;
  const d = daysFromToday(e.registrationDeadline);
  return d == null || d >= 0;
}

/** The edition's official announcement, only when it is a real web link (never javascript:, data:…). */
export function officialUrl(e: EditionDTO): string | null {
  const t = linkTarget(e.announcementUrl);
  return t?.external ? t.href : null;
}

export function isNewAlert(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 3 * 86_400_000;
}

function deadlineTone(days: number | null): 'danger' | 'warning' | 'info' {
  if (days != null && days <= 3) return 'danger';
  if (days != null && days <= 7) return 'warning';
  return 'info';
}

/** Deadline / exam countdown chip for an edition. */
export function EditionCountdown({ e }: { e: EditionDTO }) {
  const { locale } = useLocale();
  const tr = useT();
  const dl = e.status === 'OPEN' || e.status === 'ANNOUNCED' ? daysFromToday(e.registrationDeadline) : null;
  const text = deadlineText(locale, dl);
  if (text) {
    return (
      <Badge tone={deadlineTone(dl)}>
        <CalendarClock className="size-3.5" aria-hidden />
        {text}
      </Badge>
    );
  }
  const exam = daysFromToday(e.examDate);
  const examIn = inDays(locale, exam);
  if (examIn) return <Badge tone="neutral"><CalendarClock className="size-3.5" aria-hidden />{tr({ ar: 'الاختبار', fr: 'Épreuve' })} {examIn}</Badge>;
  return null;
}

function shareText(locale: 'ar' | 'fr', e: EditionDTO, url: string): string {
  const name = bi(locale, e.familyName_ar, e.familyName_fr);
  const dl = e.registrationDeadline ? formatDate(locale, e.registrationDeadline) : null;
  if (locale === 'ar') {
    return `📢 مناظرة ${name}${e.status === 'OPEN' ? ' — التسجيل مفتوح' : ''}${dl ? `، آخر أجل ${dl}` : ''}.\nتحقق من الشروط واستعد مجانًا على Concours TN:\n${url}`;
  }
  return `📢 Concours ${name}${e.status === 'OPEN' ? ' — inscriptions ouvertes' : ''}${dl ? `, clôture le ${dl}` : ''}.\nVérifiez les conditions et préparez-vous gratuitement sur Concours TN :\n${url}`;
}

/** Full alert card (alerts page). */
export function AlertCard({ group, enrolled, onPrepare, preparing }: { group: AlertGroup; enrolled: boolean; onPrepare: (g: AlertGroup) => void; preparing: boolean }) {
  const tr = useT();
  const { locale } = useLocale();
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const e = group.competition;
  const status = EDITION_STATUS[e.status];
  const fresh = isNewAlert(group.createdAt);
  const pageUrl = `/concours/${encodeURIComponent(e.familySlug)}`;
  const official = officialUrl(e);

  async function share() {
    const ref = me && !me.isGuest ? `?ref=${encodeURIComponent(me.referralCode)}` : '';
    const url = `${window.location.origin}${pageUrl}${ref}`;
    const text = shareText(locale, e, url);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        return; // the user closed the share sheet
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <article className={clsx('card flex flex-col gap-3 p-4', group.best === 'ELIGIBLE' && 'border-success/50')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={status.tone}>{tr(status)}</Badge>
        <EditionCountdown e={e} />
        {fresh && <Badge tone="accent"><BellRing className="size-3.5" aria-hidden />{tr({ ar: 'جديد', fr: 'Nouveau' })}</Badge>}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-bold leading-snug">
          <Link href={pageUrl} className="hover:underline">{editionTitle(locale, e)}</Link>
        </h3>
        <ProvenanceBadge p={e} />
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {e.registrationOpen && (
          <div className="rounded-xl bg-surface-2 p-2">
            <dt className="text-xs text-muted">{tr({ ar: 'فتح التسجيل', fr: 'Ouverture' })}</dt>
            <dd className="font-semibold">{formatDate(locale, e.registrationOpen)}</dd>
          </div>
        )}
        {e.registrationDeadline && (
          <div className="rounded-xl bg-surface-2 p-2">
            <dt className="text-xs text-muted">{tr({ ar: 'آخر أجل', fr: 'Clôture' })}</dt>
            <dd className="font-semibold">{formatDate(locale, e.registrationDeadline)}</dd>
          </div>
        )}
        {e.examDate && (
          <div className="rounded-xl bg-surface-2 p-2">
            <dt className="text-xs text-muted">{tr({ ar: 'الاختبار', fr: 'Épreuve' })}</dt>
            <dd className="font-semibold">{formatDate(locale, e.examDate)}</dd>
          </div>
        )}
        {e.positionsCount != null && (
          <div className="rounded-xl bg-surface-2 p-2">
            <dt className="text-xs text-muted">{tr({ ar: 'عدد الخطط', fr: 'Postes' })}</dt>
            <dd className="font-semibold tabular-nums">{e.positionsCount}</dd>
          </div>
        )}
      </dl>
      {e.needsVerification && (
        <p className="text-xs text-warning">{tr({ ar: 'التواريخ مقترحة (للتحقق) — راجع البلاغ الرسمي قبل أي إجراء.', fr: 'Dates suggérées (à vérifier) — consultez l’avis officiel avant toute démarche.' })}</p>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border px-3 text-start text-sm font-semibold hover:bg-surface-2"
        >
          <span className="flex flex-wrap items-center gap-2">
            <EligibilityBadge status={group.best} />
            <span className="text-muted">
              {group.positions.length > 1 || group.positions[0]?.slug
                ? tr({ ar: `الشروط حسب الخطة (${group.positions.length})`, fr: `Conditions par poste (${group.positions.length})` })
                : tr({ ar: 'تفاصيل الشروط', fr: 'Détail des conditions' })}
            </span>
          </span>
          <ChevronDown className={clsx('size-4 shrink-0 transition', open && 'rotate-180')} aria-hidden />
        </button>
        {open && (
          <ul className="flex flex-col gap-3">
            {group.positions.map((p) => (
              <li key={p.slug ?? 'family'} className="rounded-xl border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{p.slug ? bi(locale, p.title_ar, p.title_fr) : tr({ ar: 'كل الخطط', fr: 'Tous les postes' })}</p>
                  <EligibilityBadge status={p.eligibility.status} />
                </div>
                <EligibilityChecks result={p.eligibility} />
              </li>
            ))}
          </ul>
        )}
        {group.needsProfile && (
          <Link href="/app/profile#eligibility" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">
            <UserRound className="size-4" aria-hidden />
            {tr({ ar: 'أكمل ملفك لنحسم شروط الترشح بدقة', fr: 'Complétez votre profil pour trancher l’éligibilité' })}
          </Link>
        )}
      </div>

      {isActiveEdition(e) && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setDocsOpen((v) => !v)}
            aria-expanded={docsOpen}
            className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border px-3 text-start text-sm font-semibold hover:bg-surface-2"
          >
            <span className="flex items-center gap-2"><FileCheck2 className="size-4 text-primary" aria-hidden />{tr({ ar: 'جهّز ملف ترشحك', fr: 'Préparer mon dossier' })}</span>
            <ChevronDown className={clsx('size-4 shrink-0 transition', docsOpen && 'rotate-180')} aria-hidden />
          </button>
          {docsOpen && (
            <DocumentChecklist
              familySlug={e.familySlug}
              positionSlugs={group.positions.filter((p) => p.eligibility.status !== 'NOT_ELIGIBLE').map((p) => p.slug)}
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {enrolled ? (
          <Badge tone="primary" className="min-h-9 px-3"><GraduationCap className="size-4" aria-hidden />{tr({ ar: 'أنت تستعد لهذه المناظرة', fr: 'Vous préparez ce concours' })}</Badge>
        ) : (
          <Button size="sm" onClick={() => onPrepare(group)} loading={preparing} className="min-h-11">
            <GraduationCap className="size-4" aria-hidden />
            {tr({ ar: 'ابدأ التحضير', fr: 'Me préparer' })}
          </Button>
        )}
        {official && (
          <a href={official} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2">
            <ExternalLink className="size-4" aria-hidden />
            {tr({ ar: 'البلاغ الرسمي', fr: 'Avis officiel' })}
          </a>
        )}
        <a href={`/api/catalog/editions.ics?familySlug=${encodeURIComponent(e.familySlug)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2">
          <CalendarPlus className="size-4" aria-hidden />
          {tr({ ar: 'إلى الرزنامة', fr: 'Agenda' })}
        </a>
        <button type="button" onClick={share} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2">
          <Share2 className="size-4" aria-hidden />
          {tr({ ar: 'شارك مع صديق', fr: 'Partager' })}
        </button>
      </div>
    </article>
  );
}

/** Compact row (home page card). */
export function AlertRowCompact({ group }: { group: AlertGroup }) {
  const tr = useT();
  const { locale } = useLocale();
  const e = group.competition;
  return (
    <li>
      <Link href="/app/alerts" className="flex flex-col gap-1.5 rounded-xl border border-border p-3 hover:bg-surface-2">
        <span className="flex items-start justify-between gap-2">
          <span className="font-semibold leading-snug">{editionTitle(locale, e)}</span>
          {isNewAlert(group.createdAt) && <Badge tone="accent">{tr({ ar: 'جديد', fr: 'Nouveau' })}</Badge>}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={EDITION_STATUS[e.status].tone}>{tr(EDITION_STATUS[e.status])}</Badge>
          <EligibilityBadge status={group.best} />
          <EditionCountdown e={e} />
          <ProvenanceBadge p={e} compact />
        </span>
      </Link>
    </li>
  );
}

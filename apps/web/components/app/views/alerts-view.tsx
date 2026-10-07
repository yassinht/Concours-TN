'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BellOff, BellPlus, BellRing, Check, ChevronDown, Radar, Search, UserRound } from 'lucide-react';
import type { EditionDTO, EligibilityResult, Field as FieldCode, ProfileDTO, Provenance } from '@ctn/shared';
import { FIELD_LABELS, FIELDS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, ButtonLink, EmptyState, Tabs } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { AlertCard, EDITION_STATUS, EditionCountdown, groupAlerts, isActiveEdition, type AlertGroup, type AlertRow } from '../alerts';
import { Chip, ErrorState, PageHeader, Skeleton } from '../bits';
import { EligibilityBadge, EligibilityChecks } from '../eligibility';
import { bi, countLabel, editionTitle } from '../format';
import { PushControl } from '../notification-settings';
import { CompletenessMeter, completeness, formFromProfile } from '../profile-fields';
import { useApi } from '../use-api';

interface EnrollmentRow { id: string; familySlug: string; isPrimary: boolean }
interface ScanItem {
  familySlug: string; name_ar: string; name_fr: string; field: FieldCode; popularity: number; nextEdition: EditionDTO | null;
  best: EligibilityResult['status'];
  positions: { positionSlug: string; title_ar: string; title_fr: string; result: EligibilityResult; provenance: Provenance }[];
}

type View = 'matches' | 'explore';

export function AlertsView() {
  const tr = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { me } = useSession();
  const ready = !!me;
  const alerts = useApi<AlertRow[]>(ready ? '/me/alerts?limit=200' : null);
  const profile = useApi<ProfileDTO>(ready ? '/me/profile' : null);
  const enrollments = useApi<EnrollmentRow[]>(ready ? '/me/enrollments' : null);
  const [view, setView] = useState<View>('matches');
  const [showPast, setShowPast] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const groups = useMemo(() => groupAlerts(alerts.data ?? []), [alerts.data]);
  const active = groups.filter((g) => isActiveEdition(g.competition));
  const past = groups.filter((g) => !isActiveEdition(g.competition));
  const enrolled = new Set((enrollments.data ?? []).map((e) => e.familySlug));
  const pct = profile.data ? completeness(formFromProfile(profile.data)) : null;

  function prepare(g: AlertGroup) {
    const pos = g.positions.find((p) => p.slug && p.eligibility.status !== 'NOT_ELIGIBLE')?.slug;
    router.push(`/app/onboarding?family=${encodeURIComponent(g.competition.familySlug)}${pos ? `&position=${encodeURIComponent(pos)}` : ''}`);
  }

  async function enableAlerts() {
    setEnabling(true);
    try {
      const p = await api<ProfileDTO>('/me/profile', { method: 'PUT', body: { alertsEnabled: true } });
      profile.setData(p);
      void alerts.reload();
    } finally {
      setEnabling(false);
    }
  }

  const loading = !ready || alerts.loading || profile.loading;

  return (
    <>
      <PageHeader
        title={tr({ ar: 'مناظرات تناسب ملفي', fr: 'Concours qui me correspondent' })}
        subtitle={tr({
          ar: 'نقارن كل مناظرة منشورة بشروطها المعلنة وبملفك، وننبهك فور فتح باب الترشح ثم قبل آخر أجل.',
          fr: 'Chaque concours publié est comparé à ses conditions et à votre profil : alerte à l’ouverture, puis rappel avant la clôture.',
        })}
      />

      {profile.data && !profile.data.alertsEnabled && (
        <Alert tone="warning" className="mb-4" title={tr({ ar: 'التنبيهات متوقفة', fr: 'Alertes désactivées' })}>
          <p>{tr({ ar: 'لن تصلك إشعارات عن المناظرات الجديدة التي تناسبك.', fr: 'Vous ne serez pas prévenu des nouveaux concours qui vous correspondent.' })}</p>
          <Button size="sm" className="mt-2 min-h-11" onClick={enableAlerts} loading={enabling}><BellRing className="size-4" aria-hidden />{tr({ ar: 'فعّل التنبيهات', fr: 'Activer les alertes' })}</Button>
        </Alert>
      )}

      {pct != null && pct < 80 && (
        <div className="card mb-4 flex flex-col gap-3 p-4">
          <CompletenessMeter value={pct} />
          <ButtonLink href="/app/profile#eligibility" variant="secondary" size="sm" className="min-h-11 self-start">
            <UserRound className="size-4" aria-hidden />
            {tr({ ar: 'أكمل ملفي', fr: 'Compléter mon profil' })}
          </ButtonLink>
        </div>
      )}

      <div className="mb-4">
        <Tabs<View>
          value={view}
          onChange={setView}
          tabs={[
            { value: 'matches', label: `${tr({ ar: 'تنبيهاتي', fr: 'Mes alertes' })}${active.length ? ` (${active.length})` : ''}` },
            { value: 'explore', label: tr({ ar: 'كل ما يمكنني الترشح له', fr: 'Tout ce à quoi je peux postuler' }) },
          ]}
        />
      </div>

      {view === 'explore' ? (
        <ExploreEligible ready={ready} />
      ) : loading ? (
        <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : alerts.error ? (
        <ErrorState error={alerts.error} onRetry={alerts.reload} />
      ) : active.length === 0 && past.length === 0 ? (
        <EmptyState
          icon={<Radar className="size-8" aria-hidden />}
          title={tr({ ar: 'لا توجد مناظرة مفتوحة تناسب ملفك حاليًا', fr: 'Aucun concours ouvert ne correspond à votre profil pour l’instant' })}
          body={
            pct != null && pct < 50
              ? tr({ ar: 'أضف تاريخ ميلادك وشهادتك على الأقل حتى نتمكن من مقارنة ملفك بشروط المناظرات.', fr: 'Ajoutez au moins votre date de naissance et votre diplôme pour que nous puissions comparer votre profil aux conditions.' })
              : tr({ ar: 'سننبهك فور نشر مناظرة تستوفي شروطها. في الأثناء، اكتشف المناظرات التي يمكنك الترشح لها لاحقًا وتابعها.', fr: 'Vous serez prévenu dès qu’un concours compatible est publié. En attendant, explorez ceux auxquels vous pourrez postuler et suivez-les.' })
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/app/profile#eligibility"><UserRound className="size-4" aria-hidden />{tr({ ar: 'أكمل ملفي', fr: 'Compléter mon profil' })}</ButtonLink>
              <Button variant="secondary" onClick={() => setView('explore')}><Search className="size-4" aria-hidden />{tr({ ar: 'استكشف', fr: 'Explorer' })}</Button>
            </div>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {active.length > 0 ? (
            <section aria-labelledby="alerts-active" className="flex flex-col gap-3">
              <h2 id="alerts-active" className="sr-only">{tr({ ar: 'مناظرات مفتوحة أو قادمة', fr: 'Concours ouverts ou à venir' })}</h2>
              {active.map((g) => <AlertCard key={g.competition.id} group={g} enrolled={enrolled.has(g.competition.familySlug)} onPrepare={prepare} preparing={false} />)}
            </section>
          ) : (
            <Alert tone="info">{tr({ ar: 'لا توجد مناظرة مفتوحة حاليًا ضمن تنبيهاتك. سننبهك عند فتح الدورة القادمة.', fr: 'Aucun concours ouvert dans vos alertes pour le moment. Nous vous préviendrons à la prochaine session.' })}</Alert>
          )}
          {past.length > 0 && (
            <section aria-labelledby="alerts-past">
              <button type="button" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} className="flex min-h-11 w-full items-center justify-between rounded-xl px-1 text-start font-bold">
                <span id="alerts-past">{tr({ ar: `تنبيهات سابقة (${past.length})`, fr: `Alertes passées (${past.length})` })}</span>
                <ChevronDown className={clsx('size-4 transition', showPast && 'rotate-180')} aria-hidden />
              </button>
              {showPast && (
                <div className="mt-2 flex flex-col gap-3 opacity-90">
                  {past.map((g) => <AlertCard key={g.competition.id} group={g} enrolled={enrolled.has(g.competition.familySlug)} onPrepare={prepare} preparing={false} />)}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <section className="mt-6 flex flex-col gap-2" aria-labelledby="alerts-push">
        <h2 id="alerts-push" className="text-lg font-bold">{tr({ ar: 'لا تفوّت أي أجل', fr: 'Ne ratez aucune échéance' })}</h2>
        <PushControl />
        <Link href="/app/profile#alerts" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
          {tr({ ar: 'المجالات، القنوات وساعة التذكير ←', fr: 'Domaines, canaux et heure du rappel →' })}
        </Link>
      </section>
      <p className="mt-4 text-xs text-muted">
        {locale === 'ar'
          ? 'Concours TN منصة مستقلة: نتائج المطابقة إرشادية وتعتمد على المعطيات التي أدخلتها وعلى الشروط المنشورة. البلاغ الرسمي هو المرجع الوحيد.'
          : 'Concours TN est indépendant : la correspondance est indicative et repose sur vos données et les conditions publiées. Seul l’avis officiel fait foi.'}
      </p>
    </>
  );
}

/** "Which concours can I apply to?" — every family scanned against the saved profile, with a follow button. */
function ExploreEligible({ ready }: { ready: boolean }) {
  const tr = useT();
  const { locale } = useLocale();
  const [field, setField] = useState<FieldCode | null>(null);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [hideIneligible, setHideIneligible] = useState(true);
  const [items, setItems] = useState<ScanItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const follows = useApi<{ familySlug: string }[]>(ready ? '/me/follows' : null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ScanItem[]>('/catalog/eligibility/scan', { body: { upcomingOnly, ...(field ? { field } : {}) } })
      .then((r) => !cancelled && setItems(r))
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ready, field, upcomingOnly]);

  const followed = new Set((follows.data ?? []).map((f) => f.familySlug));
  const shown = (items ?? []).filter((i) => !hideIneligible || i.best !== 'NOT_ELIGIBLE');

  async function toggleFollow(slug: string) {
    setBusySlug(slug);
    const isFollowed = followed.has(slug);
    try {
      await api(`/me/follows/${encodeURIComponent(slug)}`, { method: isFollowed ? 'DELETE' : 'POST', body: {} });
      follows.setData((prev) => (isFollowed ? (prev ?? []).filter((f) => f.familySlug !== slug) : [...(prev ?? []), { familySlug: slug }]));
    } catch {
      /* keep the previous state */
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={tr({ ar: 'المجال', fr: 'Domaine' })}>
        <Chip selected={field == null} onToggle={() => setField(null)}>{tr({ ar: 'كل المجالات', fr: 'Tous' })}</Chip>
        {FIELDS.map((f) => <Chip key={f} selected={field === f} onToggle={() => setField(field === f ? null : f)}>{tr(FIELD_LABELS[f])}</Chip>)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={upcomingOnly} onChange={(e) => setUpcomingOnly(e.target.checked)} />
          {tr({ ar: 'الدورات المفتوحة أو القادمة فقط', fr: 'Sessions ouvertes ou à venir uniquement' })}
        </label>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={hideIneligible} onChange={(e) => setHideIneligible(e.target.checked)} />
          {tr({ ar: 'إخفاء ما لا أستوفي شروطه', fr: 'Masquer ceux dont je ne remplis pas les conditions' })}
        </label>
      </div>

      {loading || items == null ? (
        error ? <ErrorState error={error} /> : <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : error ? (
        <ErrorState error={error} />
      ) : shown.length === 0 ? (
        <EmptyState icon={<Search className="size-8" aria-hidden />} title={tr({ ar: 'لا نتائج بهذه المعايير', fr: 'Aucun résultat avec ces critères' })} body={tr({ ar: 'جرّب مجالًا آخر أو ألغِ خيار «القادمة فقط».', fr: 'Essayez un autre domaine ou décochez « à venir uniquement ».' })} />
      ) : (
        <>
          <p className="text-sm text-muted">{countLabel(locale, shown.length, 'concours')}</p>
          <ul className="flex flex-col gap-2">
            {shown.map((i) => {
              const isOpen = open === i.familySlug;
              const isFollowed = followed.has(i.familySlug);
              return (
                <li key={i.familySlug} className="card flex flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Link href={`/concours/${encodeURIComponent(i.familySlug)}`} className="font-bold leading-snug hover:underline">{bi(locale, i.name_ar, i.name_fr)}</Link>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">{tr(FIELD_LABELS[i.field])}</Badge>
                        <EligibilityBadge status={i.best} />
                        {i.nextEdition && <Badge tone={EDITION_STATUS[i.nextEdition.status].tone}>{tr(EDITION_STATUS[i.nextEdition.status])}</Badge>}
                        {i.nextEdition && <EditionCountdown e={i.nextEdition} />}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isFollowed ? 'secondary' : 'primary'}
                      onClick={() => toggleFollow(i.familySlug)}
                      loading={busySlug === i.familySlug}
                      className="min-h-11 shrink-0"
                      aria-pressed={isFollowed}
                    >
                      {isFollowed ? <Check className="size-4" aria-hidden /> : <BellPlus className="size-4" aria-hidden />}
                      {isFollowed ? tr({ ar: 'متابَعة', fr: 'Suivi' }) : tr({ ar: 'نبّهني', fr: 'M’alerter' })}
                    </Button>
                  </div>
                  {i.nextEdition && (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {editionTitle(locale, i.nextEdition)}
                      <ProvenanceBadge p={i.nextEdition} compact />
                    </p>
                  )}
                  <button type="button" onClick={() => setOpen(isOpen ? null : i.familySlug)} aria-expanded={isOpen} className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-primary">
                    {tr({ ar: `الشروط حسب الخطة (${i.positions.length})`, fr: `Conditions par poste (${i.positions.length})` })}
                    <ChevronDown className={clsx('size-4 transition', isOpen && 'rotate-180')} aria-hidden />
                  </button>
                  {isOpen && (
                    <ul className="flex flex-col gap-2">
                      {i.positions.map((p) => (
                        <li key={p.positionSlug} className="rounded-xl border border-border p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold">{bi(locale, p.title_ar, p.title_fr)}</p>
                            <span className="flex items-center gap-1.5"><EligibilityBadge status={p.result.status} /><ProvenanceBadge p={p.provenance} compact /></span>
                          </div>
                          <EligibilityChecks result={p.result} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="flex items-start gap-2 text-xs text-muted">
            <BellOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {tr({
              ar: 'متابعة مناظرة تعني تنبيهك عند الإعلان عن دورتها القادمة وتذكيرك بآجالها، حتى خارج المجالات التي اخترتها.',
              fr: 'Suivre un concours = être prévenu de sa prochaine session et de ses échéances, même hors de vos domaines choisis.',
            })}
          </p>
        </>
      )}
    </div>
  );
}

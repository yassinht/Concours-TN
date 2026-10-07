'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { BellOff, BellPlus, BellRing, Search, UserCheck } from 'lucide-react';
import type { EditionDTO, EligibilityResult, Field, ProfileDTO } from '@ctn/shared';
import { Alert, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/i18n';
import { AlertsActivated } from './alerts-activated';
import { EditionStatusBadge, KeyDateLine } from './edition-status';
import { EligibilityStatusBadge, type EligibilityRow } from './eligibility-result';
import { FollowButton } from './follow-button';
import { FieldIcon } from './icons';
import { FIELDS, FIELD_LABELS, countLabel, editionTitle } from './labels';
import { EMPTY_PROFILE, ProfileFields, fromProfileDTO, hasCoreData, profileFormErrors, toProfilePayload, useActivateAlerts, useSavedProfile, type ProfileForm } from './profile-fields';
import { Disclosure } from './sections';
import { track } from './track';

interface ScanItem {
  familySlug: string; name_ar: string; name_fr: string; field: Field; popularity: number;
  nextEdition: EditionDTO | null;
  best: EligibilityResult['status'];
  positions: EligibilityRow[];
}

interface MatchItem {
  competition: EditionDTO;
  positionSlug: string | null;
  positionTitle_ar: string | null;
  positionTitle_fr: string | null;
  eligibility: EligibilityResult;
  createdAt: string;
}

/**
 * "Notify me when a concours matches my profile": profile → preview of matching concours (same matcher as the
 * alert engine) → switch alerts on (in-app + push + e-mail for accounts), plus the matches already sent.
 */
export function AlertsSetup() {
  const tr = useT();
  const { locale } = useLocale();
  const { me, loading: sessionLoading } = useSession();
  const id = useId();
  const activate = useActivateAlerts();
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [fields, setFields] = useState<Field[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [scan, setScan] = useState<ScanItem[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justActivated, setJustActivated] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [matches, setMatches] = useState<MatchItem[] | null>(null);
  const touched = useRef(false);
  // Set once the visitor changes the alert switch here: a profile fetched concurrently must not overwrite it.
  const switched = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const runScan = useCallback(async (f: ProfileForm, scroll: boolean) => {
    setScanning(true);
    setScanError(false);
    try {
      const items = await api<ScanItem[]>('/catalog/eligibility/scan', { body: { profile: toProfilePayload(f), upcomingOnly: false } });
      setScan(items);
      track('alerts_preview', { matches: items.filter((i) => i.best !== 'NOT_ELIGIBLE').length });
      if (scroll) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch {
      setScanError(true);
    } finally {
      setScanning(false);
    }
  }, []);

  useSavedProfile(useCallback((p: ProfileDTO) => {
    if (!switched.current) setEnabled(p.alertsEnabled);
    if (touched.current) return;
    const f = fromProfileDTO(p);
    setForm(f);
    setFields(p.alertFields);
    if (hasCoreData(f)) runScan(f, false);
  }, [runScan]));

  // Concours already matched for this visitor (only with an existing session).
  useEffect(() => {
    if (sessionLoading || !me) return;
    const ctrl = new AbortController();
    api<MatchItem[]>('/me/alerts?limit=20', { signal: ctrl.signal }).then(setMatches).catch(() => {});
    return () => ctrl.abort();
  }, [me, sessionLoading, justActivated]);

  function onChange(v: ProfileForm) {
    touched.current = true;
    setForm(v);
  }

  function toggleField(f: Field) {
    touched.current = true;
    setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  }

  function validate(): boolean {
    if (Object.keys(profileFormErrors(form)).length) return false;
    if (!hasCoreData(form)) {
      setFormError(tr({ ar: 'أدخل على الأقل تاريخ ميلادك أو مستواك الدراسي.', fr: 'Indiquez au moins votre date de naissance ou votre diplôme.' }));
      return false;
    }
    setFormError(null);
    return true;
  }

  function preview(e: FormEvent) {
    e.preventDefault();
    if (validate()) runScan(form, true);
  }

  async function onActivate() {
    if (!validate()) return;
    switched.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await activate(toProfilePayload(form), { alertFields: fields, from: 'alerts_page' });
      setEnabled(true);
      setJustActivated(true);
      if (!scan) runScan(form, false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function onDisable() {
    switched.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await api('/me/profile', { method: 'PUT', body: { alertsEnabled: false } });
      setEnabled(false);
      setJustActivated(false);
      track('alerts_disabled', {});
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const visible = (scan ?? []).filter((i) => fields.length === 0 || fields.includes(i.field));
  const eligible = visible.filter((i) => i.best === 'ELIGIBLE');
  const partial = visible.filter((i) => i.best === 'PARTIAL');
  const notEligible = visible.filter((i) => i.best === 'NOT_ELIGIBLE');

  return (
    <div className="flex flex-col gap-8">
      {enabled && !justActivated && (
        <div className="flex flex-col gap-2 rounded-2xl border border-success/40 bg-success-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 font-semibold text-success"><BellRing className="size-5" aria-hidden />{tr({ ar: 'تنبيهاتك مفعّلة', fr: 'Vos alertes sont actives' })}</p>
          <Button variant="ghost" size="sm" onClick={onDisable} loading={saving} className="min-h-11 self-start text-muted">
            <BellOff className="size-4" aria-hidden />
            {tr({ ar: 'إيقاف التنبيهات', fr: 'Désactiver les alertes' })}
          </Button>
        </div>
      )}

      {matches && matches.length > 0 && (
        <section aria-labelledby={`${id}-matches`} className="flex flex-col gap-3">
          <h2 id={`${id}-matches`} className="text-xl font-extrabold">{tr({ ar: 'مناظرات نبّهناك بها', fr: 'Concours pour lesquels vous avez été alerté(e)' })}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {matches.map((m, i) => (
              <li key={`${m.competition.id}-${m.positionSlug ?? i}`}>
                <Link href={`/concours/${m.competition.familySlug}`} className="card flex h-full flex-col gap-2 p-4 hover:border-primary">
                  <span className="font-bold">{editionTitle(locale, m.competition)}</span>
                  {(m.positionTitle_ar || m.positionTitle_fr) && <span className="text-sm text-muted">{locale === 'fr' ? m.positionTitle_fr : m.positionTitle_ar}</span>}
                  <span className="flex flex-wrap gap-1.5"><EligibilityStatusBadge locale={locale} status={m.eligibility.status} /></span>
                  <EditionStatusBadge locale={locale} edition={m.competition} />
                  <KeyDateLine locale={locale} edition={m.competition} />
                  <span className="text-xs text-muted">{tr({ ar: 'تاريخ التنبيه', fr: 'Alerté le' })}: {formatDate(locale, m.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card as="section" className="flex flex-col gap-5">
        <form onSubmit={preview} className="flex flex-col gap-5" aria-labelledby={`${id}-form`}>
          <h2 id={`${id}-form`} className="flex items-center gap-2 text-lg font-bold">
            <UserCheck className="size-5 text-primary" aria-hidden />
            {tr({ ar: '1. ملفك', fr: '1. Votre profil' })}
          </h2>
          <ProfileFields value={form} onChange={onChange} idPrefix={id} />

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-lg font-bold">{tr({ ar: '2. المجالات التي تهمك', fr: '2. Les domaines qui vous intéressent' })}</legend>
            <p className="text-sm text-muted">{tr({ ar: 'دون اختيار: كل المجالات التي تستوفي شروطها.', fr: 'Sans sélection : tous les domaines dont vous remplissez les conditions.' })}</p>
            <div className="flex flex-wrap gap-2">
              {FIELDS.map((f) => {
                const on = fields.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleField(f)}
                    className={clsx('inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition', on ? 'border-primary bg-primary text-primary-contrast' : 'border-border bg-surface hover:bg-surface-2')}
                  >
                    <FieldIcon field={f} className="size-4" />
                    {tr(FIELD_LABELS[f])}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {formError && <Alert tone="warning">{formError}</Alert>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="secondary" size="lg" loading={scanning}>
              <Search className="size-5" aria-hidden />
              {tr({ ar: 'اعرض المناظرات المناسبة لي', fr: 'Voir les concours qui me correspondent' })}
            </Button>
            <Button type="button" variant="primary" size="lg" onClick={onActivate} loading={saving}>
              <BellPlus className="size-5" aria-hidden />
              {enabled ? tr({ ar: 'حدّث ملفي وتنبيهاتي', fr: 'Mettre à jour mes alertes' }) : tr({ ar: 'فعّل التنبيهات', fr: 'Activer les alertes' })}
            </Button>
          </div>
          {saveError && <Alert tone="danger">{tr({ ar: 'تعذّر الحفظ. حاول مرة أخرى.', fr: 'Échec de l’enregistrement. Réessayez.' })}</Alert>}
        </form>
        {justActivated && <AlertsActivated next="/alerts" />}
      </Card>

      <div ref={resultsRef} className="flex scroll-mt-28 flex-col gap-4" aria-live="polite">
        {scanning && !scan && <div className="flex justify-center py-6"><Spinner /></div>}
        {scanError && <Alert tone="danger">{tr({ ar: 'تعذّر تحميل المناظرات المطابقة. حاول مرة أخرى.', fr: 'Impossible de charger les concours correspondants. Réessayez.' })}</Alert>}
        {scan && (
          <>
            <h2 className="text-xl font-extrabold">{tr({ ar: 'المناظرات المطابقة لملفك', fr: 'Concours correspondant à votre profil' })}</h2>
            <p className="text-sm text-muted">
              {tr({ ar: `تستوفي الشروط: ${eligible.length} · بحاجة لمعطيات إضافية: ${partial.length}`, fr: `Éligible : ${eligible.length} · informations à compléter : ${partial.length}` })}
            </p>
            {eligible.length + partial.length === 0 ? (
              <EmptyState
                title={tr({ ar: 'لا توجد مناظرة مطابقة حاليًا', fr: 'Aucun concours correspondant pour le moment' })}
                body={tr({ ar: 'فعّل التنبيهات وسنعلمك فور نشر مناظرة تناسب ملفك.', fr: 'Activez les alertes : nous vous préviendrons dès qu’un concours vous correspond.' })}
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[...eligible, ...partial].map((item) => <ScanCard key={item.familySlug} item={item} />)}
              </ul>
            )}
            {notEligible.length > 0 && (
              <Disclosure summary={tr({ ar: `مناظرات لا تستوفي شروطها (${notEligible.length})`, fr: `Concours dont vous ne remplissez pas les conditions (${notEligible.length})` })}>
                <ul className="flex flex-col gap-1.5 pt-1">
                  {notEligible.map((i) => (
                    <li key={i.familySlug}>
                      <Link href={`/concours/${i.familySlug}`} className="inline-flex min-h-11 items-center hover:text-text hover:underline">{locale === 'fr' ? i.name_fr : i.name_ar}</Link>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ScanCard({ item }: { item: ScanItem }) {
  const tr = useT();
  const { locale } = useLocale();
  const ok = item.positions.filter((p) => p.result.status === 'ELIGIBLE');
  const unverified = item.positions.some((p) => p.result.rules_unverified);
  return (
    <li className="card flex h-full flex-col gap-2 p-4">
      <span className="flex items-center gap-2 text-xs text-muted"><FieldIcon field={item.field} className="size-4" />{tr(FIELD_LABELS[item.field])}</span>
      <Link href={`/concours/${item.familySlug}`} className="font-bold hover:text-primary hover:underline">{locale === 'fr' ? item.name_fr : item.name_ar}</Link>
      <span className="flex flex-wrap gap-1.5">
        <EligibilityStatusBadge locale={locale} status={item.best} />
      </span>
      {ok.length > 0 && (
        <p className="text-sm text-muted">
          {tr({ ar: 'الرتب', fr: 'Grades' })} ({countLabel(locale, ok.length, 'position')}): {ok.map((p) => (locale === 'fr' ? p.title_fr : p.title_ar)).join(locale === 'ar' ? '، ' : ', ')}
        </p>
      )}
      {unverified && <p className="text-xs text-warning">{tr({ ar: 'بعض الشروط مقترحة وللتحقق.', fr: 'Certaines conditions sont des suggestions à vérifier.' })}</p>}
      {item.nextEdition ? (
        <div className="flex flex-col gap-1">
          <EditionStatusBadge locale={locale} edition={item.nextEdition} />
          <KeyDateLine locale={locale} edition={item.nextEdition} />
        </div>
      ) : (
        <p className="text-sm text-muted">{tr({ ar: 'لا توجد دورة معلنة حاليًا', fr: 'Aucune session annoncée' })}</p>
      )}
      <div className="mt-auto pt-1">
        <FollowButton slug={item.familySlug} variant="compact" />
      </div>
    </li>
  );
}

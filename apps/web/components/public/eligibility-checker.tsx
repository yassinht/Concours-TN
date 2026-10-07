'use client';

import Link from 'next/link';
import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { BellPlus, ClipboardCheck, ShieldCheck, Sparkles } from 'lucide-react';
import type { ProfileDTO } from '@ctn/shared';
import { Alert, Button, ButtonLink, Card, Field, Select } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { api, ApiError } from '@/lib/api';
import { AlertsActivated } from './alerts-activated';
import { EligibilityResultCard, type EligibilityRow } from './eligibility-result';
import { useFollows } from './follows';
import { EMPTY_PROFILE, ProfileFields, fromProfileDTO, hasCoreData, profileFormErrors, toProfilePayload, useActivateAlerts, useSavedProfile, type ProfileForm } from './profile-fields';
import { track } from './track';

export interface CheckerPosition { slug: string; title_ar: string; title_fr: string }

/** Eligibility form for one concours: prefilled from the saved profile, results per position, then "save & alert me". */
export function EligibilityChecker({ familySlug, positions, specialtySuggestions }: { familySlug: string; positions: CheckerPosition[]; specialtySuggestions: string[] }) {
  const tr = useT();
  const { locale } = useLocale();
  const id = useId();
  const { follow } = useFollows();
  const activate = useActivateAlerts();
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [positionSlug, setPositionSlug] = useState('');
  const [results, setResults] = useState<EligibilityRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const touched = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const runCheck = useCallback(async (f: ProfileForm, pos: string, scroll: boolean) => {
    setChecking(true);
    setError(null);
    try {
      const rows = await api<EligibilityRow[]>('/catalog/eligibility', {
        body: { familySlug, ...(pos ? { positionSlug: pos } : {}), profile: toProfilePayload(f) },
      });
      setResults(rows);
      track('eligibility_check', { familySlug, positionSlug: pos || null, eligible: rows.filter((r) => r.result.status === 'ELIGIBLE').length, total: rows.length });
      if (scroll) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 400
          ? tr({ ar: 'تحقق من المعطيات المدخلة.', fr: 'Vérifiez les informations saisies.' })
          : tr({ ar: 'تعذّر التحقق الآن. حاول مرة أخرى.', fr: 'Vérification impossible pour le moment. Réessayez.' }),
      );
    } finally {
      setChecking(false);
    }
  }, [familySlug, tr]);

  // Returning visitors: prefill from the saved profile and show their result straight away.
  const savedProfile = useSavedProfile(useCallback((p: ProfileDTO) => {
    if (touched.current) return;
    const f = fromProfileDTO(p);
    setForm(f);
    if (hasCoreData(f)) runCheck(f, '', false);
  }, [runCheck]));

  function onChange(v: ProfileForm) {
    touched.current = true;
    setForm(v);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(profileFormErrors(form)).length) return;
    setSaved(false);
    runCheck(form, positionSlug, true);
  }

  async function saveAndAlert() {
    setSaving(true);
    setSaveError(false);
    try {
      await activate(toProfilePayload(form), { from: 'eligibility', familySlug });
      await follow(familySlug);
      setSaved(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const eligible = results?.filter((r) => r.result.status === 'ELIGIBLE').length ?? 0;
  const partial = results?.filter((r) => r.result.status === 'PARTIAL').length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <Card as="section" className="flex flex-col gap-4">
        <form onSubmit={submit} className="flex flex-col gap-4" aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-bold">
            <ClipboardCheck className="size-5 text-primary" aria-hidden />
            {tr({ ar: 'معطياتك', fr: 'Vos informations' })}
          </h2>
          {positions.length > 1 && (
            <Field label={tr({ ar: 'الرتبة', fr: 'Grade' })} htmlFor={`${id}-pos`}>
              <Select id={`${id}-pos`} value={positionSlug} onChange={(e) => setPositionSlug(e.target.value)}>
                <option value="">{tr({ ar: 'كل الرتب', fr: 'Tous les grades' })}</option>
                {positions.map((p) => <option key={p.slug} value={p.slug}>{locale === 'fr' ? p.title_fr : p.title_ar}</option>)}
              </Select>
            </Field>
          )}
          <ProfileFields value={form} onChange={onChange} idPrefix={id} specialtySuggestions={specialtySuggestions} />
          <p className="flex items-start gap-2 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            {tr({
              ar: 'لا نحفظ هذه المعطيات إلا إذا طلبت ذلك (زر «احفظ ملفي»). الطول والحالة المدنية اختياريان.',
              fr: 'Ces informations ne sont enregistrées que si vous le demandez (« Enregistrer mon profil »). Taille et situation familiale sont facultatives.',
            })}
          </p>
          <Button type="submit" size="lg" loading={checking} className="self-start">
            {tr({ ar: 'تحقق من أهليتي', fr: 'Vérifier mon éligibilité' })}
          </Button>
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Card>

      <div ref={resultsRef} className="flex scroll-mt-28 flex-col gap-4" aria-live="polite">
        {results && (
          <>
            <h2 className="text-xl font-extrabold">{tr({ ar: 'النتيجة', fr: 'Résultat' })}</h2>
            {results.length === 0 ? (
              <Alert tone="info">{tr({ ar: 'لا توجد رتب منشورة لهذه المناظرة بعد.', fr: 'Aucun grade publié pour ce concours.' })}</Alert>
            ) : (
              <p className="text-[15px]">
                {eligible > 0
                  ? tr({ ar: `الرتب التي تستوفي شروطها المعلنة: ${eligible} من أصل ${results.length}.`, fr: `Grades dont vous remplissez les conditions annoncées : ${eligible} sur ${results.length}.` })
                  : partial > 0
                    ? tr({ ar: 'أكمل المعطيات الناقصة (علامة ؟) لنحسم أهليتك.', fr: 'Complétez les informations manquantes (marquées ?) pour conclure.' })
                    : tr({ ar: 'حسب الشروط المعلنة، لا تستوفي شروط هذه المناظرة. اكتشف مناظرات أخرى تناسبك.', fr: 'D’après les conditions annoncées, vous n’êtes pas éligible. Découvrez d’autres concours adaptés.' })}
              </p>
            )}
            {results.length > 0 && eligible === 0 && partial === 0 && (
              <Link href="/alerts" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                {tr({ ar: 'اكتشف المناظرات التي تستوفي شروطها', fr: 'Découvrir les concours auxquels vous êtes éligible' })}
              </Link>
            )}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {results.map((r) => <EligibilityResultCard key={r.positionSlug} locale={locale} row={r} />)}
            </div>

            <Card as="section" className="flex flex-col gap-3">
              <h2 className="text-lg font-bold">{tr({ ar: 'الخطوة التالية', fr: 'Étape suivante' })}</h2>
              {saved ? (
                <AlertsActivated next={`/concours/${familySlug}`} />
              ) : (
                <>
                  {savedProfile?.alertsEnabled && (
                    <p className="text-sm font-semibold text-success">{tr({ ar: 'تنبيهاتك مفعّلة مسبقًا — الحفظ يحدّث ملفك ويضيف هذه المناظرة إلى متابعاتك.', fr: 'Vos alertes sont déjà actives — enregistrer met à jour votre profil et suit ce concours.' })}</p>
                  )}
                  <p className="text-sm text-muted">
                    {tr({
                      ar: 'احفظ ملفك لنعلمك عند فتح هذه المناظرة وكل مناظرة أخرى تستوفي شروطها، مع تذكير قبل آخر أجل.',
                      fr: 'Enregistrez votre profil : nous vous alerterons à l’ouverture de ce concours et de tout autre dont vous remplissez les conditions, avec un rappel avant la clôture.',
                    })}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="primary" size="lg" onClick={saveAndAlert} loading={saving}>
                      <BellPlus className="size-5" aria-hidden />
                      {tr({ ar: 'احفظ ملفي وفعّل التنبيهات', fr: 'Enregistrer mon profil et activer les alertes' })}
                    </Button>
                    <ButtonLink href={`/diagnostic/${familySlug}`} variant="accent" size="lg">
                      <Sparkles className="size-5" aria-hidden />
                      {tr({ ar: 'ابدأ الاختبار التشخيصي', fr: 'Commencer le test diagnostique' })}
                    </ButtonLink>
                  </div>
                  {saveError && <Alert tone="danger">{tr({ ar: 'تعذّر الحفظ. حاول مرة أخرى.', fr: 'Échec de l’enregistrement. Réessayez.' })}</Alert>}
                </>
              )}
              {saved && (
                <ButtonLink href={`/diagnostic/${familySlug}`} variant="accent" size="lg" className="self-start">
                  <Sparkles className="size-5" aria-hidden />
                  {tr({ ar: 'ابدأ الاختبار التشخيصي', fr: 'Commencer le test diagnostique' })}
                </ButtonLink>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

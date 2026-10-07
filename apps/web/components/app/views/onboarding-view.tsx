'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, BellRing, Check, ClipboardCheck, Clock, Info, Mail, Search, ShieldCheck, Smartphone, Sparkles, Target } from 'lucide-react';
import type {
  AttemptSessionDTO, EligibilityResult, FamilyDetailDTO, FamilySummaryDTO, Field as FieldCode, NotificationChannel, ProfileDTO, Provenance,
} from '@ctn/shared';
import { DIPLOMA_LABELS, FIELD_LABELS, FIELDS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button, Field, Input } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { formatDate, type Bi } from '@/lib/i18n';
import { EDITION_STATUS, EditionCountdown } from '../alerts';
import { Chip, ErrorState, Skeleton } from '../bits';
import { EligibilityBadge, EligibilityChecks } from '../eligibility';
import { bi, daysFromToday, errorText, tunisToday } from '../format';
import { PushControl } from '../notification-settings';
import { EligibilityFields, EMPTY_ELIGIBILITY, eligibilityProfile, formErrors, formFromProfile, formToPayload, type EligibilityForm } from '../profile-fields';
import { errorCode, track, useApi } from '../use-api';

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: Bi[] = [
  { ar: 'المناظرة', fr: 'Concours' },
  { ar: 'الخطة', fr: 'Poste' },
  { ar: 'ملفك', fr: 'Profil' },
  { ar: 'الإيقاع', fr: 'Rythme' },
  { ar: 'التشخيص', fr: 'Diagnostic' },
];
const MINUTES = [15, 30, 45, 60] as const;
const STORE_KEY = 'ctn_onboarding';

interface EligibilityRow { positionSlug: string; title_ar: string; title_fr: string; result: EligibilityResult; provenance: Provenance }
interface Saved { step: Step; familySlug: string | null; positionSlug: string | null; form: EligibilityForm; dailyMinutes: number; examDate: string; channels: NotificationChannel[] }

function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function OnboardingView({ initialFamily, initialPosition }: { initialFamily?: string; initialPosition?: string }) {
  const tr = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { me, ensureSession, refresh } = useSession();
  const [step, setStep] = useState<Step>(1);
  const [familySlug, setFamilySlug] = useState<string | null>(initialFamily ?? null);
  const [positionSlug, setPositionSlug] = useState<string | null>(initialPosition ?? null);
  const [form, setForm] = useState<EligibilityForm>(EMPTY_ELIGIBILITY);
  const [channels, setChannels] = useState<NotificationChannel[]>(['IN_APP', 'PUSH', 'EMAIL']);
  const [dailyMinutes, setDailyMinutes] = useState(30);
  const [examDate, setExamDate] = useState('');
  const [makePrimary, setMakePrimary] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<Bi | null>(null);
  const restored = useRef(false);
  const profileLoaded = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const detail = useApi<FamilyDetailDTO>(familySlug ? `/catalog/families/${encodeURIComponent(familySlug)}` : null);
  const family = detail.data;
  const hasEnrollment = !!me?.onboarding.hasEnrollment;

  // Restore an interrupted onboarding (same tab), unless the URL asks for a specific concours.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (initialFamily) {
      setStep(initialPosition ? 3 : 2);
      return;
    }
    const s = readSaved();
    if (s?.familySlug) {
      setStep(s.step === 5 ? 4 : s.step);
      setFamilySlug(s.familySlug);
      setPositionSlug(s.positionSlug);
      setForm(s.form);
      setDailyMinutes(s.dailyMinutes);
      setExamDate(s.examDate);
      setChannels(s.channels);
      profileLoaded.current = true; // the restored form already contains what the user typed
    }
  }, [initialFamily, initialPosition]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ step, familySlug, positionSlug, form, dailyMinutes, examDate, channels } satisfies Saved));
    } catch {
      /* ignore */
    }
  }, [step, familySlug, positionSlug, form, dailyMinutes, examDate, channels]);

  // Prefill the eligibility form from the saved profile (once).
  useEffect(() => {
    if (!me || profileLoaded.current) return;
    profileLoaded.current = true;
    api<ProfileDTO>('/me/profile')
      .then((p) => {
        setForm(formFromProfile(p));
        if (p.alertChannels.length) setChannels(p.alertChannels.includes('IN_APP') ? p.alertChannels : ['IN_APP', ...p.alertChannels]);
      })
      .catch(() => {});
  }, [me]);

  // Prefill the exam date with the next announced edition (user can change it).
  useEffect(() => {
    const d = family?.nextEdition?.examDate;
    if (d && !examDate && (daysFromToday(d) ?? -1) >= 0) setExamDate(d.slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family?.nextEdition?.examDate]);

  // A family without positions on file skips the position step.
  useEffect(() => {
    if (step === 2 && family && family.positions.length === 0) setStep(3);
    if (step === 2 && family && family.positions.length === 1 && !positionSlug) setPositionSlug(family.positions[0].slug);
  }, [step, family, positionSlug]);

  // An unknown position slug from the URL falls back to "not sure yet".
  useEffect(() => {
    if (family && positionSlug && !family.positions.some((p) => p.slug === positionSlug)) setPositionSlug(null);
  }, [family, positionSlug]);

  const go = useCallback((s: Step) => {
    setError(null);
    setStep(s);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      headingRef.current?.focus();
    });
  }, []);

  async function saveAndContinue() {
    if (!familySlug) return go(1);
    if (Object.keys(formErrors(form)).length) {
      setError({ ar: 'صحّح الخانات المشار إليها في ملفك.', fr: 'Corrigez les champs signalés dans votre profil.' });
      return go(3);
    }
    setSaving(true);
    setError(null);
    try {
      await ensureSession();
      await api<ProfileDTO>('/me/profile', {
        method: 'PUT',
        body: { ...formToPayload(form), alertsEnabled: true, alertChannels: channels.includes('IN_APP') ? channels : ['IN_APP', ...channels] },
      });
      await api('/me/enrollments', {
        body: {
          familySlug,
          positionSlug,
          targetExamDate: /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? examDate : null,
          dailyMinutes,
          isPrimary: hasEnrollment ? makePrimary : true,
        },
      });
      track('onboarding_done', { familySlug, positionSlug, dailyMinutes });
      await refresh();
      go(5);
    } catch (e) {
      setError(errorText(errorCode(e)));
    } finally {
      setSaving(false);
    }
  }

  async function startDiagnostic() {
    if (!familySlug) return;
    setStarting(true);
    setError(null);
    try {
      const a = await api<AttemptSessionDTO>('/attempts', { body: { kind: 'DIAGNOSTIC', familySlug, ...(positionSlug ? { positionSlug } : {}) } });
      track('diagnostic_start', { familySlug, positionSlug, from: 'onboarding' });
      try {
        sessionStorage.removeItem(STORE_KEY);
      } catch {
        /* ignore */
      }
      router.push(`/app/session/${a.id}`);
    } catch (e) {
      setError(errorText(errorCode(e)));
      setStarting(false);
    }
  }

  function finishLater() {
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    router.push('/app');
  }

  const BackIcon = locale === 'ar' ? ArrowRight : ArrowLeft;
  const NextIcon = locale === 'ar' ? ArrowLeft : ArrowRight;
  const position = family?.positions.find((p) => p.slug === positionSlug) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          {step > 1 && step < 5 ? (
            <button type="button" onClick={() => go((step - 1) as Step)} className="-ms-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted hover:text-text">
              <BackIcon className="size-4" aria-hidden />
              {tr({ ar: 'رجوع', fr: 'Retour' })}
            </button>
          ) : <span />}
          <span className="text-sm font-semibold text-muted" aria-live="polite">{tr({ ar: `الخطوة ${step} من 5`, fr: `Étape ${step} sur 5` })}</span>
        </div>
        <ol className="grid grid-cols-5 gap-1.5" aria-label={tr({ ar: 'مراحل التسجيل', fr: 'Étapes' })}>
          {STEPS.map((s, i) => (
            <li key={s.fr} className="flex flex-col gap-1" aria-current={i + 1 === step ? 'step' : undefined}>
              <span className={clsx('h-1.5 rounded-full', i + 1 <= step ? 'bg-primary' : 'bg-surface-2')} />
              <span className={clsx('hidden text-[11px] font-semibold sm:block', i + 1 === step ? 'text-primary' : 'text-muted')}>{tr(s)}</span>
            </li>
          ))}
        </ol>
      </div>

      {error && <Alert tone="danger">{tr(error)}</Alert>}

      {step === 1 && (
        <StepFamily
          headingRef={headingRef}
          title={hasEnrollment ? tr({ ar: 'أضف مناظرة أخرى', fr: 'Ajouter un autre concours' }) : tr({ ar: 'ما المناظرة التي تستعد لها؟', fr: 'Quel concours préparez-vous ?' })}
          selected={familySlug}
          onSelect={(slug) => {
            if (slug !== familySlug) {
              setPositionSlug(null);
              setExamDate('');
            }
            setFamilySlug(slug);
            go(2);
          }}
        />
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4" aria-labelledby="ob-h">
          <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold outline-none">{tr({ ar: 'ما الخطة (الرتبة) التي تستهدفها؟', fr: 'Quel poste visez-vous ?' })}</h1>
          {detail.loading || !family ? (
            detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} /> : <Skeleton className="h-48" />
          ) : (
            <>
              <p className="text-sm text-muted">{bi(locale, family.name_ar, family.name_fr)} — {tr({ ar: 'الشروط والاختبارات تختلف حسب الخطة.', fr: 'Conditions et épreuves varient selon le poste.' })}</p>
              <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="ob-h">
                {family.positions.map((p) => (
                  <ChoiceCard key={p.slug} selected={positionSlug === p.slug} onSelect={() => setPositionSlug(p.slug)}>
                    <span className="font-semibold">{bi(locale, p.title_ar, p.title_fr)}</span>
                    <span className="text-xs text-muted">{tr({ ar: 'المستوى المطلوب:', fr: 'Niveau requis :' })} {tr(DIPLOMA_LABELS[p.diplomaLevel])}</span>
                  </ChoiceCard>
                ))}
                <ChoiceCard selected={positionSlug === null} onSelect={() => setPositionSlug(null)}>
                  <span className="font-semibold">{tr({ ar: 'لست متأكدًا بعد', fr: 'Je ne sais pas encore' })}</span>
                  <span className="text-xs text-muted">{tr({ ar: 'سنحضّرك على الجزء المشترك ونقارن ملفك بكل الخطط.', fr: 'Préparation au tronc commun et comparaison avec tous les postes.' })}</span>
                </ChoiceCard>
              </div>
              <Button size="lg" onClick={() => go(3)}>{tr({ ar: 'التالي', fr: 'Suivant' })}<NextIcon className="size-4" aria-hidden /></Button>
            </>
          )}
        </section>
      )}

      {step === 3 && familySlug && (
        <StepProfile
          headingRef={headingRef}
          familySlug={familySlug}
          positionSlug={positionSlug}
          form={form}
          setForm={setForm}
          channels={channels}
          setChannels={setChannels}
          isGuest={!me || me.isGuest}
          onNext={() => {
            if (Object.keys(formErrors(form)).length) {
              setError({ ar: 'صحّح الخانات المشار إليها.', fr: 'Corrigez les champs signalés.' });
              return;
            }
            go(4);
          }}
        />
      )}

      {step === 4 && (
        <section className="flex flex-col gap-5" aria-labelledby="ob-h">
          <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold outline-none">{tr({ ar: 'كم من الوقت يمكنك تخصيصه يوميًا؟', fr: 'Combien de temps par jour ?' })}</h1>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{tr({ ar: 'الدقائق يوميًا', fr: 'Minutes par jour' })}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MINUTES.map((m) => (
                <ChoiceCard key={m} selected={dailyMinutes === m} onSelect={() => setDailyMinutes(m)} center>
                  <span className="flex items-center gap-1.5 text-lg font-extrabold tabular-nums"><Clock className="size-4" aria-hidden />{m}</span>
                  <span className="text-xs text-muted">{tr({ ar: 'دقيقة يوميًا', fr: 'min / jour' })}</span>
                </ChoiceCard>
              ))}
            </div>
            <p className="text-xs text-muted">{tr({ ar: 'الانتظام أهم من المدة: 15 دقيقة كل يوم أفضل من ساعتين مرة في الأسبوع.', fr: 'La régularité compte plus que la durée : 15 min par jour valent mieux que 2 h une fois par semaine.' })}</p>
          </fieldset>

          <Field
            label={tr({ ar: 'تاريخ الامتحان المتوقع', fr: 'Date d’examen visée' })}
            htmlFor="ob-exam"
            hint={tr({ ar: 'نستعمله للعد التنازلي ولتكثيف المراجعة في الأسابيع الأخيرة. اتركه فارغًا إن لم يُعلن بعد.', fr: 'Pour le compte à rebours et l’intensification des révisions en fin de parcours. Laissez vide si non annoncée.' })}
          >
            <Input id="ob-exam" type="date" min={tunisToday()} value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </Field>
          {family?.nextEdition?.examDate && examDate === family.nextEdition.examDate.slice(0, 10) && (
            <p className="-mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              {tr({ ar: 'حسب آخر دورة معلنة:', fr: 'D’après la dernière session annoncée :' })} {formatDate(locale, examDate)}
              <ProvenanceBadge p={family.nextEdition} compact />
            </p>
          )}

          {hasEnrollment && (
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-5 accent-[var(--primary)]" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} />
              <span>{tr({ ar: 'اجعلها مناظرتي الرئيسية (خطة اليوم والعد التنازلي)', fr: 'En faire mon concours principal (plan du jour et compte à rebours)' })}</span>
            </label>
          )}

          <Button size="lg" onClick={saveAndContinue} loading={saving}>
            <Check className="size-4" aria-hidden />
            {tr({ ar: 'احفظ وأنشئ خطتي', fr: 'Enregistrer et créer mon plan' })}
          </Button>
        </section>
      )}

      {step === 5 && (
        <section className="flex flex-col gap-5" aria-labelledby="ob-h">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-primary-soft p-5 text-center">
            <span className="inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-contrast"><Target className="size-7" aria-hidden /></span>
            <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold outline-none">{tr({ ar: 'آخر خطوة: الاختبار التشخيصي', fr: 'Dernière étape : le diagnostic' })}</h1>
            <p className="max-w-md text-sm">
              {tr({
                ar: 'حوالي 24 سؤالًا موزعة على مواد الامتحان، دون تصحيح فوري. في النهاية: مستواك في كل مادة، مؤشر جاهزيتك، وخطة يومية مبنية على نقاط ضعفك.',
                fr: 'Environ 24 questions réparties sur les matières de l’examen, sans correction immédiate. À la fin : votre niveau par matière, votre indicateur de préparation et un plan quotidien ciblé.',
              })}
            </p>
            <ul className="grid gap-1 text-sm">
              <li className="flex items-center gap-2"><ClipboardCheck className="size-4 text-primary" aria-hidden />{tr({ ar: '20 إلى 30 دقيقة تقريبًا', fr: '20 à 30 minutes environ' })}</li>
              <li className="flex items-center gap-2"><Sparkles className="size-4 text-primary" aria-hidden />{tr({ ar: 'مجاني ويمكن إعادته لاحقًا', fr: 'Gratuit, refaisable plus tard' })}</li>
            </ul>
            <Button size="lg" block onClick={startDiagnostic} loading={starting} className="max-w-sm">
              {tr({ ar: 'ابدأ الاختبار التشخيصي', fr: 'Commencer le diagnostic' })}
              <NextIcon className="size-4" aria-hidden />
            </Button>
            <Button variant="ghost" onClick={finishLater}>{tr({ ar: 'لاحقًا، خذني إلى فضائي', fr: 'Plus tard, aller à mon espace' })}</Button>
          </div>
          {channels.includes('PUSH') && (
            <div className="flex flex-col gap-2">
              <h2 className="font-bold">{tr({ ar: 'استقبل التنبيهات على هاتفك', fr: 'Recevez les alertes sur votre téléphone' })}</h2>
              <PushControl />
            </div>
          )}
          {position && (
            <p className="text-center text-xs text-muted">{bi(locale, family?.name_ar, family?.name_fr)} · {bi(locale, position.title_ar, position.title_fr)}</p>
          )}
        </section>
      )}
    </div>
  );
}

function ChoiceCard({ selected, onSelect, children, center }: { selected: boolean; onSelect: () => void; children: ReactNode; center?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={clsx(
        'flex min-h-14 w-full flex-col gap-0.5 rounded-xl border-2 p-3 transition',
        center ? 'items-center text-center' : 'items-start text-start',
        selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-primary/50',
      )}
    >
      {children}
    </button>
  );
}

function StepFamily({ title, selected, onSelect, headingRef }: { title: string; selected: string | null; onSelect: (slug: string) => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const tr = useT();
  const { locale } = useLocale();
  const [q, setQ] = useState('');
  const [field, setField] = useState<FieldCode | null>(null);
  const families = useApi<FamilySummaryDTO[]>('/catalog/families');

  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ًͯ-ْ]/g, '');
  const shown = useMemo(() => {
    const needle = norm(q.trim());
    return (families.data ?? []).filter((f) => {
      if (field && f.field !== field) return false;
      if (!needle) return true;
      return [f.name_ar, f.name_fr, f.organization.name_ar, f.organization.name_fr, ...f.keywords].some((s) => s && norm(s).includes(needle));
    });
  }, [families.data, q, field]);
  const fieldsPresent = useMemo(() => FIELDS.filter((f) => (families.data ?? []).some((x) => x.field === f)), [families.data]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="ob-h">
      <div className="flex flex-col gap-1">
        <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold outline-none">{title}</h1>
        <p className="text-sm text-muted">{tr({ ar: 'نبني خطتك على البرنامج الرسمي لهذه المناظرة ونتابع إعلاناتها من أجلك.', fr: 'Votre plan suit le programme de ce concours, et nous surveillons ses annonces pour vous.' })}</p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" placeholder={tr({ ar: 'ابحث: ديوانة، حماية مدنية، تعليم…', fr: 'Rechercher : douane, protection civile, enseignement…' })} aria-label={tr({ ar: 'ابحث عن مناظرة', fr: 'Rechercher un concours' })} />
      </div>
      {fieldsPresent.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={tr({ ar: 'المجال', fr: 'Domaine' })}>
          <Chip selected={field == null} onToggle={() => setField(null)}>{tr({ ar: 'الكل', fr: 'Tous' })}</Chip>
          {fieldsPresent.map((f) => <Chip key={f} selected={field === f} onToggle={() => setField(field === f ? null : f)}>{tr(FIELD_LABELS[f])}</Chip>)}
        </div>
      )}
      {families.loading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : families.error ? (
        <ErrorState error={families.error} onRetry={families.reload} />
      ) : shown.length === 0 ? (
        <p className="rounded-xl bg-surface-2 p-4 text-center text-sm text-muted">{tr({ ar: 'لا توجد نتيجة. جرّب كلمة أخرى.', fr: 'Aucun résultat. Essayez un autre mot.' })}</p>
      ) : (
        <ul className="flex flex-col gap-2" role="radiogroup" aria-labelledby="ob-h">
          {shown.map((f) => (
            <li key={f.slug}>
              <ChoiceCard selected={selected === f.slug} onSelect={() => onSelect(f.slug)}>
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="font-bold leading-snug">{bi(locale, f.name_ar, f.name_fr)}</span>
                  <Badge tone="neutral">{tr(FIELD_LABELS[f.field])}</Badge>
                </span>
                <span className="text-xs text-muted">{bi(locale, f.organization.name_ar, f.organization.name_fr)}</span>
                {f.nextEdition && (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={EDITION_STATUS[f.nextEdition.status].tone}>{tr(EDITION_STATUS[f.nextEdition.status])}</Badge>
                    <EditionCountdown e={f.nextEdition} />
                    <ProvenanceBadge p={f.nextEdition} compact />
                  </span>
                )}
              </ChoiceCard>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StepProfile({ familySlug, positionSlug, form, setForm, channels, setChannels, isGuest, onNext, headingRef }: {
  familySlug: string; positionSlug: string | null; form: EligibilityForm; setForm: (f: EligibilityForm) => void;
  channels: NotificationChannel[]; setChannels: (c: NotificationChannel[]) => void; isGuest: boolean; onNext: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const tr = useT();
  const { locale } = useLocale();
  const [rows, setRows] = useState<EligibilityRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const profile = useMemo(() => eligibilityProfile(form), [form]);
  const hasData = !!(profile.birthDate || profile.diplomaLevel || profile.gender);

  // Immediate eligibility feedback (debounced), computed by the API on the concours' published conditions.
  useEffect(() => {
    if (!hasData) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = window.setTimeout(() => {
      api<EligibilityRow[]>('/catalog/eligibility', { body: { familySlug, ...(positionSlug ? { positionSlug } : {}), profile } })
        .then((r) => !cancelled && setRows(r))
        .catch(() => !cancelled && setRows(null))
        .finally(() => !cancelled && setChecking(false));
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [familySlug, positionSlug, profile, hasData]);

  const toggle = (c: NotificationChannel) => setChannels(channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c]);
  const shownRows = rows ? (positionSlug ? rows.filter((r) => r.positionSlug === positionSlug) : rows) : null;

  return (
    <section className="flex flex-col gap-5" aria-labelledby="ob-h">
      <div className="flex flex-col gap-1">
        <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold outline-none">{tr({ ar: 'ملفك كمترشح', fr: 'Votre profil de candidat' })}</h1>
        <p className="flex items-start gap-2 rounded-xl bg-info-soft p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <span>
            {tr({
              ar: 'لماذا نسألك؟ للتحقق فورًا من شروط الترشح (السن، الشهادة، الطول…) ولتنبيهك تلقائيًا عند نشر أي مناظرة أخرى تستوفي شروطها. معطياتك لا تُشارك مع أي طرف ويمكنك حذفها متى شئت.',
              fr: 'Pourquoi ? Pour vérifier tout de suite les conditions (âge, diplôme, taille…) et vous alerter automatiquement dès qu’un autre concours compatible est publié. Vos données ne sont jamais partagées et restent supprimables.',
            })}
          </span>
        </p>
      </div>

      <EligibilityFields value={form} onChange={setForm} idPrefix="ob" />

      <div className="flex flex-col gap-2" aria-live="polite">
        <h2 className="font-bold">{tr({ ar: 'هل تستوفي الشروط؟', fr: 'Remplissez-vous les conditions ?' })}</h2>
        {!hasData ? (
          <p className="text-sm text-muted">{tr({ ar: 'أدخل تاريخ ميلادك وشهادتك لنتحقق من شروط الترشح.', fr: 'Indiquez votre date de naissance et votre diplôme pour vérifier les conditions.' })}</p>
        ) : checking && !shownRows ? (
          <Skeleton className="h-24" />
        ) : shownRows && shownRows.length ? (
          <ul className={clsx('flex flex-col gap-2', checking && 'opacity-60')}>
            {shownRows.map((r) => (
              <li key={r.positionSlug} className="rounded-xl border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{bi(locale, r.title_ar, r.title_fr)}</p>
                  <span className="flex items-center gap-1.5"><EligibilityBadge status={r.result.status} /><ProvenanceBadge p={r.provenance} compact /></span>
                </div>
                <EligibilityChecks result={r.result} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{tr({ ar: 'لا توجد شروط منشورة لهذه المناظرة بعد — راجع البلاغ الرسمي عند صدوره.', fr: 'Pas encore de conditions publiées pour ce concours — consultez l’avis officiel.' })}</p>
        )}
        {shownRows?.some((r) => r.result.status === 'NOT_ELIGIBLE') && (
          <p className="text-sm text-muted">{tr({ ar: 'يمكنك مواصلة التحضير على كل حال، وسننبهك بالمناظرات الأخرى التي تناسب ملفك.', fr: 'Vous pouvez quand même vous préparer ; nous vous signalerons les autres concours compatibles.' })}</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-bold">{tr({ ar: 'تنبيهات المناظرات', fr: 'Alertes concours' })}</legend>
        <p className="-mt-1 text-sm text-muted">{tr({ ar: 'كيف نعلمك بالمناظرات الجديدة والآجال؟', fr: 'Comment vous prévenir des nouveaux concours et des échéances ?' })}</p>
        <div className="flex flex-wrap gap-2">
          <Chip selected onToggle={() => {}} icon={<BellRing className="size-4" aria-hidden />}>{tr({ ar: 'داخل التطبيق', fr: 'Dans l’app' })}</Chip>
          <Chip selected={channels.includes('PUSH')} onToggle={() => toggle('PUSH')} icon={<Smartphone className="size-4" aria-hidden />}>{tr({ ar: 'إشعارات الهاتف', fr: 'Push' })}</Chip>
          {!isGuest && <Chip selected={channels.includes('EMAIL')} onToggle={() => toggle('EMAIL')} icon={<Mail className="size-4" aria-hidden />}>{tr({ ar: 'البريد الإلكتروني', fr: 'E-mail' })}</Chip>}
        </div>
        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {tr({ ar: 'لا رسائل تسويقية: فقط المناظرات التي تناسبك وآجالها. يمكنك تغيير ذلك من «حسابي».', fr: 'Pas de marketing : uniquement les concours qui vous concernent et leurs échéances. Modifiable dans « Compte ».' })}
        </p>
      </fieldset>

      <Button size="lg" onClick={onNext}>{tr({ ar: 'التالي', fr: 'Suivant' })}</Button>
    </section>
  );
}

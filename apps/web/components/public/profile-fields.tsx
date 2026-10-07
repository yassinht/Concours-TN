'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiplomaLevel, Field as FieldCode, ProfileDTO } from '@ctn/shared';
import { Field, Input, Select } from '@/components/ui';
import { useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { DIPLOMA_LABELS, DIPLOMA_LEVELS, GENDER_LABELS, MARITAL_LABELS, tunisToday } from './labels';
import { track } from './track';

export interface ProfileForm {
  birthDate: string;
  gender: '' | 'M' | 'F';
  diplomaLevel: '' | DiplomaLevel;
  specialties: string;
  heightCm: string;
  maritalStatus: '' | 'SINGLE' | 'MARRIED' | 'OTHER';
}

export const EMPTY_PROFILE: ProfileForm = { birthDate: '', gender: '', diplomaLevel: '', specialties: '', heightCm: '', maritalStatus: '' };

/** The eligibility subset of ProfileInput (same shape as EligibilityInput.profile). */
export interface ProfilePayload {
  birthDate: string | null;
  gender: 'M' | 'F' | null;
  diplomaLevel: DiplomaLevel | null;
  specialties: string[];
  heightCm: number | null;
  maritalStatus: 'SINGLE' | 'MARRIED' | 'OTHER' | null;
}

export function fromProfileDTO(p: ProfileDTO): ProfileForm {
  return {
    birthDate: p.birthDate ?? '',
    gender: p.gender ?? '',
    diplomaLevel: p.diplomaLevel ?? '',
    specialties: p.specialties.join('، '),
    heightCm: p.heightCm != null ? String(p.heightCm) : '',
    maritalStatus: p.maritalStatus ?? '',
  };
}

export function toProfilePayload(f: ProfileForm): ProfilePayload {
  const h = Number.parseInt(f.heightCm, 10);
  return {
    birthDate: /^\d{4}-\d{2}-\d{2}$/.test(f.birthDate) ? f.birthDate : null,
    gender: f.gender || null,
    diplomaLevel: f.diplomaLevel || null,
    specialties: f.specialties.split(/[,،;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 80)).slice(0, 10),
    heightCm: Number.isFinite(h) && h >= 120 && h <= 230 ? h : null,
    maritalStatus: f.maritalStatus || null,
  };
}

/** Enough data for the alert engine to match anything (it needs a birth date or a diploma). */
export function hasCoreData(f: ProfileForm): boolean {
  return !!f.birthDate || !!f.diplomaLevel;
}

export function profileFormErrors(f: ProfileForm): Partial<Record<keyof ProfileForm, true>> {
  const e: Partial<Record<keyof ProfileForm, true>> = {};
  if (f.heightCm && toProfilePayload(f).heightCm == null) e.heightCm = true;
  if (f.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate)) e.birthDate = true;
  return e;
}

function yearsAgo(today: string, years: number): string {
  return `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
}

/**
 * Loads the saved profile when a session exists (never creates one).
 * Returns the profile once, so callers can prefill without overwriting what the visitor already typed.
 */
export function useSavedProfile(onLoaded: (p: ProfileDTO) => void) {
  const { me, loading } = useSession();
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const done = useRef(false);
  const cb = useRef(onLoaded);
  useEffect(() => {
    cb.current = onLoaded;
  });
  useEffect(() => {
    if (loading || !me || done.current) return;
    done.current = true;
    api<ProfileDTO>('/me/profile')
      .then((p) => {
        setProfile(p);
        cb.current(p);
      })
      .catch(() => {});
  }, [me, loading]);
  return profile;
}

/** Saves the eligibility profile and switches alerts on (creates a guest session when needed). */
export function useActivateAlerts() {
  const { ensureSession, refresh } = useSession();
  return useCallback(async (payload: ProfilePayload, opts: { alertFields?: FieldCode[]; from: string; familySlug?: string }) => {
    await ensureSession();
    const saved = await api<ProfileDTO>('/me/profile', {
      method: 'PUT',
      body: { ...payload, alertsEnabled: true, ...(opts.alertFields ? { alertFields: opts.alertFields } : {}) },
    });
    track('alerts_enabled', { from: opts.from, familySlug: opts.familySlug ?? null, fields: opts.alertFields?.length ?? 0 });
    refresh().catch(() => {});
    return saved;
  }, [ensureSession, refresh]);
}

/** Eligibility questions (birth date, gender, diploma, specialty, height, marital status). */
export function ProfileFields({ value, onChange, idPrefix, specialtySuggestions = [] }: {
  value: ProfileForm; onChange: (v: ProfileForm) => void; idPrefix: string; specialtySuggestions?: string[];
}) {
  const tr = useT();
  const today = tunisToday();
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => onChange({ ...value, [k]: v });
  const errors = profileFormErrors(value);
  const optional = tr({ ar: '(اختياري)', fr: '(facultatif)' });

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={tr({ ar: 'تاريخ الميلاد', fr: 'Date de naissance' })} htmlFor={`${idPrefix}-birth`} hint={tr({ ar: 'لحساب سنك في تاريخ آخر أجل للترشح', fr: 'Pour calculer votre âge à la date limite' })} error={errors.birthDate && tr({ ar: 'تاريخ غير صالح', fr: 'Date invalide' })}>
        <Input id={`${idPrefix}-birth`} type="date" min="1950-01-01" max={yearsAgo(today, 14)} value={value.birthDate} onChange={(e) => set('birthDate', e.target.value)} autoComplete="bday" className="user-invalid:border-danger" />
      </Field>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-semibold">{tr({ ar: 'الجنس', fr: 'Sexe' })}</legend>
        <div className="flex gap-2">
          {(['M', 'F'] as const).map((g) => (
            <label key={g} className="flex-1">
              <input type="radio" name={`${idPrefix}-gender`} value={g} checked={value.gender === g} onChange={() => set('gender', g)} className="peer sr-only" />
              <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-primary">
                {tr(GENDER_LABELS[g])}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={tr({ ar: 'أعلى شهادة متحصل عليها', fr: 'Diplôme le plus élevé' })} htmlFor={`${idPrefix}-diploma`}>
        <Select id={`${idPrefix}-diploma`} value={value.diplomaLevel} onChange={(e) => set('diplomaLevel', e.target.value as ProfileForm['diplomaLevel'])}>
          <option value="">{tr({ ar: '— اختر —', fr: '— Choisir —' })}</option>
          {DIPLOMA_LEVELS.map((d) => <option key={d} value={d}>{tr(DIPLOMA_LABELS[d])}</option>)}
        </Select>
      </Field>

      <Field label={<>{tr({ ar: 'الاختصاص', fr: 'Spécialité' })} <span className="font-normal text-muted">{optional}</span></>} htmlFor={`${idPrefix}-spec`} hint={tr({ ar: 'مثال: إعلامية، قانون، محاسبة — افصل بين الاختصاصات بفاصلة', fr: 'Ex. : informatique, droit, comptabilité — séparez par une virgule' })}>
        <Input id={`${idPrefix}-spec`} list={specialtySuggestions.length ? `${idPrefix}-spec-list` : undefined} value={value.specialties} onChange={(e) => set('specialties', e.target.value)} maxLength={400} dir="auto" />
        {specialtySuggestions.length > 0 && (
          <datalist id={`${idPrefix}-spec-list`}>
            {specialtySuggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
      </Field>

      <Field label={<>{tr({ ar: 'الطول بالصنتيمتر', fr: 'Taille en cm' })} <span className="font-normal text-muted">{optional}</span></>} htmlFor={`${idPrefix}-height`} hint={tr({ ar: 'شرط في بعض الأسلاك فقط (الأمن، الديوانة، الجيش…)', fr: 'Exigée par certains corps seulement (sécurité, douane, armée…)' })} error={errors.heightCm && tr({ ar: 'أدخل طولًا بين 120 و230 صم', fr: 'Entrez une taille entre 120 et 230 cm' })}>
        <Input id={`${idPrefix}-height`} type="number" inputMode="numeric" min={120} max={230} step={1} value={value.heightCm} onChange={(e) => set('heightCm', e.target.value)} placeholder="170" className="user-invalid:border-danger" />
      </Field>

      <Field label={<>{tr({ ar: 'الحالة المدنية', fr: 'Situation familiale' })} <span className="font-normal text-muted">{optional}</span></>} htmlFor={`${idPrefix}-marital`} hint={tr({ ar: 'بعض المناظرات تشترط العزوبية', fr: 'Certains concours exigent d’être célibataire' })}>
        <Select id={`${idPrefix}-marital`} value={value.maritalStatus} onChange={(e) => set('maritalStatus', e.target.value as ProfileForm['maritalStatus'])}>
          <option value="">{tr({ ar: '— اختر —', fr: '— Choisir —' })}</option>
          {(['SINGLE', 'MARRIED', 'OTHER'] as const).map((m) => <option key={m} value={m}>{tr(MARITAL_LABELS[m])}</option>)}
        </Select>
      </Field>
    </div>
  );
}

'use client';

import clsx from 'clsx';
import type { DiplomaLevel, Gender, ProfileDTO, ProfileInput } from '@ctn/shared';
import { DIPLOMA_LABELS, DIPLOMA_LEVELS, GOVERNORATES } from '@ctn/shared/dist/enums';
import { Field, Input, Select } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { GENDER_TEXT, GOVERNORATE_AR, MARITAL_TEXT, tunisToday } from './format';

/** The eligibility part of the profile, as edited in forms (strings, '' = unknown). */
export interface EligibilityForm {
  birthDate: string;
  gender: '' | Gender;
  diplomaLevel: '' | DiplomaLevel;
  specialties: string;
  heightCm: string;
  maritalStatus: '' | 'SINGLE' | 'MARRIED' | 'OTHER';
  governorate: string;
}

export const EMPTY_ELIGIBILITY: EligibilityForm = { birthDate: '', gender: '', diplomaLevel: '', specialties: '', heightCm: '', maritalStatus: '', governorate: '' };

export function formFromProfile(p: ProfileDTO): EligibilityForm {
  return {
    birthDate: p.birthDate ?? '',
    gender: p.gender ?? '',
    diplomaLevel: p.diplomaLevel ?? '',
    specialties: p.specialties.join(', '),
    heightCm: p.heightCm != null ? String(p.heightCm) : '',
    maritalStatus: p.maritalStatus ?? '',
    governorate: p.governorate ?? '',
  };
}

export type EligibilityPayload = Required<Pick<ProfileInput, 'birthDate' | 'gender' | 'diplomaLevel' | 'specialties' | 'heightCm' | 'maritalStatus' | 'governorate'>>;

export function formToPayload(f: EligibilityForm): EligibilityPayload {
  const h = Number.parseInt(f.heightCm, 10);
  return {
    birthDate: /^\d{4}-\d{2}-\d{2}$/.test(f.birthDate) ? f.birthDate : null,
    gender: f.gender || null,
    diplomaLevel: f.diplomaLevel || null,
    specialties: f.specialties.split(/[,،;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 80)).slice(0, 10),
    heightCm: Number.isFinite(h) && h >= 120 && h <= 230 ? h : null,
    maritalStatus: f.maritalStatus || null,
    governorate: f.governorate || null,
  };
}

/** The subset accepted by POST /catalog/eligibility (EligibilityInput.profile). */
export function eligibilityProfile(f: EligibilityForm) {
  const { birthDate, gender, diplomaLevel, specialties, heightCm, maritalStatus } = formToPayload(f);
  return { birthDate, gender, diplomaLevel, specialties, heightCm, maritalStatus };
}

export function formErrors(f: EligibilityForm): Partial<Record<keyof EligibilityForm, true>> {
  const e: Partial<Record<keyof EligibilityForm, true>> = {};
  if (f.heightCm && formToPayload(f).heightCm == null) e.heightCm = true;
  if (f.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate)) e.birthDate = true;
  return e;
}

/** Share of the matching criteria filled in (birth date, gender and diploma weigh the most). */
export function completeness(f: EligibilityForm): number {
  const parts: [boolean, number][] = [
    [!!f.birthDate, 25], [!!f.gender, 20], [!!f.diplomaLevel, 25], [!!f.specialties.trim(), 10],
    [!!f.governorate, 8], [!!f.heightCm, 6], [!!f.maritalStatus, 6],
  ];
  return parts.reduce((a, [ok, w]) => a + (ok ? w : 0), 0);
}

function yearsAgo(today: string, years: number): string {
  return `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
}

/** Eligibility questions: birth date, gender, diploma, specialty, governorate, height, marital status. */
export function EligibilityFields({ value, onChange, idPrefix, showOptional = true }: {
  value: EligibilityForm; onChange: (v: EligibilityForm) => void; idPrefix: string; showOptional?: boolean;
}) {
  const tr = useT();
  const { locale } = useLocale();
  const today = tunisToday();
  const set = <K extends keyof EligibilityForm>(k: K, v: EligibilityForm[K]) => onChange({ ...value, [k]: v });
  const errors = formErrors(value);
  const optional = <span className="font-normal text-muted">{tr({ ar: '(اختياري)', fr: '(facultatif)' })}</span>;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={tr({ ar: 'تاريخ الميلاد', fr: 'Date de naissance' })} htmlFor={`${idPrefix}-birth`} hint={tr({ ar: 'لحساب سنك في تاريخ آخر أجل للترشح', fr: 'Pour calculer votre âge à la date limite' })} error={errors.birthDate && tr({ ar: 'تاريخ غير صالح', fr: 'Date invalide' })}>
        <Input id={`${idPrefix}-birth`} name="bday" type="date" min="1950-01-01" max={yearsAgo(today, 14)} value={value.birthDate} onChange={(e) => set('birthDate', e.target.value)} autoComplete="bday" />
      </Field>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-semibold">{tr({ ar: 'الجنس', fr: 'Sexe' })}</legend>
        <div className="flex gap-2">
          {(['M', 'F'] as const).map((g) => (
            <label key={g} className="flex-1">
              <input type="radio" name={`${idPrefix}-gender`} value={g} checked={value.gender === g} onChange={() => set('gender', g)} className="peer sr-only" />
              <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-primary">
                {tr(GENDER_TEXT[g])}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={tr({ ar: 'أعلى شهادة متحصل عليها', fr: 'Diplôme le plus élevé' })} htmlFor={`${idPrefix}-diploma`}>
        <Select id={`${idPrefix}-diploma`} value={value.diplomaLevel} onChange={(e) => set('diplomaLevel', e.target.value as EligibilityForm['diplomaLevel'])}>
          <option value="">{tr({ ar: '— اختر —', fr: '— Choisir —' })}</option>
          {DIPLOMA_LEVELS.map((d) => <option key={d} value={d}>{tr(DIPLOMA_LABELS[d])}</option>)}
        </Select>
      </Field>

      <Field label={<>{tr({ ar: 'الاختصاص', fr: 'Spécialité' })} {optional}</>} htmlFor={`${idPrefix}-spec`} hint={tr({ ar: 'مثال: إعلامية، قانون، محاسبة — افصل بفاصلة', fr: 'Ex. : informatique, droit, comptabilité — séparez par une virgule' })}>
        <Input id={`${idPrefix}-spec`} value={value.specialties} onChange={(e) => set('specialties', e.target.value)} maxLength={400} dir="auto" autoComplete="off" />
      </Field>

      <Field label={<>{tr({ ar: 'الولاية', fr: 'Gouvernorat' })} {optional}</>} htmlFor={`${idPrefix}-gov`} hint={tr({ ar: 'بعض المناظرات جهوية أو تعطي أولوية لأبناء الجهة', fr: 'Certains concours sont régionaux' })}>
        <Select id={`${idPrefix}-gov`} value={value.governorate} onChange={(e) => set('governorate', e.target.value)} autoComplete="address-level1">
          <option value="">{tr({ ar: '— اختر —', fr: '— Choisir —' })}</option>
          {GOVERNORATES.map((g) => <option key={g} value={g}>{locale === 'ar' ? GOVERNORATE_AR[g] ?? g : g}</option>)}
        </Select>
      </Field>

      {showOptional && (
        <>
          <Field label={<>{tr({ ar: 'الطول بالصنتيمتر', fr: 'Taille en cm' })} {optional}</>} htmlFor={`${idPrefix}-height`} hint={tr({ ar: 'شرط في بعض الأسلاك فقط (الأمن، الديوانة، الجيش…)', fr: 'Exigée par certains corps (sécurité, douane, armée…)' })} error={errors.heightCm && tr({ ar: 'أدخل طولًا بين 120 و230 صم', fr: 'Entrez une taille entre 120 et 230 cm' })}>
            <Input id={`${idPrefix}-height`} type="number" inputMode="numeric" min={120} max={230} step={1} value={value.heightCm} onChange={(e) => set('heightCm', e.target.value)} placeholder="170" />
          </Field>

          <Field label={<>{tr({ ar: 'الحالة المدنية', fr: 'Situation familiale' })} {optional}</>} htmlFor={`${idPrefix}-marital`} hint={tr({ ar: 'بعض المناظرات تشترط العزوبية', fr: 'Certains concours exigent d’être célibataire' })}>
            <Select id={`${idPrefix}-marital`} value={value.maritalStatus} onChange={(e) => set('maritalStatus', e.target.value as EligibilityForm['maritalStatus'])}>
              <option value="">{tr({ ar: '— اختر —', fr: '— Choisir —' })}</option>
              {(['SINGLE', 'MARRIED', 'OTHER'] as const).map((m) => <option key={m} value={m}>{tr(MARITAL_TEXT[m])}</option>)}
            </Select>
          </Field>
        </>
      )}
    </div>
  );
}

/** "Profile 60 % complete" meter with the reason it matters. */
export function CompletenessMeter({ value, className }: { value: number; className?: string }) {
  const tr = useT();
  const tone = value >= 80 ? 'bg-success' : value >= 50 ? 'bg-warning' : 'bg-danger';
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{tr({ ar: 'اكتمال ملف الترشح', fr: 'Profil candidat complété' })}</span>
        <span className="font-bold tabular-nums">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={tr({ ar: 'اكتمال الملف', fr: 'Profil complété' })}>
        <div className={clsx('h-full rounded-full transition-[width]', tone)} style={{ width: `${value}%` }} />
      </div>
      {value < 100 && (
        <p className="text-xs text-muted">{tr({ ar: 'كلما اكتمل ملفك، كانت تنبيهات المناظرات أدق وقلّت الإشعارات غير المفيدة.', fr: 'Plus votre profil est complet, plus les alertes sont précises (et moins il y a de bruit).' })}</p>
      )}
    </div>
  );
}

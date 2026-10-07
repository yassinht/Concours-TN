'use client';

import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { api, ApiError } from '@/lib/api';
import { loc } from './labels';
import { readUtm, track } from './track';

const WILLINGNESS = ['0', '10', '20', '40', '60+'] as const;
type Willingness = (typeof WILLINGNESS)[number];

export interface WaitlistFamily { slug: string; name_ar: string; name_fr: string }

/** "Be among the first" — demand + willingness-to-pay capture (no fake testimonials). */
export function WaitlistForm({ families, defaultFamily }: { families: WaitlistFamily[]; defaultFamily?: string }) {
  const tr = useT();
  const { locale } = useLocale();
  const id = useId();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [familySlug, setFamilySlug] = useState(defaultFamily ?? '');
  const [willingness, setWillingness] = useState<Willingness | ''>('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanPhone = phone.replace(/\s+/g, '');
    if (!email.trim() && !cleanPhone) {
      setError(tr({ ar: 'أدخل بريدك الإلكتروني أو رقم هاتفك.', fr: 'Indiquez votre e-mail ou votre numéro de téléphone.' }));
      return;
    }
    if (cleanPhone && !/^\+?[0-9]{6,15}$/.test(cleanPhone)) {
      setError(tr({ ar: 'رقم الهاتف غير صالح.', fr: 'Numéro de téléphone invalide.' }));
      return;
    }
    setStatus('sending');
    try {
      const utm = readUtm();
      await api('/waitlist', {
        body: {
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(cleanPhone ? { phone: cleanPhone } : {}),
          ...(familySlug ? { familySlug } : {}),
          ...(willingness ? { willingness } : {}),
          ...(Object.keys(utm).length ? { utm } : {}),
        },
      });
      track('waitlist_join', { familySlug: familySlug || null, willingness: willingness || null });
      setStatus('done');
    } catch (err) {
      setStatus('idle');
      setError(
        err instanceof ApiError && err.status === 429
          ? tr({ ar: 'محاولات كثيرة. أعد المحاولة بعد قليل.', fr: 'Trop de tentatives. Réessayez dans un moment.' })
          : err instanceof ApiError && err.status === 400
            ? tr({ ar: 'تحقق من البريد الإلكتروني أو رقم الهاتف.', fr: 'Vérifiez l’e-mail ou le numéro de téléphone.' })
            : tr({ ar: 'تعذّر الإرسال. حاول مرة أخرى.', fr: 'Envoi impossible. Réessayez.' }),
      );
    }
  }

  if (status === 'done') {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-success/30 bg-success-soft p-5" role="status">
        <p className="flex items-center gap-2 font-bold text-success">
          <CheckCircle2 className="size-5" aria-hidden />
          {tr({ ar: 'شكرًا! أنت من الأوائل.', fr: 'Merci ! Vous faites partie des premiers.' })}
        </p>
        <p className="text-sm">
          {tr({
            ar: 'سنراسلك عند إضافة محتوى جديد لمناظرتك. في الأثناء، جرّب الاختبار التشخيصي المجاني.',
            fr: 'Nous vous écrirons quand du contenu sera ajouté pour votre concours. En attendant, essayez le test diagnostique gratuit.',
          })}
        </p>
        <Link href={familySlug ? `/diagnostic/${familySlug}` : '/#diagnostic'} className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline">
          {tr({ ar: 'ابدأ الاختبار التشخيصي', fr: 'Commencer le test diagnostique' })}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-describedby={`${id}-privacy`}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr({ ar: 'البريد الإلكتروني', fr: 'E-mail' })} htmlFor={`${id}-email`} hint={tr({ ar: 'أو رقم الهاتف — واحد منهما يكفي', fr: 'ou le téléphone — l’un des deux suffit' })}>
          <Input id={`${id}-email`} type="email" inputMode="email" autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.tn" className="text-start user-invalid:border-danger" />
        </Field>
        <Field label={tr({ ar: 'رقم الهاتف', fr: 'Téléphone' })} htmlFor={`${id}-phone`}>
          <Input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+216 XX XXX XXX" pattern="\+?[0-9 ]{6,20}" className="text-start user-invalid:border-danger" />
        </Field>
      </div>

      <Field label={tr({ ar: 'المناظرة التي تحضّر لها', fr: 'Le concours que vous préparez' })} htmlFor={`${id}-family`}>
        <Select id={`${id}-family`} value={familySlug} onChange={(e) => setFamilySlug(e.target.value)}>
          <option value="">{tr({ ar: '— اختر (اختياري) —', fr: '— Choisir (facultatif) —' })}</option>
          {families.map((f) => (
            <option key={f.slug} value={f.slug}>{loc(locale, f, 'name')}</option>
          ))}
        </Select>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold">{tr({ ar: 'كم أنت مستعد لدفعه شهريًا؟', fr: 'Combien seriez-vous prêt(e) à payer par mois ?' })}</legend>
        <div className="flex flex-wrap gap-2">
          {WILLINGNESS.map((w) => (
            <label key={w} className="relative">
              <input type="radio" name={`${id}-will`} value={w} checked={willingness === w} onChange={() => setWillingness(w)} className="peer sr-only" />
              <span className="inline-flex min-h-11 min-w-16 cursor-pointer items-center justify-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-primary">
                {w === '0' ? tr({ ar: '0 د.ت', fr: '0 DT' }) : tr({ ar: `${w} د.ت`, fr: `${w} DT` })}
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">{tr({ ar: 'سؤال اختياري يساعدنا على تحديد سعر عادل.', fr: 'Question facultative, pour fixer un prix juste.' })}</p>
      </fieldset>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p id={`${id}-privacy`} className="text-xs text-muted">
          {tr({ ar: 'نستعمل بياناتك فقط لإعلامك بالجديد، دون إشهار ودون مشاركتها مع أي طرف.', fr: 'Utilisé uniquement pour vous informer, sans publicité ni partage avec des tiers.' })}{' '}
          <Link href="/legal/privacy" className="underline">{tr({ ar: 'سياسة الخصوصية', fr: 'Confidentialité' })}</Link>
        </p>
        <Button type="submit" loading={status === 'sending'} className="shrink-0">
          {tr({ ar: 'سجّلني من الأوائل', fr: 'M’inscrire parmi les premiers' })}
        </Button>
      </div>
    </form>
  );
}

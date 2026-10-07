'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  BellRing, CalendarDays, Crown, FileDown, Gift, GraduationCap, HardDriveDownload, KeyRound, Languages, LogOut, MailCheck, Monitor, Moon,
  Palette, Save, Star, Sun, Trash2, UserRound, UserPlus,
} from 'lucide-react';
import type { ProfileDTO } from '@ctn/shared';
import { Alert, Badge, Button, ButtonLink, EmptyState, Field, Input, Modal, Select } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { formatDate, type Bi } from '@/lib/i18n';
import { PasswordInput } from '../auth/auth-ui';
import { ErrorState, PageHeader, Skeleton } from '../bits';
import { bi, errorText, tunisToday } from '../format';
import { AlertPreferences, PushControl, type AlertPrefs } from '../notification-settings';
import { CompletenessMeter, completeness, EligibilityFields, EMPTY_ELIGIBILITY, formErrors, formFromProfile, formToPayload, type EligibilityForm } from '../profile-fields';
import { readTheme, saveTheme, type ThemePref } from '../theme';
import { errorCode, useApi } from '../use-api';

interface EnrollmentRow {
  id: string; familySlug: string; familyName_ar: string; familyName_fr: string; positionSlug: string | null;
  positionTitle_ar: string | null; positionTitle_fr: string | null; targetExamDate: string | null; dailyMinutes: number; isPrimary: boolean;
}
interface FollowRow { familySlug: string; familyName_ar?: string; familyName_fr?: string }

type Feedback = { tone: 'success' | 'danger'; text: Bi } | null;

function Section({ id, title, icon, children, description }: { id: string; title: ReactNode; icon: ReactNode; children: ReactNode; description?: ReactNode }) {
  return (
    <section id={id} className="card flex scroll-mt-20 flex-col gap-4 p-4 sm:p-5" aria-labelledby={`${id}-h`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-h`} className="flex items-center gap-2 text-lg font-bold">{icon}{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function FeedbackLine({ f }: { f: Feedback }) {
  const tr = useT();
  if (!f) return null;
  return <p className={clsx('text-sm font-semibold', f.tone === 'success' ? 'text-success' : 'text-danger')} role={f.tone === 'danger' ? 'alert' : 'status'}>{tr(f.text)}</p>;
}

export function ProfileView({ emailUnsubscribed }: { emailUnsubscribed?: '0' | '1' }) {
  const tr = useT();
  const { locale, setLocale } = useLocale();
  const { me, refresh, logout } = useSession();
  const ready = !!me;
  const isGuest = !me || me.isGuest;
  const profile = useApi<ProfileDTO>(ready ? '/me/profile' : null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [form, setForm] = useState<EligibilityForm>(EMPTY_ELIGIBILITY);
  const [prefs, setPrefs] = useState<AlertPrefs>({ alertsEnabled: true, alertFields: [], alertChannels: ['IN_APP', 'PUSH', 'EMAIL'], dailyReminderHour: null });
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [infoFeedback, setInfoFeedback] = useState<Feedback>(null);
  const [prefsFeedback, setPrefsFeedback] = useState<Feedback>(null);

  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    setName(p.name ?? '');
    setPhone(p.phone ?? '');
    setForm(formFromProfile(p));
    setPrefs({ alertsEnabled: p.alertsEnabled, alertFields: p.alertFields, alertChannels: p.alertChannels, dailyReminderHour: p.dailyReminderHour });
  }, [profile.data]);

  // Deep links (#alerts, #eligibility…) once the content exists.
  useEffect(() => {
    if (!profile.data || !window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [profile.data]);

  async function saveInfo(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(formErrors(form)).length) {
      setInfoFeedback({ tone: 'danger', text: { ar: 'صحّح الخانات المشار إليها.', fr: 'Corrigez les champs signalés.' } });
      return;
    }
    setSavingInfo(true);
    setInfoFeedback(null);
    try {
      const p = await api<ProfileDTO>('/me/profile', {
        method: 'PUT',
        body: { ...(name.trim() ? { name: name.trim() } : {}), phone: phone.trim() || null, ...formToPayload(form) },
      });
      profile.setData(p);
      setInfoFeedback({ tone: 'success', text: { ar: 'تم الحفظ. أعدنا مطابقة ملفك مع المناظرات المفتوحة.', fr: 'Enregistré. Votre profil a été recomparé aux concours ouverts.' } });
      void refresh();
    } catch (err) {
      setInfoFeedback({ tone: 'danger', text: errorText(errorCode(err)) });
    } finally {
      setSavingInfo(false);
    }
  }

  async function savePrefs() {
    setSavingPrefs(true);
    setPrefsFeedback(null);
    try {
      const channels = prefs.alertChannels.includes('IN_APP') ? prefs.alertChannels : ['IN_APP' as const, ...prefs.alertChannels];
      const p = await api<ProfileDTO>('/me/profile', {
        method: 'PUT',
        body: { alertsEnabled: prefs.alertsEnabled, alertFields: prefs.alertFields, alertChannels: channels, dailyReminderHour: prefs.dailyReminderHour },
      });
      profile.setData(p);
      setPrefsFeedback({ tone: 'success', text: { ar: 'تم حفظ إعدادات التنبيهات.', fr: 'Réglages des alertes enregistrés.' } });
    } catch (err) {
      setPrefsFeedback({ tone: 'danger', text: errorText(errorCode(err)) });
    } finally {
      setSavingPrefs(false);
    }
  }

  if (!me || profile.loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (profile.error) return <ErrorState error={profile.error} onRetry={profile.reload} />;

  const pct = completeness(form);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={tr({ ar: 'حسابي', fr: 'Mon compte' })} />

      {emailUnsubscribed === '1' && <Alert tone="success">{tr({ ar: 'تم إيقاف رسائل التنبيه بالبريد. يمكنك إعادة تفعيلها من «كيف تصلك التنبيهات».', fr: 'Alertes par e-mail désactivées. Réactivez-les dans « Comment recevoir les alertes ».' })}</Alert>}
      {emailUnsubscribed === '0' && <Alert tone="warning">{tr({ ar: 'رابط إلغاء الاشتراك غير صالح. عدّل القنوات أدناه.', fr: 'Lien de désinscription invalide. Modifiez les canaux ci-dessous.' })}</Alert>}

      <AccountCard />

      <Section id="eligibility" icon={<UserRound className="size-5 text-primary" aria-hidden />} title={tr({ ar: 'ملفي كمترشح', fr: 'Mon profil candidat' })}
        description={tr({ ar: 'تُستعمل هذه المعطيات فقط للتحقق من شروط الترشح ولتنبيهك بالمناظرات التي تناسبك.', fr: 'Ces données servent uniquement à vérifier les conditions et à vous alerter des concours qui vous correspondent.' })}>
        <CompletenessMeter value={pct} />
        <form onSubmit={saveInfo} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr({ ar: 'الاسم', fr: 'Nom' })} htmlFor="pf-name">
              <Input id="pf-name" name="name" autoComplete="name" maxLength={120} dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={<>{tr({ ar: 'الهاتف', fr: 'Téléphone' })} <span className="font-normal text-muted">{tr({ ar: '(اختياري)', fr: '(facultatif)' })}</span></>} htmlFor="pf-phone" hint={tr({ ar: 'لتسهيل التواصل عند الدفع اليدوي فقط', fr: 'Uniquement pour faciliter les paiements manuels' })}>
              <Input id="pf-phone" name="tel" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+216 …" />
            </Field>
          </div>
          <EligibilityFields value={form} onChange={setForm} idPrefix="pf" />
          <FeedbackLine f={infoFeedback} />
          <Button type="submit" loading={savingInfo} className="self-start"><Save className="size-4" aria-hidden />{tr({ ar: 'حفظ', fr: 'Enregistrer' })}</Button>
        </form>
      </Section>

      <Section id="alerts" icon={<BellRing className="size-5 text-primary" aria-hidden />} title={tr({ ar: 'التنبيهات والإشعارات', fr: 'Alertes et notifications' })}>
        <AlertPreferences value={prefs} onChange={setPrefs} isGuest={isGuest} idPrefix="pf" />
        <FeedbackLine f={prefsFeedback} />
        <Button onClick={savePrefs} loading={savingPrefs} className="self-start"><Save className="size-4" aria-hidden />{tr({ ar: 'حفظ الإعدادات', fr: 'Enregistrer les réglages' })}</Button>
        <PushControl />
        {!isGuest && prefs.alertChannels.includes('EMAIL') && <EmailVerification />}
        <Link href="/app/alerts" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">{tr({ ar: 'عرض المناظرات التي تناسبني', fr: 'Voir les concours qui me correspondent' })}</Link>
      </Section>

      <EnrollmentsSection />
      <FollowsSection />

      <Section id="appearance" icon={<Palette className="size-5 text-primary" aria-hidden />} title={tr({ ar: 'المظهر واللغة', fr: 'Apparence et langue' })}>
        <ThemeChooser />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{tr({ ar: 'اللغة', fr: 'Langue' })}</p>
          <div className="flex gap-2">
            {(['ar', 'fr'] as const).map((l) => (
              <button key={l} type="button" lang={l} onClick={() => l !== locale && setLocale(l)} aria-pressed={locale === l}
                className={clsx('inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold', locale === l ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-surface-2')}>
                <Languages className="size-4" aria-hidden />{l === 'ar' ? 'العربية' : 'Français'}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <nav aria-label={tr({ ar: 'روابط الحساب', fr: 'Liens du compte' })} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ButtonLink href="/app/billing" variant="secondary" className="min-h-12 justify-start"><Crown className="size-4 text-accent" aria-hidden />{tr({ ar: 'الاشتراك والفواتير', fr: 'Abonnement et paiements' })}</ButtonLink>
        <ButtonLink href="/app/referral" variant="secondary" className="min-h-12 justify-start"><Gift className="size-4 text-accent" aria-hidden />{tr({ ar: 'ادعُ أصدقاءك', fr: 'Parrainer des amis' })}</ButtonLink>
        <ButtonLink href="/app/offline" variant="secondary" className="min-h-12 justify-start"><HardDriveDownload className="size-4 text-primary" aria-hidden />{tr({ ar: 'المحتوى دون اتصال', fr: 'Contenu hors ligne' })}</ButtonLink>
      </nav>

      {!isGuest && <PasswordSection />}
      {!isGuest && <DataSection />}

      {!isGuest && (
        <Button variant="ghost" onClick={() => logout()} className="self-center text-danger">
          <LogOut className="size-4" aria-hidden />
          {tr({ ar: 'تسجيل الخروج', fr: 'Se déconnecter' })}
        </Button>
      )}
    </div>
  );
}

function AccountCard() {
  const tr = useT();
  const { locale } = useLocale();
  const { me } = useSession();
  if (!me) return null;
  if (me.isGuest) {
    return (
      <div className="card flex flex-col gap-3 border-primary/40 p-4">
        <p className="flex items-center gap-2 font-bold"><UserRound className="size-5 text-primary" aria-hidden />{tr({ ar: 'أنت تستعمل التطبيق كزائر', fr: 'Vous utilisez l’app en invité' })}</p>
        <p className="text-sm text-muted">{tr({ ar: 'تقدمك محفوظ على هذا الجهاز فقط. أنشئ حسابًا مجانيًا لحفظه، لاستقبال التنبيهات بالبريد ولاستعماله على كل أجهزتك.', fr: 'Votre progression n’est liée qu’à cet appareil. Créez un compte gratuit pour la sauvegarder, recevoir les alertes par e-mail et la retrouver partout.' })}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/register?next=/app/profile"><UserPlus className="size-4" aria-hidden />{tr({ ar: 'إنشاء حساب', fr: 'Créer un compte' })}</ButtonLink>
          <ButtonLink href="/login?next=/app/profile" variant="secondary">{tr({ ar: 'لدي حساب', fr: 'J’ai déjà un compte' })}</ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-contrast" aria-hidden>
        {(me.name ?? me.email ?? '?').trim().charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate font-bold" dir="auto">{me.name}</p>
        <p className="truncate text-sm text-muted" dir="ltr">{me.email}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        {me.premium.active ? (
          <Badge tone="accent"><Crown className="size-3.5" aria-hidden />{tr({ ar: 'بريميوم', fr: 'Premium' })}</Badge>
        ) : (
          <Badge tone="neutral">{tr({ ar: 'مجاني', fr: 'Gratuit' })}</Badge>
        )}
        {me.premium.active && me.premium.endsAt && <span className="text-xs text-muted">{tr({ ar: 'حتى', fr: 'jusqu’au' })} {formatDate(locale, me.premium.endsAt)}</span>}
        <span className="inline-flex items-center gap-1 text-xs text-muted"><Star className="size-3 text-warning" aria-hidden />{tr({ ar: `مستوى ${me.stats.level} · ${me.stats.xp} XP`, fr: `Niv. ${me.stats.level} · ${me.stats.xp} XP` })}</span>
      </div>
    </div>
  );
}

function EmailVerification() {
  const tr = useT();
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'verified' | 'error'>('idle');
  const [devLink, setDevLink] = useState<string | undefined>();
  async function resend() {
    setState('busy');
    try {
      const r = await api<{ ok: true; alreadyVerified?: boolean; devLink?: string }>('/auth/verify/resend', { method: 'POST', body: {} });
      setDevLink(r.devLink);
      setState(r.alreadyVerified ? 'verified' : 'sent');
    } catch {
      setState('error');
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm" aria-live="polite">
      <p className="flex items-center gap-2 font-semibold"><MailCheck className="size-4" aria-hidden />{tr({ ar: 'تنبيهات البريد تتطلب بريدًا مؤكدًا', fr: 'Les alertes e-mail nécessitent une adresse confirmée' })}</p>
      {state === 'verified' ? (
        <p className="text-success">{tr({ ar: 'بريدك مؤكد ✓', fr: 'Votre adresse est confirmée ✓' })}</p>
      ) : state === 'sent' ? (
        <p className="text-success">{tr({ ar: 'أرسلنا رابط التأكيد إلى بريدك.', fr: 'Lien de confirmation envoyé.' })}{devLink && <> <a href={devLink} className="break-all underline" dir="ltr">{devLink}</a></>}</p>
      ) : (
        <>
          <p className="text-muted">{tr({ ar: 'لم يصلك رابط التأكيد أو انتهت صلاحيته؟', fr: 'Pas reçu le lien de confirmation, ou expiré ?' })}</p>
          <Button size="sm" variant="secondary" onClick={resend} loading={state === 'busy'} className="min-h-11 self-start">{tr({ ar: 'أعد إرسال رابط التأكيد', fr: 'Renvoyer le lien' })}</Button>
          {state === 'error' && <p className="text-danger" role="alert">{tr({ ar: 'تعذّر الإرسال، حاول لاحقًا.', fr: 'Envoi impossible, réessayez plus tard.' })}</p>}
        </>
      )}
    </div>
  );
}

const MINUTE_OPTIONS = [10, 15, 20, 30, 45, 60, 90, 120];

function EnrollmentsSection() {
  const tr = useT();
  const { locale } = useLocale();
  const { refresh } = useSession();
  const list = useApi<EnrollmentRow[]>('/me/enrollments');
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EnrollmentRow | null>(null);
  const [error, setError] = useState<Bi | null>(null);

  async function patch(e: EnrollmentRow, body: Partial<Pick<EnrollmentRow, 'dailyMinutes' | 'targetExamDate' | 'isPrimary'>>) {
    setBusy(e.id);
    setError(null);
    try {
      await api(`/me/enrollments/${e.id}`, { method: 'PATCH', body });
      await list.reload();
      if (body.isPrimary) void refresh();
    } catch (err) {
      setError(errorText(errorCode(err)));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!removing) return;
    const e = removing;
    setBusy(e.id);
    try {
      await api(`/me/enrollments/${e.id}`, { method: 'DELETE' });
      setRemoving(null);
      await list.reload();
      void refresh();
    } catch (err) {
      setError(errorText(errorCode(err)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section id="enrollments" icon={<GraduationCap className="size-5 text-primary" aria-hidden />} title={tr({ ar: 'مناظراتي', fr: 'Mes concours' })}
      description={tr({ ar: 'المناظرة الرئيسية تحدد خطة اليوم والعد التنازلي.', fr: 'Le concours principal détermine le plan du jour et le compte à rebours.' })}>
      {error && <Alert tone="danger">{tr(error)}</Alert>}
      {list.loading ? <Skeleton className="h-28" /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? (
        <EmptyState title={tr({ ar: 'لم تختر أي مناظرة بعد', fr: 'Aucun concours choisi' })} action={<ButtonLink href="/app/onboarding">{tr({ ar: 'اختر مناظرة', fr: 'Choisir un concours' })}</ButtonLink>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.map((e) => (
            <li key={e.id} className={clsx('flex flex-col gap-3 rounded-xl border p-3', e.isPrimary ? 'border-primary' : 'border-border')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col">
                  <Link href={`/concours/${encodeURIComponent(e.familySlug)}`} className="font-bold hover:underline">{bi(locale, e.familyName_ar, e.familyName_fr)}</Link>
                  {e.positionSlug && <span className="text-sm text-muted">{bi(locale, e.positionTitle_ar, e.positionTitle_fr)}</span>}
                </div>
                {e.isPrimary ? (
                  <Badge tone="primary"><Star className="size-3.5" aria-hidden />{tr({ ar: 'الرئيسية', fr: 'Principal' })}</Badge>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => patch(e, { isPrimary: true })} loading={busy === e.id} className="min-h-11">{tr({ ar: 'اجعلها الرئيسية', fr: 'Définir comme principal' })}</Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr({ ar: 'الوقت اليومي', fr: 'Temps par jour' })} htmlFor={`en-min-${e.id}`}>
                  <Select id={`en-min-${e.id}`} value={String(e.dailyMinutes)} disabled={busy === e.id} onChange={(ev) => patch(e, { dailyMinutes: Number(ev.target.value) })}>
                    {[...new Set([...MINUTE_OPTIONS, e.dailyMinutes])].sort((a, b) => a - b).map((m) => (
                      <option key={m} value={m}>{tr({ ar: `${m} دقيقة`, fr: `${m} min` })}</option>
                    ))}
                  </Select>
                </Field>
                <ExamDateField e={e} disabled={busy === e.id} onSave={(d) => patch(e, { targetExamDate: d })} />
              </div>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(e)} className="min-h-11 self-start text-danger"><Trash2 className="size-4" aria-hidden />{tr({ ar: 'إزالة', fr: 'Retirer' })}</Button>
            </li>
          ))}
        </ul>
      )}
      <ButtonLink href="/app/onboarding" variant="secondary" className="self-start">{tr({ ar: '+ أضف مناظرة', fr: '+ Ajouter un concours' })}</ButtonLink>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={tr({ ar: 'إزالة المناظرة؟', fr: 'Retirer ce concours ?' })}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">{tr({ ar: 'ستُحذف خطتك اليومية لهذه المناظرة. إجاباتك وتقدمك يبقيان محفوظين.', fr: 'Le plan quotidien de ce concours sera supprimé. Vos réponses et votre progression sont conservées.' })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoving(null)}>{tr({ ar: 'إلغاء', fr: 'Annuler' })}</Button>
            <Button variant="danger" onClick={remove} loading={!!removing && busy === removing.id}>{tr({ ar: 'إزالة', fr: 'Retirer' })}</Button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}

function ExamDateField({ e, disabled, onSave }: { e: EnrollmentRow; disabled: boolean; onSave: (d: string | null) => void }) {
  const tr = useT();
  const [v, setV] = useState(e.targetExamDate ?? '');
  useEffect(() => setV(e.targetExamDate ?? ''), [e.targetExamDate]);
  const dirty = v !== (e.targetExamDate ?? '');
  return (
    <Field label={<span className="inline-flex items-center gap-1"><CalendarDays className="size-4" aria-hidden />{tr({ ar: 'تاريخ الامتحان المستهدف', fr: 'Date d’examen visée' })}</span>} htmlFor={`en-date-${e.id}`}>
      <div className="flex gap-2">
        <Input id={`en-date-${e.id}`} type="date" min={tunisToday()} value={v} disabled={disabled} onChange={(ev) => setV(ev.target.value)} />
        {dirty && <Button size="sm" onClick={() => onSave(v || null)} className="h-11 shrink-0">{tr({ ar: 'حفظ', fr: 'OK' })}</Button>}
      </div>
    </Field>
  );
}

function FollowsSection() {
  const tr = useT();
  const { locale } = useLocale();
  const follows = useApi<FollowRow[]>('/me/follows');
  const [busy, setBusy] = useState<string | null>(null);
  async function unfollow(slug: string) {
    setBusy(slug);
    try {
      await api(`/me/follows/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      follows.setData((prev) => (prev ?? []).filter((f) => f.familySlug !== slug));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Section id="follows" icon={<BellRing className="size-5 text-primary" aria-hidden />} title={tr({ ar: 'مناظرات أتابعها', fr: 'Concours suivis' })}
      description={tr({ ar: 'تصلك تنبيهات دوراتها الجديدة وتذكيرات آجالها، أيًا كانت المجالات المختارة.', fr: 'Vous êtes prévenu de leurs nouvelles sessions et échéances, quels que soient vos domaines.' })}>
      {follows.loading ? <Skeleton className="h-16" /> : follows.error ? <ErrorState error={follows.error} onRetry={follows.reload} /> : !follows.data?.length ? (
        <p className="text-sm text-muted">
          {tr({ ar: 'لا تتابع أي مناظرة بعد.', fr: 'Vous ne suivez aucun concours.' })}{' '}
          <Link href="/app/alerts" className="font-semibold text-primary underline">{tr({ ar: 'اكتشف ما يناسبك', fr: 'Découvrir ceux qui vous correspondent' })}</Link>
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {follows.data.map((f) => (
            <li key={f.familySlug} className="flex items-center justify-between gap-2 py-2">
              <Link href={`/concours/${encodeURIComponent(f.familySlug)}`} className="min-w-0 truncate font-semibold hover:underline">{bi(locale, f.familyName_ar ?? f.familySlug, f.familyName_fr ?? f.familySlug)}</Link>
              <Button size="sm" variant="ghost" onClick={() => unfollow(f.familySlug)} loading={busy === f.familySlug} className="min-h-11 shrink-0">{tr({ ar: 'إلغاء المتابعة', fr: 'Ne plus suivre' })}</Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ThemeChooser() {
  const tr = useT();
  const [theme, setTheme] = useState<ThemePref>('system');
  useEffect(() => setTheme(readTheme()), []);
  const options: { v: ThemePref; icon: typeof Sun; label: Bi }[] = [
    { v: 'system', icon: Monitor, label: { ar: 'تلقائي', fr: 'Système' } },
    { v: 'light', icon: Sun, label: { ar: 'فاتح', fr: 'Clair' } },
    { v: 'dark', icon: Moon, label: { ar: 'داكن', fr: 'Sombre' } },
  ];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold" id="theme-label">{tr({ ar: 'المظهر', fr: 'Thème' })}</p>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="theme-label">
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button key={o.v} type="button" role="radio" aria-checked={theme === o.v} onClick={() => { saveTheme(o.v); setTheme(o.v); }}
              className={clsx('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2 text-sm font-semibold', theme === o.v ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-surface-2')}>
              <Icon className="size-4" aria-hidden />{tr(o.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PasswordSection() {
  const tr = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      setFeedback({ tone: 'danger', text: { ar: 'كلمة المرور الجديدة: 8 أحرف على الأقل.', fr: 'Nouveau mot de passe : 8 caractères minimum.' } });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await api('/auth/password/change', { body: { ...(current ? { currentPassword: current } : {}), newPassword: next } });
      setCurrent('');
      setNext('');
      setFeedback({ tone: 'success', text: { ar: 'تم تغيير كلمة المرور.', fr: 'Mot de passe modifié.' } });
    } catch (err) {
      const code = errorCode(err);
      setFeedback({ tone: 'danger', text: code === 'INVALID_CREDENTIALS' ? { ar: 'كلمة المرور الحالية غير صحيحة.', fr: 'Mot de passe actuel incorrect.' } : errorText(code) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section id="security" icon={<KeyRound className="size-5 text-primary" aria-hidden />} title={tr({ ar: 'كلمة المرور', fr: 'Mot de passe' })}
      description={tr({ ar: 'إذا كنت تدخل عبر Google أو رابط البريد، اترك الخانة الأولى فارغة لإنشاء كلمة مرور.', fr: 'Connexion via Google ou lien e-mail ? Laissez le premier champ vide pour créer un mot de passe.' })}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={tr({ ar: 'كلمة المرور الحالية', fr: 'Mot de passe actuel' })} htmlFor="current-password">
          <PasswordInput id="current-password" name="current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label={tr({ ar: 'كلمة المرور الجديدة', fr: 'Nouveau mot de passe' })} htmlFor="new-password" hint={tr({ ar: '8 أحرف على الأقل', fr: '8 caractères minimum' })}>
          <PasswordInput id="new-password" name="new-password" autoComplete="new-password" required minLength={8} maxLength={200} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <FeedbackLine f={feedback} />
          <Button type="submit" variant="secondary" loading={busy} className="self-start">{tr({ ar: 'تغيير كلمة المرور', fr: 'Changer le mot de passe' })}</Button>
        </div>
      </form>
    </Section>
  );
}

function DataSection() {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bi | null>(null);
  async function del() {
    setBusy(true);
    setError(null);
    try {
      await api('/me', { method: 'DELETE', body: { confirm: 'DELETE' } });
      window.location.href = '/';
    } catch (err) {
      setError(errorText(errorCode(err)));
      setBusy(false);
    }
  }
  return (
    <Section id="data" icon={<FileDown className="size-5 text-primary" aria-hidden />} title={tr({ ar: 'معطياتي الشخصية', fr: 'Mes données personnelles' })}
      description={tr({ ar: 'حق النفاذ والحذف (القانون الأساسي عدد 63 لسنة 2004 المتعلق بحماية المعطيات الشخصية).', fr: 'Droits d’accès et de suppression (loi organique n° 2004-63 sur la protection des données personnelles).' })}>
      <div className="flex flex-wrap gap-2">
        <a href="/api/me/export" download className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-[15px] font-semibold hover:bg-surface-2">
          <FileDown className="size-4" aria-hidden />
          {tr({ ar: 'تنزيل نسخة من معطياتي (JSON)', fr: 'Télécharger mes données (JSON)' })}
        </a>
        <Button variant="ghost" onClick={() => setOpen(true)} className="text-danger"><Trash2 className="size-4" aria-hidden />{tr({ ar: 'حذف حسابي', fr: 'Supprimer mon compte' })}</Button>
      </div>
      <Modal open={open} onClose={() => { setOpen(false); setConfirm(''); }} title={tr({ ar: 'حذف الحساب نهائيًا', fr: 'Supprimer définitivement le compte' })}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">{tr({ ar: 'سيُحذف حسابك وتُجهَّل معطياتك: التقدم، التنبيهات، الاشتراك الجاري (دون استرجاع). لا يمكن التراجع.', fr: 'Votre compte sera supprimé et vos données anonymisées : progression, alertes, abonnement en cours (sans remboursement). Action irréversible.' })}</p>
          <Field label={tr({ ar: 'اكتب DELETE للتأكيد', fr: 'Tapez DELETE pour confirmer' })} htmlFor="del-confirm">
            <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} dir="ltr" />
          </Field>
          {error && <Alert tone="danger">{tr(error)}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setConfirm(''); }}>{tr({ ar: 'إلغاء', fr: 'Annuler' })}</Button>
            <Button variant="danger" disabled={confirm.trim() !== 'DELETE'} loading={busy} onClick={del}><Trash2 className="size-4" aria-hidden />{tr({ ar: 'حذف نهائي', fr: 'Supprimer' })}</Button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}

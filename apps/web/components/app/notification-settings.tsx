'use client';

import { useEffect, useState } from 'react';
import { BellOff, BellRing, Check, Download, Mail, Send, Smartphone, SquareArrowOutUpRight } from 'lucide-react';
import type { Field as FieldCode, NotificationChannel } from '@ctn/shared';
import { FIELD_LABELS, FIELDS } from '@ctn/shared/dist/enums';
import { Button, Field, Select } from '@/components/ui';
import { useLocale, useT } from '@/components/providers';
import { disablePush, enablePush, isIos, pushStatus, sendTestPush, type PushStatus } from '@/lib/push';
import type { Bi } from '@/lib/i18n';
import { Chip, Switch } from './bits';
import { useInstallPrompt } from './install';
import { track } from './use-api';

export interface AlertPrefs {
  alertsEnabled: boolean;
  alertFields: FieldCode[];
  alertChannels: NotificationChannel[];
  dailyReminderHour: number | null;
}

const CHANNELS: { code: NotificationChannel; label: Bi; hint: Bi; icon: typeof BellRing }[] = [
  { code: 'IN_APP', label: { ar: 'داخل التطبيق', fr: 'Dans l’app' }, hint: { ar: 'دائمًا في صندوق الإشعارات', fr: 'Toujours dans la boîte de réception' }, icon: BellRing },
  { code: 'PUSH', label: { ar: 'إشعارات الهاتف', fr: 'Notifications push' }, hint: { ar: 'حتى والتطبيق مغلق', fr: 'Même app fermée' }, icon: Smartphone },
  { code: 'EMAIL', label: { ar: 'البريد الإلكتروني', fr: 'E-mail' }, hint: { ar: 'يتطلب حسابًا وبريدًا مؤكدًا', fr: 'Compte avec e-mail confirmé requis' }, icon: Mail },
];

/** Alert preferences: on/off, fields of interest, channels and the daily study reminder hour. */
export function AlertPreferences({ value, onChange, isGuest, idPrefix }: { value: AlertPrefs; onChange: (v: AlertPrefs) => void; isGuest: boolean; idPrefix: string }) {
  const tr = useT();
  const set = <K extends keyof AlertPrefs>(k: K, v: AlertPrefs[K]) => onChange({ ...value, [k]: v });
  const toggleField = (f: FieldCode) => set('alertFields', value.alertFields.includes(f) ? value.alertFields.filter((x) => x !== f) : [...value.alertFields, f]);
  const toggleChannel = (c: NotificationChannel) => {
    if (c === 'IN_APP') return; // the inbox always receives alerts
    set('alertChannels', value.alertChannels.includes(c) ? value.alertChannels.filter((x) => x !== c) : [...value.alertChannels, c]);
  };
  const channels = value.alertChannels.includes('IN_APP') ? value.alertChannels : (['IN_APP', ...value.alertChannels] as NotificationChannel[]);

  return (
    <div className="flex flex-col gap-5">
      <Switch
        id={`${idPrefix}-alerts`}
        checked={value.alertsEnabled}
        onChange={(v) => set('alertsEnabled', v)}
        label={tr({ ar: 'نبّهني عند نشر مناظرة تناسب ملفي', fr: 'M’alerter quand un concours correspond à mon profil' })}
        description={tr({
          ar: 'نقارن كل مناظرة جديدة بشروطها المعلنة (السن، الشهادة، الاختصاص…) ونرسل لك تنبيهًا ثم تذكيرًا قبل آخر أجل.',
          fr: 'Chaque nouveau concours est comparé à ses conditions (âge, diplôme, spécialité…) : alerte, puis rappel avant la clôture.',
        })}
      />

      <fieldset className="flex flex-col gap-2" disabled={!value.alertsEnabled}>
        <legend className="mb-1 text-sm font-semibold">{tr({ ar: 'المجالات التي تهمني', fr: 'Domaines qui m’intéressent' })}</legend>
        <p className="-mt-1 text-xs text-muted">
          {value.alertFields.length === 0
            ? tr({ ar: 'لم تختر أي مجال: سننبهك بكل مناظرة تستوفي شروطها.', fr: 'Aucun domaine choisi : vous serez alerté pour tout concours dont vous remplissez les conditions.' })
            : tr({ ar: 'تنبيهات المجالات المختارة فقط، إضافة إلى المناظرات التي تتابعها.', fr: 'Alertes des domaines choisis uniquement, plus les concours que vous suivez.' })}
        </p>
        <div className={`flex flex-wrap gap-2 ${value.alertsEnabled ? '' : 'opacity-50'}`}>
          {FIELDS.map((f) => (
            <Chip key={f} selected={value.alertFields.includes(f)} onToggle={() => toggleField(f)} icon={value.alertFields.includes(f) ? <Check className="size-3.5" aria-hidden /> : undefined}>
              {tr(FIELD_LABELS[f])}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={!value.alertsEnabled}>
        <legend className="mb-1 text-sm font-semibold">{tr({ ar: 'كيف تصلك التنبيهات', fr: 'Comment recevoir les alertes' })}</legend>
        <div className={`grid gap-2 sm:grid-cols-3 ${value.alertsEnabled ? '' : 'opacity-50'}`}>
          {CHANNELS.map((c) => {
            const checked = channels.includes(c.code);
            const locked = c.code === 'IN_APP';
            const disabled = c.code === 'EMAIL' && isGuest;
            const Icon = c.icon;
            return (
              <label key={c.code} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${checked && !disabled ? 'border-primary bg-primary-soft' : 'border-border bg-surface'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" checked={checked && !disabled} disabled={locked || disabled} onChange={() => toggleChannel(c.code)} />
                <span className="flex flex-col">
                  <span className="flex items-center gap-1.5 font-semibold"><Icon className="size-4" aria-hidden />{tr(c.label)}</span>
                  <span className="text-xs text-muted">{disabled ? tr({ ar: 'أنشئ حسابًا لتفعيله', fr: 'Créez un compte pour l’activer' }) : tr(c.hint)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <Field label={tr({ ar: 'تذكير يومي بالمراجعة', fr: 'Rappel de révision quotidien' })} htmlFor={`${idPrefix}-hour`} hint={tr({ ar: 'تذكير لطيف بمهمة اليوم في الساعة التي تختارها (توقيت تونس).', fr: 'Un rappel de la mission du jour à l’heure choisie (heure de Tunis).' })}>
        <Select
          id={`${idPrefix}-hour`}
          value={value.dailyReminderHour == null ? '' : String(value.dailyReminderHour)}
          onChange={(e) => set('dailyReminderHour', e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">{tr({ ar: 'بدون تذكير', fr: 'Pas de rappel' })}</option>
          {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
            <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** Push opt-in for this device, with test notification and per-platform help (iOS needs the app on the home screen). */
export function PushControl({ onEnabled }: { onEnabled?: () => void }) {
  const tr = useT();
  const { locale } = useLocale();
  const { canInstall, install } = useInstallPrompt();
  const [status, setStatus] = useState<PushStatus | 'checking'>('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'muted'; text: Bi } | null>(null);

  useEffect(() => {
    pushStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);
    const r = await enablePush();
    setBusy(false);
    if (r.ok) {
      setStatus('subscribed');
      track('push_enabled', { from: window.location.pathname });
      onEnabled?.();
      setMessage({ tone: 'success', text: { ar: 'تم! ستصلك التنبيهات على هذا الجهاز.', fr: 'C’est fait ! Vous recevrez les alertes sur cet appareil.' } });
      return;
    }
    if (r.reason === 'denied') setStatus('denied');
    else if (r.reason === 'ios-install') setStatus('ios-install');
    else if (r.reason === 'unavailable') setMessage({ tone: 'muted', text: { ar: 'إشعارات الهاتف غير مفعّلة على الخادم حاليًا — ستصلك التنبيهات داخل التطبيق.', fr: 'Le push n’est pas encore configuré côté serveur — les alertes restent visibles dans l’app.' } });
    else if (r.reason === 'dismissed') setMessage({ tone: 'muted', text: { ar: 'لم يتم منح الإذن. يمكنك المحاولة لاحقًا.', fr: 'Autorisation non accordée. Vous pourrez réessayer plus tard.' } });
    else setMessage({ tone: 'danger', text: { ar: 'تعذّر التفعيل. أعد المحاولة.', fr: 'Activation impossible. Réessayez.' } });
  }

  async function disable() {
    setBusy(true);
    await disablePush().catch(() => {});
    setBusy(false);
    setStatus(Notification.permission === 'granted' ? 'granted' : 'default');
    setMessage({ tone: 'muted', text: { ar: 'أُوقفت الإشعارات على هذا الجهاز.', fr: 'Notifications désactivées sur cet appareil.' } });
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await sendTestPush(locale);
      setMessage(r.ok
        ? { tone: 'success', text: { ar: 'أُرسل إشعار تجريبي — يجب أن يظهر خلال ثوانٍ.', fr: 'Notification de test envoyée — elle doit apparaître dans quelques secondes.' } }
        : { tone: 'danger', text: { ar: 'لم يصل الإشعار التجريبي. عطّل ثم فعّل الإشعارات من جديد.', fr: 'La notification de test n’a pas abouti. Désactivez puis réactivez.' } });
    } catch {
      setMessage({ tone: 'danger', text: { ar: 'تعذّر إرسال الإشعار التجريبي. حاول بعد دقيقة.', fr: 'Envoi du test impossible. Réessayez dans une minute.' } });
    } finally {
      setBusy(false);
    }
  }

  if (status === 'checking') return <div className="h-11 animate-pulse rounded-xl bg-surface-2" aria-hidden />;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Smartphone className="size-4" aria-hidden />
        {tr({ ar: 'إشعارات هذا الجهاز', fr: 'Notifications sur cet appareil' })}
      </p>

      {status === 'subscribed' && (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold text-success"><Check className="size-4" aria-hidden />{tr({ ar: 'مفعّلة على هذا الجهاز', fr: 'Activées sur cet appareil' })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={test} loading={busy} className="min-h-11"><Send className="size-4" aria-hidden />{tr({ ar: 'أرسل إشعارًا تجريبيًا', fr: 'Envoyer un test' })}</Button>
            <Button size="sm" variant="ghost" onClick={disable} disabled={busy} className="min-h-11"><BellOff className="size-4" aria-hidden />{tr({ ar: 'إيقاف على هذا الجهاز', fr: 'Désactiver ici' })}</Button>
          </div>
        </>
      )}

      {(status === 'default' || status === 'granted') && (
        <>
          <p className="text-sm text-muted">{tr({ ar: 'فعّلها حتى لا يفوتك فتح باب الترشح أو آخر أجل، حتى والتطبيق مغلق.', fr: 'Activez-les pour ne rater ni l’ouverture ni la clôture des inscriptions, même app fermée.' })}</p>
          <Button onClick={enable} loading={busy} className="self-start"><BellRing className="size-4" aria-hidden />{tr({ ar: 'فعّل إشعارات الهاتف', fr: 'Activer les notifications' })}</Button>
        </>
      )}

      {status === 'denied' && (
        <p className="text-sm text-muted">
          {tr({
            ar: 'الإشعارات محظورة لهذا الموقع. افتح إعدادات الموقع في المتصفح (رمز القفل بجانب العنوان) واسمح بالإشعارات، ثم أعد تحميل الصفحة. ستبقى التنبيهات ظاهرة داخل التطبيق في كل الأحوال.',
            fr: 'Les notifications sont bloquées pour ce site. Ouvrez les réglages du site (cadenas à côté de l’adresse), autorisez les notifications puis rechargez. Les alertes restent visibles dans l’app.',
          })}
        </p>
      )}

      {status === 'ios-install' && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted">{tr({ ar: 'على iPhone وiPad، تعمل الإشعارات فقط بعد إضافة التطبيق إلى الشاشة الرئيسية:', fr: 'Sur iPhone et iPad, les notifications fonctionnent une fois l’app ajoutée à l’écran d’accueil :' })}</p>
          <ol className="list-inside list-decimal text-muted">
            <li>{tr({ ar: 'اضغط زر المشاركة', fr: 'Touchez le bouton Partager' })} <SquareArrowOutUpRight className="inline size-4" aria-hidden /> {tr({ ar: 'في Safari', fr: 'dans Safari' })}</li>
            <li>{tr({ ar: 'اختر «إضافة إلى الشاشة الرئيسية»', fr: 'Choisissez « Sur l’écran d’accueil »' })}</li>
            <li>{tr({ ar: 'افتح Concours TN من الأيقونة ثم فعّل الإشعارات من هذه الصفحة', fr: 'Ouvrez Concours TN depuis l’icône puis activez les notifications ici' })}</li>
          </ol>
        </div>
      )}

      {status === 'unsupported' && (
        <p className="text-sm text-muted">
          {isIos()
            ? tr({ ar: 'حدّث iOS إلى النسخة 16.4 أو أحدث لتلقي الإشعارات. ستصلك التنبيهات داخل التطبيق وبالبريد.', fr: 'Mettez iOS à jour (16.4 ou plus) pour recevoir les notifications. Les alertes restent disponibles dans l’app et par e-mail.' })
            : tr({ ar: 'هذا المتصفح لا يدعم إشعارات الهاتف. جرّب Chrome أو Firefox — وستصلك التنبيهات داخل التطبيق وبالبريد.', fr: 'Ce navigateur ne gère pas les notifications push. Essayez Chrome ou Firefox — les alertes restent dans l’app et par e-mail.' })}
        </p>
      )}

      {canInstall && (
        <Button size="sm" variant="secondary" onClick={() => install().then((ok) => ok && track('pwa_installed', {}))} className="min-h-11 self-start">
          <Download className="size-4" aria-hidden />
          {tr({ ar: 'ثبّت التطبيق على هاتفك', fr: 'Installer l’application' })}
        </Button>
      )}

      {message && (
        <p className={`text-sm ${message.tone === 'success' ? 'text-success' : message.tone === 'danger' ? 'text-danger' : 'text-muted'}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {tr(message.text)}
        </p>
      )}
    </div>
  );
}

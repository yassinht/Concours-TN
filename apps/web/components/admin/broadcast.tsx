'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Bell, BellRing, Megaphone, Users } from 'lucide-react';
import type { Field as FieldKey } from '@ctn/shared';
import { FIELD_LABELS, FIELDS } from '@ctn/shared/dist/enums';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useDebounced } from './hooks';
import { FamilySelect } from './pickers';
import { AdminOnly } from './shell';
import { useToast } from './toast';
import { AdminPage, Checkbox, Section, useConfirm } from './ui';

interface BroadcastResult { sent: number; audience: number; dedupeKey: string; dryRun: boolean }

/** Same rule as the API (isSafeLink): internal path or http(s) URL. */
function linkOk(url: string): boolean {
  if (!url) return true;
  if (/\s/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//') && !url.includes('\\');
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function BroadcastView() {
  return <AdminOnly><BroadcastInner /></AdminOnly>;
}

function BroadcastInner() {
  const { toast, toastError } = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [familySlug, setFamilySlug] = useState('');
  const [field, setField] = useState<FieldKey | ''>('');
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [audience, setAudience] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<BroadcastResult | null>(null);

  const segment = { ...(familySlug ? { familySlug } : {}), ...(field ? { field } : {}), ...(premiumOnly ? { premiumOnly: true } : {}) };
  const payload = { title: title.trim(), body: body.trim(), ...(url.trim() ? { url: url.trim() } : {}), segment };
  const valid = payload.title.length >= 2 && payload.body.length >= 2 && linkOk(url.trim());
  const segKey = useDebounced(JSON.stringify(segment), 400);

  // Audience size for the current segment (dry run: nothing is sent).
  useEffect(() => {
    let alive = true;
    setEstimating(true);
    api<BroadcastResult>('/admin/notifications/broadcast?dryRun=true', { method: 'POST', body: { title: 'estimation', body: 'estimation', segment: JSON.parse(segKey) } })
      .then((r) => alive && setAudience(r.audience))
      .catch(() => alive && setAudience(null))
      .finally(() => alive && setEstimating(false));
    return () => {
      alive = false;
    };
  }, [segKey]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const ok = await confirm.ask({
      title: `Envoyer à ${audience ?? '?'} personne(s) ?`,
      tone: 'primary',
      confirmLabel: 'Envoyer la notification',
      body: (
        <div className="flex flex-col gap-1">
          <p>Notification in-app et push (selon les préférences de chacun). Impossible à annuler.</p>
          <p className="text-muted">Le même message au même segment n’est envoyé qu’une fois par jour.</p>
        </div>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<BroadcastResult>('/admin/notifications/broadcast', { method: 'POST', body: payload });
      setLast(r);
      toast({ tone: 'success', title: `Notification envoyée à ${r.sent} personne(s)`, body: r.sent < r.audience ? `${r.audience - r.sent} déjà notifiée(s) aujourd’hui avec ce message.` : undefined });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage title="Notifications (diffusion)" subtitle="Message système à un segment : concours suivi/préparé, secteur, Premium. Sans segment : tous les comptes inscrits et les invités qui suivent un concours.">
      <Alert tone="info" title="Annoncer un concours ouvert ?">
        <span className="flex items-start gap-1.5"><BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Pour prévenir les candidats <b>dont le profil correspond</b> (âge, diplôme, sexe…), ouvrez la session dans <Link href="/admin/concours" className="font-semibold underline">Concours</Link> et utilisez « Notifier les candidats correspondants » : le ciblage par éligibilité est plus précis qu’une diffusion.</span>
        </span>
      </Alert>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Section title="Message">
          <form onSubmit={send} className="flex flex-col gap-3">
            <Field label={`Titre (${title.trim().length}/120)`} htmlFor="bc-title"><Input id="bc-title" required minLength={2} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" /></Field>
            <Field label={`Texte (${body.trim().length}/500)`} htmlFor="bc-body"><Textarea id="bc-body" required minLength={2} maxLength={500} rows={5} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" /></Field>
            <Field label="Lien (optionnel)" htmlFor="bc-url" error={linkOk(url.trim()) ? undefined : 'Chemin interne « /app/… » ou URL http(s).'} hint="Ex. /concours/police-nationale ou /app/billing">
              <Input id="bc-url" value={url} maxLength={300} onChange={(e) => setUrl(e.target.value)} dir="ltr" />
            </Field>
            <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
              <legend className="px-1 text-sm font-bold">Segment</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Concours (suivi ou préparé)" htmlFor="bc-family"><FamilySelect id="bc-family" value={familySlug} onChange={setFamilySlug} emptyLabel="Tous" /></Field>
                <Field label="Secteur" htmlFor="bc-field">
                  <Select id="bc-field" value={field} onChange={(e) => setField(e.target.value as FieldKey | '')}>
                    <option value="">Tous</option>
                    {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f].fr}</option>)}
                  </Select>
                </Field>
              </div>
              <Checkbox checked={premiumOnly} onChange={setPremiumOnly} label="Abonnés Premium uniquement" />
              <p className="flex items-center gap-1.5 text-sm"><Users className="size-4" aria-hidden />Audience estimée : <b className="tabular-nums">{estimating ? '…' : audience ?? '—'}</b></p>
            </fieldset>
            <Button type="submit" loading={busy} disabled={!valid || audience === 0} className="self-start"><Megaphone className="size-4" aria-hidden />Envoyer</Button>
            {last && <p className="text-sm text-success">Dernier envoi : {last.sent} / {last.audience} personne(s).</p>}
          </form>
        </Section>
        <Section title="Aperçu">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Bell className="size-4" aria-hidden /></span>
            <div className="min-w-0">
              <p className="font-semibold" dir="auto">{title || 'Titre de la notification'}</p>
              <p className="whitespace-pre-line text-sm text-muted" dir="auto">{body || 'Texte de la notification…'}</p>
              {url && <p className="mt-1 truncate text-xs text-primary" dir="ltr">{url}</p>}
            </div>
          </div>
          <p className="text-xs text-muted">Écrivez dans la langue de votre audience (l’arabe pour une diffusion large).</p>
        </Section>
      </div>
      {confirm.element}
    </AdminPage>
  );
}

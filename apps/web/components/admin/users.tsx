'use client';

import clsx from 'clsx';
import { useState, type FormEvent } from 'react';
import { BellRing, Crown, Search, ShieldCheck } from 'lucide-react';
import type { UserRole } from '@ctn/shared';
import { DIPLOMA_LABELS, FIELD_LABELS, USER_ROLES } from '@ctn/shared/dist/enums';
import { formatTnd } from '@ctn/shared/dist/pricing';
import { Badge, Button, Field, Input, Modal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAdminApi, useDebounced } from './hooks';
import { fmtDate, fmtDateTime, fmtNumber, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, qs, ROLE_LABEL } from './labels';
import { AdminOnly, useAdmin } from './shell';
import { useToast } from './toast';
import type { Paged, UserDetail, UserRow } from './types';
import { AdminPage, Checkbox, Empty, ErrorBox, FilterBar, FilterField, KV, Loading, Pagination, Section, TableWrap, tableCls, tdCls, thCls, useConfirm } from './ui';

const GRANT_PLANS = [
  { v: 'PREMIUM_MONTH', l: 'Premium (mensuel)' },
  { v: 'PREMIUM_QUARTER', l: 'Premium (trimestriel)' },
  { v: 'EXAM_PASS', l: 'Pass concours' },
];

export function UsersView() {
  return <AdminOnly><UsersInner /></AdminOnly>;
}

function UsersInner() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [premium, setPremium] = useState('');
  const [guests, setGuests] = useState(false);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const dq = useDebounced(q.trim());
  const { data, error, loading, reload } = useAdminApi<Paged<UserRow>>(`/admin/users${qs({ q: dq, role, premium, includeGuests: guests ? 'true' : '', page, pageSize: 50 })}`);

  return (
    <AdminPage title="Utilisateurs" subtitle="Recherche par e-mail, nom, téléphone, code de parrainage ou identifiant. Ouvrez une fiche pour comprendre les alertes reçues, les paiements et l’activité.">
      <FilterBar>
        <FilterField label="Recherche" htmlFor="uf-q" className="min-w-64 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input id="uf-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="ps-9" placeholder="e-mail, nom, téléphone, code…" />
          </div>
        </FilterField>
        <FilterField label="Rôle" htmlFor="uf-role">
          <Select id="uf-role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">Tous</option>
            {USER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Premium" htmlFor="uf-prem">
          <Select id="uf-prem" value={premium} onChange={(e) => { setPremium(e.target.value); setPage(1); }}>
            <option value="">Tous</option>
            <option value="true">Premium actif</option>
            <option value="false">Gratuit</option>
          </Select>
        </FilterField>
        <Checkbox checked={guests} onChange={(v) => { setGuests(v); setPage(1); }} label="Inclure les invités" className="self-end" />
      </FilterBar>
      {error && !data ? <ErrorBox error={error} onRetry={() => void reload()} /> : !data ? <Loading /> : !data.items.length ? <Empty title="Aucun utilisateur" /> : (
        <div className={clsx('flex flex-col gap-2', loading && 'opacity-60')}>
          <TableWrap>
            <table className={clsx(tableCls, 'min-w-[960px]')}>
              <thead><tr><th className={thCls}>Utilisateur</th><th className={thCls}>Rôle</th><th className={thCls}>Abonnement</th><th className={thCls}>Activité</th><th className={thCls}>Inscrit</th><th className={thCls}>Dernière visite</th></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => setOpenId(u.id)}>
                    <td className={tdCls}>
                      <button type="button" className="text-start font-semibold hover:text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setOpenId(u.id); }}>{u.name ?? (u.isGuest ? 'Invité' : 'Sans nom')}</button>
                      <p className="text-xs text-muted">{u.email ?? '—'}{u.phone ? ` · ${u.phone}` : ''}{u.email && !u.emailVerified ? ' · e-mail non vérifié' : ''}</p>
                    </td>
                    <td className={tdCls}><Badge tone={u.role === 'ADMIN' ? 'accent' : u.role === 'EDITOR' ? 'info' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge>{u.isGuest && <Badge tone="neutral" className="ms-1">Invité</Badge>}</td>
                    <td className={tdCls}>{u.premium.active ? <Badge tone="primary"><Crown className="size-3.5" aria-hidden />{u.premium.planCode} → {fmtDate(u.premium.endsAt)}</Badge> : <span className="text-xs text-muted">Gratuit</span>}</td>
                    <td className={clsx(tdCls, 'text-xs tabular-nums')}>{fmtNumber(u.stats.answered)} rép. · {fmtNumber(u.stats.xp)} XP · série {u.stats.streak}</td>
                    <td className={clsx(tdCls, 'whitespace-nowrap text-xs')}>{fmtDate(u.createdAt)}</td>
                    <td className={clsx(tdCls, 'whitespace-nowrap text-xs')}>{fmtDateTime(u.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}
      <UserModal id={openId} onClose={() => setOpenId(null)} onChanged={() => void reload()} />
    </AdminPage>
  );
}

function UserModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { me } = useAdmin();
  const { toast, toastError } = useToast();
  const confirm = useConfirm();
  const { data: u, error, loading, reload } = useAdminApi<UserDetail>(id ? `/admin/users/${id}` : null);
  const [days, setDays] = useState('30');
  const [plan, setPlan] = useState('PREMIUM_MONTH');
  const [busy, setBusy] = useState(false);

  async function changeRole(role: UserRole) {
    if (!u || role === u.role) return;
    const ok = await confirm.ask({
      title: `Passer ${u.name ?? u.email} en « ${ROLE_LABEL[role]} » ?`,
      body: role === 'USER' ? 'Il perd l’accès au back-office.' : role === 'ADMIN' ? 'Accès complet : comptes, paiements, diffusions.' : 'Accès au contenu (questions, concours, sources), sans comptes ni paiements.',
      tone: role === 'USER' ? 'danger' : 'primary',
      confirmLabel: 'Changer le rôle',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role } });
      toast({ tone: 'success', title: 'Rôle mis à jour' });
      await reload();
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function grant(e: FormEvent) {
    e.preventDefault();
    if (!u) return;
    const ok = await confirm.ask({ title: `Offrir ${days} jour(s) de Premium ?`, body: 'Prolonge l’abonnement en cours, ou en crée un. Le candidat est notifié.', tone: 'primary', confirmLabel: 'Offrir' });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<UserRow & { granted: { days: number; planCode: string; endsAt: string | null } | null }>(`/admin/users/${u.id}`, { method: 'PATCH', body: { grantDays: Number(days), planCode: plan } });
      toast({ tone: 'success', title: 'Premium offert', body: r.granted?.endsAt ? `Actif jusqu’au ${fmtDate(r.granted.endsAt)}.` : undefined });
      await reload();
      onChanged();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!id} onClose={onClose} title={u ? (u.name ?? u.email ?? 'Utilisateur') : 'Utilisateur'}>
      {error && !u ? <ErrorBox error={error} onRetry={() => void reload()} /> : loading && !u ? <Loading /> : u && (
        <div className="flex flex-col gap-4 text-sm">
          <KV items={[
            ['E-mail', `${u.email ?? '—'}${u.emailVerified ? ' (vérifié)' : ''}`],
            ['Téléphone', u.phone ?? '—'],
            ['Langue', u.locale === 'fr' ? 'Français' : 'Arabe'],
            ['Code parrainage', <code key="c">{u.referralCode}</code>],
            ['Inscrit le', fmtDateTime(u.createdAt)],
            ['Activité', `${u.activity.submittedAttempts}/${u.activity.attempts} sessions terminées · ${fmtNumber(u.stats.answered)} réponses`],
            ['Notifications', `${u.notifications.total} (${u.notifications.unread} non lues)`],
          ]} />

          <Section title={<span className="inline-flex items-center gap-1.5"><BellRing className="size-4" aria-hidden />Alertes concours</span>} className="p-3">
            {u.profile ? (
              <KV items={[
                ['Alertes', u.profile.alertsEnabled ? <Badge key="a" tone="success">Activées</Badge> : <Badge key="a" tone="warning">Désactivées</Badge>],
                ['Canaux', u.profile.alertChannels?.join(', ') || '—'],
                ['Secteurs suivis', u.profile.alertFields?.length ? u.profile.alertFields.map((f) => FIELD_LABELS[f]?.fr ?? f).join(', ') : 'Tous'],
                ['Diplôme', u.profile.diplomaLevel ? DIPLOMA_LABELS[u.profile.diplomaLevel]?.fr : <span key="d" className="text-warning">Non renseigné</span>],
                ['Date de naissance', u.profile.hasBirthDate ? 'Renseignée' : <span key="b" className="text-warning">Non renseignée (âge inconnu)</span>],
                ['Sexe', u.profile.gender ?? '—'],
                ['Gouvernorat', u.profile.governorate ?? '—'],
                ['Correspondances', `${u.alerts.matches}${u.alerts.lastMatchAt ? ` · dernière le ${fmtDateTime(u.alerts.lastMatchAt)}` : ''}`],
              ]} />
            ) : <p className="text-warning">Profil non rempli : aucune alerte de correspondance possible.</p>}
            <p className="text-xs text-muted">Suit : {u.follows.length ? u.follows.join(', ') : '—'} · Prépare : {u.enrollments.length ? u.enrollments.map((e) => `${e.familySlug}${e.isPrimary ? ' (principal)' : ''}`).join(', ') : '—'}</p>
          </Section>

          <Section title={<span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden />Rôle</span>} className="p-3">
            <Select aria-label="Rôle" value={u.role} disabled={busy || u.isGuest || u.id === me.id} onChange={(e) => void changeRole(e.target.value as UserRole)}>
              {USER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
            {u.id === me.id && <p className="text-xs text-muted">Vous ne pouvez pas changer votre propre rôle.</p>}
          </Section>

          <Section title={<span className="inline-flex items-center gap-1.5"><Crown className="size-4" aria-hidden />Premium</span>} className="p-3">
            <p>{u.premium.active ? `${u.premium.planCode} jusqu’au ${fmtDate(u.premium.endsAt)}` : 'Aucun abonnement actif.'}</p>
            {!u.isGuest && (
              <form onSubmit={grant} className="flex flex-wrap items-end gap-2">
                <Field label="Jours offerts" htmlFor="ug-days"><Input id="ug-days" type="number" min={1} max={3650} required value={days} onChange={(e) => setDays(e.target.value)} className="w-28" /></Field>
                <Field label="Formule" htmlFor="ug-plan"><Select id="ug-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>{GRANT_PLANS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</Select></Field>
                <Button type="submit" loading={busy}>Offrir</Button>
              </form>
            )}
          </Section>

          {u.payments.length > 0 && (
            <Section title="Paiements" className="p-3">
              <ul className="flex flex-col gap-1">
                {u.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                    <span className="font-semibold tabular-nums">{formatTnd(p.amountMillimes, 'fr')}</span>
                    <span>{p.planCode} · {p.provider}</span>
                    <span className="text-xs text-muted">{fmtDateTime(p.createdAt)}{p.manualReference ? ` · réf. ${p.manualReference}` : ''}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
      {confirm.element}
    </Modal>
  );
}

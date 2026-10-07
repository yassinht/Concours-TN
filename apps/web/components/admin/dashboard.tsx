'use client';

import Link from 'next/link';
import { BellRing, RotateCcw } from 'lucide-react';
import type { ContentStatus } from '@ctn/shared';
import { CONTENT_STATUSES } from '@ctn/shared/dist/enums';
import { formatTnd } from '@ctn/shared/dist/pricing';
import { Button, ButtonLink } from '@/components/ui';
import { OpenEditionsPanel } from './alerts-panel';
import { CONTENT_STATUS_LABEL, CONTENT_STATUS_TONE, fmtDateTime, fmtNumber, fmtPct } from './labels';
import { useAdmin } from './shell';
import { AdminPage, BarRow, ErrorBox, Loading, Section, StatCard, TableWrap, tableCls, tdCls, thCls } from './ui';
import { useAdminApi } from './hooks';
import type { AdminStats } from './types';

const FUNNEL_STEPS: { key: string; label: string }[] = [
  { key: 'landing_view', label: 'Visiteurs' },
  { key: 'diagnostic_start', label: 'Diagnostic commencé' },
  { key: 'diagnostic_done', label: 'Diagnostic terminé' },
  { key: 'signup', label: 'Inscriptions' },
  { key: 'paywall_view', label: 'Paywall vu' },
  { key: 'checkout_start', label: 'Paiement commencé' },
  { key: 'paid', label: 'Payants' },
];
const SOURCE_NOTE: Record<string, string> = { events: 'événements', tables: 'estimé (tables)', none: 'aucune donnée' };

export function DashboardView() {
  const { isAdmin, refreshStats } = useAdmin();
  const { data: s, error, loading, reload } = useAdminApi<AdminStats>('/admin/stats');

  return (
    <AdminPage
      title="Tableau de bord"
      subtitle={s?.generatedAt ? `Mis à jour le ${fmtDateTime(s.generatedAt)} · fenêtre de 30 jours pour l’entonnoir et le revenu récent` : 'Vue d’ensemble de la plateforme'}
      actions={<Button variant="secondary" size="sm" onClick={() => { void reload(); void refreshStats(); }} loading={loading && !!s}><RotateCcw className="size-4" aria-hidden />Actualiser</Button>}
    >
      {error && !s ? <ErrorBox error={error} onRetry={() => void reload()} /> : !s ? <Loading /> : <DashboardBody s={s} isAdmin={isAdmin} />}
    </AdminPage>
  );
}

function DashboardBody({ s, isAdmin }: { s: AdminStats; isAdmin: boolean }) {
  const funnel = s.funnelDetail?.steps ?? {
    landing_view: s.funnel.visitors, diagnostic_start: s.funnel.diagnostic, signup: s.funnel.registered, paid: s.funnel.paid,
  } as Record<string, number>;
  const funnelSteps = FUNNEL_STEPS.filter((f) => funnel[f.key] !== undefined);
  const funnelMax = Math.max(1, ...funnelSteps.map((f) => funnel[f.key] ?? 0));
  const qMax = Math.max(1, ...CONTENT_STATUSES.map((st) => s.content.questions[st] ?? 0));
  const totalQuestions = CONTENT_STATUSES.reduce((n, st) => n + (s.content.questions[st] ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Utilisateurs" value={fmtNumber(s.users.total)} sub={`${fmtNumber(s.users.registered)} inscrits · ${fmtNumber(s.users.guests)} invités · ${fmtNumber(s.users.active7d)} actifs (7 j)`} href={isAdmin ? '/admin/users' : undefined} />
        <StatCard label="Premium actifs" value={fmtNumber(s.users.premium)} sub={s.users.registered ? `${fmtPct(s.users.premium / s.users.registered, 1)} des inscrits` : undefined} tone="primary" />
        <StatCard label="Revenu 30 jours" value={formatTnd(s.revenue.last30dMillimes, 'fr')} sub={`Total : ${formatTnd(s.revenue.totalMillimes, 'fr')}${s.revenue.paidLast30d != null ? ` · ${s.revenue.paidLast30d} paiement(s)` : ''}`} tone="success" />
        <StatCard
          label="Paiements manuels en attente"
          value={fmtNumber(s.revenue.pendingManual)}
          sub={s.revenue.pendingManualWithProof != null ? `${s.revenue.pendingManualWithProof} avec justificatif à valider` : 'D17 / virement'}
          tone={s.revenue.pendingManual ? 'warning' : undefined}
          href={isAdmin ? '/admin/payments' : undefined}
        />
        <StatCard label="Faits à vérifier" value={fmtNumber(s.content.factsNeedingVerification)} sub={s.content.editionsNeedingVerification != null ? `dont ${s.content.editionsNeedingVerification} session(s)` : 'Affichés « À vérifier »'} tone={s.content.factsNeedingVerification ? 'warning' : 'success'} href="/admin/facts" />
        <StatCard label="Signalements ouverts" value={fmtNumber(s.content.openReports)} sub="Questions signalées par les candidats" tone={s.content.openReports ? 'danger' : 'success'} href="/admin/reports" />
        <StatCard label="À relire (IA)" value={fmtNumber(s.content.questions.AI_REVIEWED ?? 0)} sub="Questions validées par l’IA, en attente d’un humain" tone={(s.content.questions.AI_REVIEWED ?? 0) ? 'warning' : undefined} href="/admin/review" />
        <StatCard label="Waitlist" value={fmtNumber(s.waitlist)} sub="Intéressés avant lancement" href={isAdmin ? '/admin/waitlist' : undefined} />
      </div>

      {s.alerts && (
        <Section
          title={<span className="inline-flex items-center gap-2"><BellRing className="size-5 text-primary" aria-hidden />Alertes « concours correspondant à votre profil »</span>}
          description="Quand une session publiée passe en « Annoncée » ou « Inscriptions ouvertes », les candidats dont le profil correspond (âge, diplôme, sexe, taille…) sont notifiés (in-app, push, e-mail selon leurs préférences)."
          actions={<ButtonLink href="/admin/concours" size="sm" variant="secondary">Gérer les sessions</ButtonLink>}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Sessions ouvertes non encore notifiées" value={fmtNumber(s.alerts.pendingEditions)} sub="Traitées par la tâche horaire, ou via « Notifier »" tone={s.alerts.pendingEditions ? 'warning' : 'success'} />
            <StatCard label="Correspondances (30 j)" value={fmtNumber(s.alerts.matchesLast30d)} sub="Candidats ↔ sessions" />
            <StatCard label="Notifications envoyées (30 j)" value={fmtNumber(s.alerts.notifiedLast30d)} tone="primary" />
            <StatCard label="Comptes avec alertes actives" value={fmtNumber(s.alerts.usersWithAlertsEnabled)} />
          </div>
        </Section>
      )}

      <OpenEditionsPanel />

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Entonnoir (30 jours)" description="Personnes distinctes par étape ; % = conversion depuis l’étape précédente.">
          <div className="flex flex-col gap-3">
            {funnelSteps.map((f, i) => {
              const v = funnel[f.key] ?? 0;
              const prev = i > 0 ? funnel[funnelSteps[i - 1].key] ?? 0 : null;
              const src = s.funnelDetail?.source?.[f.key];
              return (
                <BarRow
                  key={f.key}
                  label={<>{f.label}{src && src !== 'events' && <span className="ms-1 text-xs text-muted">({SOURCE_NOTE[src]})</span>}</>}
                  value={v}
                  max={funnelMax}
                  sub={prev ? `· ${fmtPct(v / prev)}` : undefined}
                  tone={f.key === 'paid' ? 'success' : 'primary'}
                />
              );
            })}
          </div>
        </Section>

        <Section title="Questions par statut" description={`${fmtNumber(totalQuestions)} questions au total. Seul « Publié » est servi aux candidats (hors mode bêta).`} actions={<ButtonLink href="/admin/questions" size="sm" variant="secondary">Banque de questions</ButtonLink>}>
          <div className="flex flex-col gap-3">
            {CONTENT_STATUSES.map((st: ContentStatus) => (
              <Link key={st} href={`/admin/questions?status=${st}`} className="rounded-lg hover:bg-surface-2">
                <BarRow label={CONTENT_STATUS_LABEL[st]} value={s.content.questions[st] ?? 0} max={qMax} tone={CONTENT_STATUS_TONE[st] === 'neutral' ? 'info' : (CONTENT_STATUS_TONE[st] as 'success' | 'warning' | 'info')} />
              </Link>
            ))}
          </div>
          {s.content.lessons && (
            <p className="text-xs text-muted">
              Leçons : {CONTENT_STATUSES.map((st) => `${CONTENT_STATUS_LABEL[st]} ${s.content.lessons?.[st] ?? 0}`).join(' · ')}
            </p>
          )}
        </Section>
      </div>

      <Section title="Thèmes les plus difficiles" description="Taux d’erreur des candidats (thèmes avec au moins 20 réponses). Priorité pour de nouvelles leçons et questions.">
        {s.weakTopics.length === 0 ? (
          <p className="text-sm text-muted">Pas encore assez de réponses pour classer les thèmes.</p>
        ) : (
          <TableWrap>
            <table className={tableCls}>
              <thead>
                <tr><th className={thCls}>Thème</th><th className={thCls}>Clé</th><th className={thCls}>Taux d’erreur</th><th className={thCls}>Réponses</th><th className={thCls}><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {s.weakTopics.map((t) => (
                  <tr key={t.key}>
                    <td className={tdCls}><span className="font-semibold">{t.title_fr}</span> <span className="text-muted" dir="rtl" lang="ar">· {t.title_ar}</span></td>
                    <td className={tdCls}><code className="text-xs">{t.key}</code></td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-2" aria-hidden><div className="h-full bg-danger" style={{ width: `${Math.round(t.errorRate * 100)}%` }} /></div>
                        <span className="tabular-nums">{fmtPct(t.errorRate)}</span>
                      </div>
                    </td>
                    <td className={`${tdCls} tabular-nums`}>{fmtNumber(t.answers)}</td>
                    <td className={tdCls}>
                      <div className="flex gap-2 whitespace-nowrap text-xs font-semibold">
                        <Link className="text-primary underline" href={`/admin/questions?topicKey=${encodeURIComponent(t.key)}`}>Questions</Link>
                        <Link className="text-primary underline" href={`/admin/ai?topicKey=${encodeURIComponent(t.key)}`}>Générer</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

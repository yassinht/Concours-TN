'use client';

import clsx from 'clsx';
import { useMemo, useState, type FormEvent } from 'react';
import { Activity, CheckSquare, ClipboardList, Dumbbell, FileCheck2, Plus, Square, Trash2, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import type { FactDTO, FamilyDetailDTO } from '@ctn/shared';
import { Alert, Button, Card, EmptyState, Field, Input, ProgressBar, Select } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { useLocale, useT } from '@/components/providers';
import { ErrorState, PageHeader, SectionTitle, Skeleton } from '@/components/app/bits';
import { bi, errorText, tunisToday } from '@/components/app/format';
import { errorCode } from '@/components/app/use-api';
import { api } from '@/lib/api';
import { formatDate, type Bi } from '@/lib/i18n';
import { Sparkline } from '../charts';
import { useSessionApi } from '../hooks';
import { formatPhysical, nOf, parseValue, PHYSICAL_TESTS } from '../labels';
import type { ChecklistGroup, PhysicalLog } from '../types';

/** /app/checklist/[slug]: required documents per position + physical test training log. */
export function ChecklistScreen({ slug, familyName }: { slug: string; familyName: Bi | null }) {
  const tr = useT();
  const family = useSessionApi<FamilyDetailDTO>(`/catalog/families/${encodeURIComponent(slug)}`);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back="/app/practice"
        title={tr({ ar: 'ملف الترشح والاختبارات البدنية', fr: 'Dossier et épreuves sportives' })}
        subtitle={familyName ? tr(familyName) : undefined}
      />
      <Documents slug={slug} family={family.data ?? null} />
      <Physical family={family.data ?? null} loading={family.loading} />
    </div>
  );
}

// ───────── Documents ─────────

function Documents({ slug, family }: { slug: string; family: FamilyDetailDTO | null }) {
  const tr = useT();
  const { locale } = useLocale();
  const data = useSessionApi<ChecklistGroup[]>(`/me/checklist/${encodeURIComponent(slug)}`);
  const [error, setError] = useState<string | null>(null);

  const unique = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const g of data.data ?? []) for (const it of g.items) m.set(it.id, it.checked);
    return m;
  }, [data.data]);
  const done = [...unique.values()].filter(Boolean).length;

  async function toggle(id: string, checked: boolean) {
    setError(null);
    const apply = (v: boolean) => data.setData((gs) => gs?.map((g) => ({ ...g, items: g.items.map((it) => (it.id === id ? { ...it, checked: v } : it)) })));
    apply(checked);
    try {
      await api(`/me/checklist/${id}`, { method: 'PUT', body: { checked } });
    } catch (e) {
      apply(!checked);
      setError(errorCode(e));
    }
  }

  const titleOf = (g: ChecklistGroup) => {
    if (!g.positionSlug) return tr({ ar: 'لكل الرتب', fr: 'Pour tous les grades' });
    const p = family?.positions.find((x) => x.slug === g.positionSlug);
    return bi(locale, g.positionTitle_ar ?? p?.title_ar, g.positionTitle_fr ?? p?.title_fr) || g.positionSlug;
  };

  return (
    <section aria-labelledby="docs" className="flex flex-col gap-3">
      <SectionTitle id="docs"><span className="inline-flex items-center gap-2"><FileCheck2 className="size-5 text-primary" aria-hidden />{tr({ ar: 'الوثائق المطلوبة', fr: 'Pièces à fournir' })}</span></SectionTitle>
      {data.error ? <ErrorState error={data.error} onRetry={() => void data.reload()} />
        : !data.data ? <Skeleton className="h-48" />
          : unique.size === 0 ? (
            <EmptyState
              icon={<ClipboardList className="size-8" aria-hidden />}
              title={tr({ ar: 'لم ننشر بعد قائمة الوثائق لهذه المناظرة', fr: 'Liste des pièces pas encore publiée pour ce concours' })}
              body={tr({ ar: 'ستظهر هنا فور التحقق منها في البلاغ الرسمي. فعّل التنبيهات لتصلك.', fr: 'Elle apparaîtra ici dès sa vérification dans l’avis officiel. Activez les alertes pour être prévenu.' })}
            />
          ) : (
            <>
              <Card className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{tr({ ar: 'جاهزية ملفك', fr: 'Votre dossier' })}</span>
                  <span className="font-bold tabular-nums" dir="ltr">{done}/{unique.size}</span>
                </div>
                <ProgressBar value={(done / Math.max(1, unique.size)) * 100} tone={done === unique.size ? 'success' : 'primary'} label={tr({ ar: 'الوثائق الجاهزة', fr: 'Pièces prêtes' })} />
                <p className="text-xs text-muted">{tr({ ar: 'القائمة الرسمية هي المرجع: راجع دائمًا بلاغ المناظرة قبل إيداع ملفك. تُحفظ علاماتك في حسابك.', fr: 'L’avis officiel fait foi : vérifiez-le toujours avant de déposer votre dossier. Vos coches sont enregistrées dans votre compte.' })}</p>
              </Card>
              {error && <Alert tone="danger">{tr(errorText(error))}</Alert>}
              {data.data.filter((g) => g.items.length).map((g) => {
                const n = g.items.filter((i) => i.checked).length;
                return (
                  <Card as="section" key={g.positionSlug ?? 'all'} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold">{titleOf(g)}</h3>
                      <span className="text-xs text-muted tabular-nums" dir="ltr">{n}/{g.items.length}</span>
                    </div>
                    <ul className="flex flex-col divide-y divide-border">
                      {g.items.map((it) => <DocItem key={it.id} it={it} onToggle={(v) => void toggle(it.id, v)} />)}
                    </ul>
                  </Card>
                );
              })}
            </>
          )}
    </section>
  );
}

function DocItem({ it, onToggle }: { it: FactDTO & { checked: boolean }; onToggle: (v: boolean) => void }) {
  const tr = useT();
  const { locale } = useLocale();
  const details = bi(locale, it.details_ar, it.details_fr);
  const id = `doc-${it.id}`;
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-start gap-3">
        <button
          id={id}
          type="button"
          role="checkbox"
          aria-checked={it.checked}
          onClick={() => onToggle(!it.checked)}
          className={clsx('inline-flex size-11 shrink-0 items-center justify-center rounded-xl', it.checked ? 'text-success' : 'text-muted hover:bg-surface-2')}
          aria-labelledby={`${id}-label`}
        >
          {it.checked ? <CheckSquare className="size-6" aria-hidden /> : <Square className="size-6" aria-hidden />}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
          <span id={`${id}-label`} className={clsx('font-semibold', it.checked && 'text-muted line-through decoration-1')}>{bi(locale, it.display_ar, it.display_fr)}</span>
          {details && <span className="text-sm text-muted">{details}</span>}
          <ProvenanceBadge p={it} />
          {it.needsVerification && <span className="sr-only">{tr({ ar: 'معلومة للتحقق', fr: 'Information à vérifier' })}</span>}
        </div>
      </div>
    </li>
  );
}

// ───────── Physical tests ─────────

function Physical({ family, loading }: { family: FamilyDetailDTO | null; loading: boolean }) {
  const tr = useT();
  const { locale } = useLocale();
  const logs = useSessionApi<PhysicalLog[]>('/me/physical-logs');
  const [test, setTest] = useState(PHYSICAL_TESTS[0].code);
  const [value, setValue] = useState('');
  const [date, setDate] = useState(() => tunisToday());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Bi | null>(null);
  const def = PHYSICAL_TESTS.find((t) => t.code === test) ?? PHYSICAL_TESTS[0];

  const facts = useMemo(() => {
    const m = new Map<string, FactDTO & { positions: string[] }>();
    for (const p of family?.positions ?? []) {
      for (const f of p.physicalTests) {
        const cur = m.get(f.id);
        const title = bi(locale, p.title_ar, p.title_fr);
        if (cur) cur.positions.push(title);
        else m.set(f.id, { ...f, positions: [title] });
      }
    }
    return [...m.values()];
  }, [family, locale]);
  const hasPhysicalPhase = (family?.positions ?? []).some((p) => p.phases.some((ph) => ph.kind === 'PHYSICAL'));

  const byTest = useMemo(() => {
    const m = new Map<string, PhysicalLog[]>();
    for (const l of logs.data ?? []) {
      const list = m.get(l.testCode) ?? [];
      list.push(l);
      m.set(l.testCode, list);
    }
    for (const list of m.values()) list.sort((a, b) => Date.parse(a.loggedAt) - Date.parse(b.loggedAt));
    return m;
  }, [logs.data]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const v = parseValue(value, def.unit);
    if (v == null) {
      setError(def.unit === 's'
        ? { ar: 'أدخل الوقت بالثواني أو بصيغة د:ث (مثال 3:45).', fr: 'Saisissez le temps en secondes ou en m:ss (ex. 3:45).' }
        : { ar: 'أدخل قيمة صحيحة.', fr: 'Saisissez une valeur valide.' });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const loggedAt = date ? new Date(`${date}T12:00:00`).toISOString() : undefined;
      const row = await api<PhysicalLog>('/me/physical-logs', { body: { testCode: def.code, value: v, unit: def.unit, ...(notes.trim() ? { notes: notes.trim().slice(0, 300) } : {}), ...(loggedAt ? { loggedAt } : {}) } });
      logs.setData((l) => [row, ...(l ?? [])]);
      setValue('');
      setNotes('');
    } catch (err) {
      setError(errorText(errorCode(err)));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const prev = logs.data;
    logs.setData((l) => l?.filter((x) => x.id !== id));
    try {
      await api(`/me/physical-logs/${id}`, { method: 'DELETE' });
    } catch {
      logs.setData(() => prev);
    }
  }

  return (
    <section aria-labelledby="physical" className="flex flex-col gap-3">
      <SectionTitle id="physical"><span className="inline-flex items-center gap-2"><Dumbbell className="size-5 text-primary" aria-hidden />{tr({ ar: 'الاختبارات البدنية', fr: 'Épreuves sportives' })}</span></SectionTitle>

      {loading && !family ? <Skeleton className="h-24" /> : facts.length > 0 ? (
        <Card className="flex flex-col gap-3">
          <h3 className="font-bold">{tr({ ar: 'ما هو مطلوب في هذه المناظرة', fr: 'Ce qui est demandé à ce concours' })}</h3>
          <ul className="flex flex-col gap-3">
            {facts.map((f) => (
              <li key={f.id} className="flex flex-col gap-1">
                <span className="font-semibold">{bi(locale, f.display_ar, f.display_fr)}</span>
                {bi(locale, f.details_ar, f.details_fr) && <span className="text-sm text-muted">{bi(locale, f.details_ar, f.details_fr)}</span>}
                {facts.length > 1 && f.positions.length < (family?.positions.length ?? 0) && <span className="text-xs text-muted">{f.positions.join(' · ')}</span>}
                <ProvenanceBadge p={f} />
              </li>
            ))}
          </ul>
          {facts.some((f) => f.needsVerification) && (
            <p className="flex items-start gap-2 text-xs text-warning"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{tr({ ar: 'المعايير المعلَّمة «للتحقق» مقترحة من تجارب سابقة وليست رسمية: اعتمد على البلاغ الرسمي.', fr: 'Les barèmes marqués « À vérifier » viennent d’expériences passées et ne sont pas officiels : fiez-vous à l’avis officiel.' })}</p>
          )}
        </Card>
      ) : (
        <p className="text-sm text-muted">
          {hasPhysicalPhase
            ? tr({ ar: 'تتضمن هذه المناظرة اختبارات بدنية لكن تفاصيلها لم تُنشر بعد.', fr: 'Ce concours comporte des épreuves sportives dont le détail n’est pas encore publié.' })
            : tr({ ar: 'لا نعرف اختبارات بدنية لهذه المناظرة. يمكنك مع ذلك تتبع تدريبك.', fr: 'Pas d’épreuve sportive connue pour ce concours. Vous pouvez quand même suivre votre entraînement.' })}
        </p>
      )}

      <Card as="section" className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 font-bold"><Activity className="size-5 text-primary" aria-hidden />{tr({ ar: 'سجّل حصة تدريب', fr: 'Noter une séance' })}</h3>
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
          <Field label={tr({ ar: 'الاختبار', fr: 'Épreuve' })} htmlFor="pl-test">
            <Select id="pl-test" value={test} onChange={(e) => { setTest(e.target.value); setValue(''); setError(null); }}>
              {PHYSICAL_TESTS.map((t) => <option key={t.code} value={t.code}>{tr(t.label)}</option>)}
            </Select>
          </Field>
          <Field
            label={def.unit === 's' ? tr({ ar: 'الوقت', fr: 'Temps' }) : def.unit === 'm' ? tr({ ar: 'المسافة (متر)', fr: 'Distance (m)' }) : tr({ ar: 'عدد المرات', fr: 'Répétitions' })}
            htmlFor="pl-value"
            hint={def.unit === 's' ? tr({ ar: 'بالثواني أو د:ث — مثال 13.2 أو 3:45', fr: 'En secondes ou m:ss — ex. 13,2 ou 3:45' }) : undefined}
          >
            <Input id="pl-value" value={value} onChange={(e) => setValue(e.target.value)} inputMode={def.unit === 's' ? 'text' : 'decimal'} dir="ltr" required autoComplete="off" placeholder={def.unit === 's' ? (def.code === 'RUN_100M' ? '13.5' : '3:45') : def.unit === 'm' ? '4.20' : '25'} />
          </Field>
          <Field label={tr({ ar: 'التاريخ', fr: 'Date' })} htmlFor="pl-date">
            <Input id="pl-date" type="date" value={date} max={tunisToday()} onChange={(e) => setDate(e.target.value)} dir="ltr" />
          </Field>
          <Field label={tr({ ar: 'ملاحظة (اختياري)', fr: 'Note (facultatif)' })} htmlFor="pl-notes">
            <Input id="pl-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} dir="auto" />
          </Field>
          {error && <div className="sm:col-span-2"><Alert tone="danger">{tr(error)}</Alert></div>}
          <Button type="submit" loading={saving} className="sm:col-span-2 sm:justify-self-start"><Plus className="size-4" aria-hidden />{tr({ ar: 'أضف', fr: 'Ajouter' })}</Button>
        </form>
      </Card>

      {logs.error ? <ErrorState error={logs.error} onRetry={() => void logs.reload()} />
        : !logs.data ? <Skeleton className="h-32" />
          : byTest.size === 0 ? (
            <p className="text-sm text-muted">{tr({ ar: 'سجّل نتائجك بانتظام لترى تطورك قبل يوم الاختبار.', fr: 'Notez vos performances régulièrement pour voir votre progression avant l’épreuve.' })}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {[...byTest.entries()].map(([code, list]) => <TestCard key={code} code={code} list={list} onDelete={(id) => void remove(id)} />)}
            </ul>
          )}
    </section>
  );
}

function TestCard({ code, list, onDelete }: { code: string; list: PhysicalLog[]; onDelete: (id: string) => void }) {
  const tr = useT();
  const { locale } = useLocale();
  const def = PHYSICAL_TESTS.find((t) => t.code === code);
  const lower = def?.lowerIsBetter ?? false;
  const values = list.map((l) => l.value);
  const best = lower ? Math.min(...values) : Math.max(...values);
  const last = list[list.length - 1];
  const first = list[0];
  const improving = list.length > 1 && (lower ? last.value < first.value : last.value > first.value);
  const label = def ? tr(def.label) : code;
  return (
    <li>
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-bold">{label}</h4>
          {list.length > 1 && (
            <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold', improving ? 'text-success' : 'text-warning')}>
              {improving ? <TrendingUp className="size-4" aria-hidden /> : <TrendingDown className="size-4" aria-hidden />}
              {improving ? tr({ ar: 'في تحسن', fr: 'En progrès' }) : tr({ ar: 'واصل التدريب', fr: 'Continuez' })}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="block text-xs text-muted">{tr({ ar: 'آخر نتيجة', fr: 'Dernière' })}</span><b dir="ltr">{formatPhysical(last.value, last.unit, locale)}</b></div>
          <div><span className="block text-xs text-muted">{tr({ ar: 'أفضل نتيجة', fr: 'Record' })}</span><b dir="ltr">{formatPhysical(best, last.unit, locale)}</b></div>
        </div>
        {list.length > 1 && (
          <Sparkline values={values} invert={lower} label={tr({ ar: `تطور ${label}: ${nOf('ar', list.length, 'session')}`, fr: `Évolution ${label} : ${nOf('fr', list.length, 'session')}` })} />
        )}
        {lower && list.length > 1 && <p className="text-[11px] text-muted">{tr({ ar: 'المنحنى يصعد عندما يتحسن وقتك.', fr: 'La courbe monte quand votre temps s’améliore.' })}</p>}
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted">{tr({ ar: `السجل (${list.length})`, fr: `Historique (${list.length})` })}</summary>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {[...list].reverse().slice(0, 20).map((l) => (
              <li key={l.id} className="flex items-center gap-2 py-1.5">
                <span className="flex-1">
                  <b dir="ltr">{formatPhysical(l.value, l.unit, locale)}</b>
                  <span className="text-xs text-muted"> · {formatDate(locale, l.loggedAt, { day: 'numeric', month: 'short' })}</span>
                  {l.notes && <span className="block text-xs text-muted" dir="auto">{l.notes}</span>}
                </span>
                <button type="button" onClick={() => onDelete(l.id)} className="inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger" aria-label={tr({ ar: 'حذف', fr: 'Supprimer' })}>
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </details>
      </Card>
    </li>
  );
}

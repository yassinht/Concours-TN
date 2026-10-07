import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Dumbbell, FileText, Quote, Timer } from 'lucide-react';
import type { BlueprintDTO, FactDTO, Locale, PhaseDTO, PositionDTO, SubjectDTO } from '@ctn/shared';
import { Badge } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { t } from '@/lib/i18n';
import { rulesToLines } from './eligibility-rules';
import { PhaseIcon } from './icons';
import { DIPLOMA_LABELS, DOMAIN_LABELS, PHASE_KIND_LABELS, countLabel, loc } from './labels';

function Block({ title, icon, children, id }: { title: string; icon: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="card flex flex-col gap-3 p-4 sm:p-5">
      <h3 id={id} className="flex items-center gap-2 text-lg font-bold">
        <span className="text-primary">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function minutes(locale: Locale, m: number | null): string | null {
  if (m == null) return null;
  if (m >= 60 && m % 60 === 0) {
    const h = m / 60;
    return locale === 'ar' ? (h === 1 ? 'ساعة واحدة' : h === 2 ? 'ساعتان' : `${h} ساعات`) : `${h} h`;
  }
  return countLabel(locale, m, 'minute');
}

export function PositionPanel({ locale, position, slugPrefix }: { locale: Locale; position: PositionDTO; slugPrefix: string }) {
  const pid = `${slugPrefix}-${position.slug}`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {t(locale, { ar: 'المستوى الدراسي المرجعي للرتبة', fr: 'Niveau d’études de référence' })}: <span className="font-semibold text-text">{t(locale, DIPLOMA_LABELS[position.diplomaLevel])}</span>
      </p>
      <EligibilityBlock locale={locale} position={position} id={`${pid}-elig`} />
      {position.phases.length > 0 && (
        <Block title={t(locale, { ar: 'مراحل المناظرة', fr: 'Déroulement des épreuves' })} icon={<ClipboardList className="size-5" aria-hidden />} id={`${pid}-phases`}>
          <PhasesTimeline locale={locale} phases={position.phases} />
        </Block>
      )}
      {position.subjects.length > 0 && (
        <Block title={t(locale, { ar: 'مواد الاختبار الكتابي', fr: 'Matières de l’écrit' })} icon={<FileText className="size-5" aria-hidden />} id={`${pid}-subjects`}>
          <SubjectsTable locale={locale} subjects={position.subjects} phases={position.phases} />
        </Block>
      )}
      {position.physicalTests.length > 0 && (
        <Block title={t(locale, { ar: 'الاختبارات الرياضية', fr: 'Épreuves physiques' })} icon={<Dumbbell className="size-5" aria-hidden />} id={`${pid}-physical`}>
          <FactsList locale={locale} facts={position.physicalTests} />
        </Block>
      )}
      {position.requiredDocuments.length > 0 && (
        <Block title={t(locale, { ar: 'الوثائق المطلوبة', fr: 'Pièces à fournir' })} icon={<FileText className="size-5" aria-hidden />} id={`${pid}-docs`}>
          <FactsList locale={locale} facts={position.requiredDocuments} ordered />
        </Block>
      )}
      {position.blueprint && (
        <Block title={t(locale, { ar: 'الامتحان التجريبي على المنصة', fr: 'Examen blanc sur la plateforme' })} icon={<Timer className="size-5" aria-hidden />} id={`${pid}-mock`}>
          <BlueprintSummary locale={locale} blueprint={position.blueprint} />
        </Block>
      )}
    </div>
  );
}

function EligibilityBlock({ locale, position, id }: { locale: Locale; position: PositionDTO; id: string }) {
  const lines = rulesToLines(locale, position.eligibility);
  const unverified = position.eligibility.needsVerification || position.eligibility.needs_verification;
  return (
    <Block title={t(locale, { ar: 'شروط الترشح', fr: 'Conditions de candidature' })} icon={<CheckCircle2 className="size-5" aria-hidden />} id={id}>
      <div><ProvenanceBadge p={position.eligibility} /></div>
      {unverified && (
        <p className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t(locale, {
            ar: 'هذه الشروط مقترحة ولم نتحقق منها في البلاغ الرسمي بعد. راجع البلاغ قبل الترشح.',
            fr: 'Ces conditions sont des suggestions non encore vérifiées dans l’avis officiel. Consultez l’avis avant de candidater.',
          })}
        </p>
      )}
      {lines.length ? (
        <ul className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <li key={i} className="flex items-start gap-2 text-[15px]">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              {l.items ? (
                <span className="flex flex-col gap-1.5">
                  <span>{l.text}:</span>
                  <span className="flex flex-wrap gap-1.5">
                    {l.items.map((it) => <Badge key={it} tone="neutral" className="whitespace-normal"><span dir="auto">{it}</span></Badge>)}
                  </span>
                </span>
              ) : (
                <span dir={l.code === 'OTHER' ? 'auto' : undefined}>{l.text}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t(locale, { ar: 'لم تُنشر شروط مفصلة لهذه الرتبة بعد.', fr: 'Pas encore de conditions détaillées pour ce grade.' })}</p>
      )}
      {position.eligibility.sourceQuote && (
        <blockquote className="flex gap-2 rounded-xl border-s-4 border-primary bg-surface-2 p-3 text-sm" dir="auto">
          <Quote className="size-4 shrink-0 text-muted" aria-hidden />
          <span>{position.eligibility.sourceQuote}</span>
        </blockquote>
      )}
    </Block>
  );
}

function PhasesTimeline({ locale, phases }: { locale: Locale; phases: PhaseDTO[] }) {
  const sorted = [...phases].sort((a, b) => a.order - b.order);
  return (
    <ol className="relative flex flex-col gap-4 border-s-2 border-border ps-6">
      {sorted.map((p) => {
        const desc = loc(locale, p, 'description');
        const dur = minutes(locale, p.durationMinutes);
        return (
          <li key={p.order} className="relative">
            <span className="absolute -start-[41px] top-0 grid size-8 place-items-center rounded-full border-2 border-surface bg-primary text-primary-contrast">
              <PhaseIcon kind={p.kind} />
            </span>
            <div className="flex flex-col items-start gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tabular-nums text-muted">{t(locale, { ar: `المرحلة ${p.order}`, fr: `Étape ${p.order}` })}</span>
                <Badge tone="neutral">{t(locale, PHASE_KIND_LABELS[p.kind])}</Badge>
                {p.isEliminatory && (
                  <Badge tone="danger"><AlertTriangle className="size-3.5" aria-hidden />{t(locale, { ar: 'إقصائية', fr: 'Éliminatoire' })}</Badge>
                )}
                {dur && <span className="inline-flex items-center gap-1 text-xs text-muted"><Clock className="size-3.5" aria-hidden />{dur}</span>}
              </div>
              <p className="font-semibold">{loc(locale, p, 'name')}</p>
              {desc && <p className="text-sm text-muted">{desc}</p>}
              <ProvenanceBadge p={p} compact />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SubjectsTable({ locale, subjects, phases }: { locale: Locale; subjects: SubjectDTO[]; phases: PhaseDTO[] }) {
  const phaseName = (order: number) => {
    const p = phases.find((x) => x.order === order);
    return p ? loc(locale, p, 'name') : t(locale, { ar: `المرحلة ${order}`, fr: `Étape ${order}` });
  };
  const groups = [...new Set(subjects.map((s) => s.phaseOrder))].sort((a, b) => a - b).map((order) => ({ order, items: subjects.filter((s) => s.phaseOrder === order) }));
  const unknown = <><span aria-hidden>—</span><span className="sr-only">{t(locale, { ar: 'غير معروف', fr: 'Inconnu' })}</span></>;
  const th = 'border-b border-border px-3 py-2 text-center font-semibold';
  return (
    <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[480px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th scope="col" className="border-b border-border py-2 pe-3 text-start font-semibold">{t(locale, { ar: 'المادة', fr: 'Matière' })}</th>
            <th scope="col" className={th}>{t(locale, { ar: 'الضارب', fr: 'Coef.' })}</th>
            <th scope="col" className={th}>{t(locale, { ar: 'المدة', fr: 'Durée' })}</th>
            <th scope="col" className={th}>{t(locale, { ar: 'عدد الأسئلة', fr: 'Questions' })}</th>
            <th scope="col" className="border-b border-border py-2 ps-3 text-start font-semibold">{t(locale, { ar: 'المصدر', fr: 'Source' })}</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.order}>
            {groups.length > 1 && (
              <tr>
                <th scope="colgroup" colSpan={5} className="border-b border-border bg-surface-2 px-3 py-2 text-start text-xs font-bold">{phaseName(g.order)}</th>
              </tr>
            )}
            {g.items.map((s, i) => (
              <tr key={`${s.domain}-${s.specialtyKey ?? ''}-${i}`} className="align-top">
                <th scope="row" className="border-b border-border py-2.5 pe-3 text-start font-normal">
                  <span className="font-semibold">{loc(locale, s, 'name')}</span>
                  <span className="block text-xs text-muted">{t(locale, DOMAIN_LABELS[s.domain])}</span>
                </th>
                <td className="border-b border-border px-3 py-2.5 text-center tabular-nums">{s.coefficient ?? unknown}</td>
                <td className="border-b border-border px-3 py-2.5 text-center">{minutes(locale, s.durationMinutes) ?? unknown}</td>
                <td className="border-b border-border px-3 py-2.5 text-center tabular-nums">{s.questionCount ?? unknown}</td>
                <td className="border-b border-border py-2.5 ps-3"><ProvenanceBadge p={s} compact /></td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function FactsList({ locale, facts, ordered }: { locale: Locale; facts: FactDTO[]; ordered?: boolean }) {
  const L = ordered ? 'ol' : 'ul';
  return (
    <L className="flex flex-col gap-3">
      {facts.map((f, i) => {
        const details = loc(locale, f, 'details');
        return (
          <li key={f.id} className="flex items-start gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold tabular-nums text-muted" aria-hidden>{i + 1}</span>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span className="font-semibold">{loc(locale, f, 'display')}</span>
              {details && <span className="text-sm text-muted">{details}</span>}
              <ProvenanceBadge p={f} compact />
            </div>
          </li>
        );
      })}
    </L>
  );
}

function BlueprintSummary({ locale, blueprint }: { locale: Locale; blueprint: BlueprintDTO }) {
  const total = blueprint.sections.reduce((a, s) => a + s.count, 0);
  const official = blueprint.fidelity === 'OFFICIAL_FORMAT';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={official ? 'success' : 'warning'}>
          {official ? t(locale, { ar: 'نفس الصيغة الرسمية', fr: 'Format officiel' }) : t(locale, { ar: 'صيغة تقريبية', fr: 'Format approché' })}
        </Badge>
        <span className="text-sm text-muted">{countLabel(locale, total, 'question')} · {minutes(locale, blueprint.totalMinutes)}</span>
      </div>
      {!official && (
        <p className="text-sm text-muted">
          {t(locale, {
            ar: 'الصيغة الرسمية (عدد الأسئلة والتوزيع) غير منشورة، فبنينا امتحانًا تقريبيًا من الامتحانات السابقة والمواد المعلنة.',
            fr: 'Le format officiel (nombre et répartition des questions) n’est pas publié : l’examen blanc est approché à partir des annales et matières annoncées.',
          })}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {blueprint.sections.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span className="font-semibold">{t(locale, DOMAIN_LABELS[s.domain])}{s.specialtyKey ? ` · ${s.specialtyKey}` : ''}</span>
            <span className="text-muted tabular-nums">{countLabel(locale, s.count, 'question')}{s.minutes ? ` · ${minutes(locale, s.minutes)}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BarChart3, BellRing, CircleCheck, Clock, ListChecks, PlayCircle, ShieldCheck, Sparkles, UserX } from 'lucide-react';
import type { Domain, StartAttemptInput } from '@ctn/shared';
import { DOMAIN_LABELS } from '@ctn/shared/dist/enums';
import { Alert, Badge, Button } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { errorCode, track } from '@/components/app/use-api';
import { bi, errorText } from '@/components/app/format';
import { FollowButton } from '@/components/public/follow-button';
import { api } from '@/lib/api';
import type { Bi } from '@/lib/i18n';
import { FIDELITY_TEXT } from '../labels';
import type { SessionView } from '../types';

export interface DiagnosticFamily {
  slug: string;
  name_ar: string;
  name_fr: string;
  organization_ar: string;
  organization_fr: string;
  questionCount: number;
  domains: Domain[];
  positions: { slug: string; title_ar: string; title_fr: string; fidelity: 'OFFICIAL_FORMAT' | 'APPROXIMATED' | null }[];
}

const NO_POSITION = '';

/** /diagnostic/[slug]: explains the free diagnostic, lets the visitor pick a position, then starts it (guest session). */
export function DiagnosticStart({ family }: { family: DiagnosticFamily }) {
  const tr = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { ensureSession } = useSession();
  const [position, setPosition] = useState<string>(family.positions.length === 1 ? family.positions[0].slug : NO_POSITION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bi | null>(null);
  const [noQuestions, setNoQuestions] = useState(family.questionCount === 0);
  const name = bi(locale, family.name_ar, family.name_fr);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const body: StartAttemptInput = { kind: 'DIAGNOSTIC', familySlug: family.slug, ...(position ? { positionSlug: position } : {}) };
      const a = await api<SessionView>('/attempts', { body });
      track('diagnostic_start', { familySlug: family.slug, positionSlug: position || null, from: 'diagnostic_page' });
      router.push(`/app/session/${a.id}`);
    } catch (e) {
      const code = errorCode(e);
      if (code === 'NO_QUESTIONS') setNoQuestions(true);
      else setError(errorText(code));
      setBusy(false);
    }
  }

  const facts = [
    { icon: ListChecks, text: { ar: '24 سؤالًا من كل مواد المناظرة', fr: '24 questions couvrant toutes les matières' } },
    { icon: Clock, text: { ar: 'بين 15 و20 دقيقة', fr: '15 à 20 minutes' } },
    { icon: UserX, text: { ar: 'مجاني ودون تسجيل', fr: 'Gratuit, sans inscription' } },
  ];
  const gains = [
    { ar: 'نتيجتك العامة فورًا', fr: 'Votre score global immédiatement' },
    { ar: 'مستواك في كل مادة ونقاط ضعفك', fr: 'Votre niveau par matière et vos points faibles' },
    { ar: 'تصحيح مفصل لكل سؤال', fr: 'Le corrigé détaillé de chaque question' },
    { ar: 'خطة دراسة يومية حسب نتيجتك وموعد المناظرة', fr: 'Un plan de révision quotidien selon votre résultat et la date du concours' },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <nav aria-label={tr({ ar: 'مسار التنقل', fr: 'Fil d’Ariane' })} className="text-sm text-muted">
        <Link href="/concours" className="hover:underline">{tr({ ar: 'المناظرات', fr: 'Concours' })}</Link>
        <span aria-hidden> / </span>
        <Link href={`/concours/${encodeURIComponent(family.slug)}`} className="hover:underline">{name}</Link>
      </nav>

      <header className="flex flex-col gap-3">
        <Badge tone="accent" className="self-start"><Sparkles className="size-3.5" aria-hidden />{tr({ ar: 'اختبار تشخيصي مجاني', fr: 'Test diagnostique gratuit' })}</Badge>
        <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{tr({ ar: `أين أنت من مناظرة ${family.name_ar}؟`, fr: `Où en êtes-vous pour le concours ${family.name_fr} ?` })}</h1>
        <p className="text-muted">{bi(locale, family.organization_ar, family.organization_fr)}</p>
        <ul className="grid gap-2 sm:grid-cols-3">
          {facts.map((f) => (
            <li key={f.text.fr} className="card flex items-center gap-2 p-3 text-sm font-semibold">
              <f.icon className="size-5 shrink-0 text-primary" aria-hidden />{tr(f.text)}
            </li>
          ))}
        </ul>
      </header>

      {family.domains.length > 0 && (
        <section aria-labelledby="diag-domains" className="flex flex-col gap-2">
          <h2 id="diag-domains" className="font-bold">{tr({ ar: 'المواد المشمولة', fr: 'Matières couvertes' })}</h2>
          <div className="flex flex-wrap gap-2">
            {family.domains.map((d) => <Badge key={d} tone="primary" className="text-sm">{tr(DOMAIN_LABELS[d])}</Badge>)}
          </div>
        </section>
      )}

      {family.positions.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-bold">{tr({ ar: 'ما الرتبة التي تستعد لها؟', fr: 'Quel grade préparez-vous ?' })}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[{ slug: NO_POSITION, title_ar: 'لم أحدد بعد', title_fr: 'Je ne sais pas encore', fidelity: null }, ...family.positions].map((p) => (
              <label
                key={p.slug || 'none'}
                className={clsx('flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 transition', position === p.slug ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-primary/50')}
              >
                <input type="radio" name="position" value={p.slug} checked={position === p.slug} onChange={() => setPosition(p.slug)} className="size-5 accent-primary" />
                <span className="flex flex-1 flex-col">
                  <span className="font-semibold">{bi(locale, p.title_ar, p.title_fr)}</span>
                  {p.fidelity && <span className="text-xs text-muted">{tr(FIDELITY_TEXT[p.fidelity])}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {noQuestions ? (
        <Alert tone="warning" title={tr({ ar: 'بنك أسئلة هذه المناظرة قيد الإعداد', fr: 'La banque de questions de ce concours est en préparation' })}>
          <span className="flex flex-col gap-3">
            {tr({ ar: 'نراجع الأسئلة يدويًا قبل نشرها. فعّل التنبيه لنعلمك عند جاهزية الاختبار وعند فتح المناظرة.', fr: 'Nous relisons chaque question avant publication. Activez l’alerte pour être prévenu quand le test sera prêt et à l’ouverture du concours.' })}
            <FollowButton slug={family.slug} />
          </span>
        </Alert>
      ) : (
        <div className="flex flex-col gap-3">
          <Button size="lg" variant="accent" onClick={start} loading={busy} className="min-h-14 text-lg">
            <PlayCircle className="size-6" aria-hidden />{tr({ ar: 'ابدأ الاختبار الآن', fr: 'Commencer le test' })}
          </Button>
          {error && <Alert tone="danger">{tr(error)}</Alert>}
          <p className="text-center text-xs text-muted">{tr({ ar: 'لا تظهر الإجابات الصحيحة إلا في النهاية، تمامًا كيوم المناظرة. يمكنك التوقف والمواصلة لاحقًا.', fr: 'Les corrigés s’affichent à la fin, comme le jour du concours. Vous pouvez faire une pause et reprendre plus tard.' })}</p>
        </div>
      )}

      <section aria-labelledby="diag-gains" className="card flex flex-col gap-3 p-5">
        <h2 id="diag-gains" className="flex items-center gap-2 font-bold"><BarChart3 className="size-5 text-primary" aria-hidden />{tr({ ar: 'ماذا ستعرف في النهاية؟', fr: 'Ce que vous obtiendrez' })}</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {gains.map((g) => <li key={g.fr} className="flex items-start gap-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{tr(g)}</li>)}
        </ul>
      </section>

      {!noQuestions && (
        <section aria-labelledby="diag-alerts" className="card flex flex-col gap-3 p-5">
          <h2 id="diag-alerts" className="flex items-center gap-2 font-bold"><BellRing className="size-5 text-accent" aria-hidden />{tr({ ar: 'لا تفوّت موعد التسجيل', fr: 'Ne ratez pas les inscriptions' })}</h2>
          <p className="text-sm text-muted">{tr({ ar: 'نعلمك عند فتح هذه المناظرة وقبل آخر أجل للتسجيل، وبكل مناظرة أخرى تناسب ملفك.', fr: 'Nous vous prévenons à l’ouverture de ce concours, avant la clôture des inscriptions, et pour tout autre concours adapté à votre profil.' })}</p>
          <FollowButton slug={family.slug} />
        </section>
      )}

      <p className="flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {tr({ ar: 'منصة مستقلة وغير تابعة للإدارة المنظِّمة. الاختبار مؤشر لمستواك وليس توقعًا لنتيجة المناظرة.', fr: 'Plateforme indépendante, non affiliée à l’administration organisatrice. Le test indique votre niveau, il ne prédit pas le résultat du concours.' })}
      </p>
    </div>
  );
}

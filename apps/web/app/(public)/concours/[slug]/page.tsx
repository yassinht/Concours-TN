import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  BookMarked, Building2, CalendarDays, ClipboardCheck, ExternalLink, FileQuestion, Lightbulb, Library, ListTree, ScrollText, Sparkles, TriangleAlert, Users,
} from 'lucide-react';
import type { FamilyDetailDTO, Locale, SyllabusNodeDTO } from '@ctn/shared';
import { Badge, ButtonLink, Card, EmptyState } from '@/components/ui';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { CalendarSubscribe } from '@/components/public/calendar-subscribe';
import { EditionStatusBadge } from '@/components/public/edition-status';
import { EditionDates, EditionsTimeline } from '@/components/public/editions-timeline';
import { FollowButton } from '@/components/public/follow-button';
import { FieldIcon } from '@/components/public/icons';
import { CONFIDENCE_LABELS, FIELD_LABELS, FREQUENCY_LABELS, SOURCE_TYPE_LABELS, countLabel, editionTitle, loc, sessionLabelFor, truncate } from '@/components/public/labels';
import { PositionPanel } from '@/components/public/position-panel';
import { PositionTabs } from '@/components/public/position-tabs';
import { Breadcrumbs, ClampText, Container, IndependenceNotice, JsonLd, Section } from '@/components/public/sections';
import { absoluteUrl, load, pageMetadata } from '@/components/public/server-data';
import { ShareButtons } from '@/components/public/share-buttons';
import { SyllabusOutline } from '@/components/public/syllabus-outline';
import { TrackEvent } from '@/components/public/track';
import { getLocale } from '@/lib/i18n-server';
import { formatDate, t } from '@/lib/i18n';

type Params = Promise<{ slug: string }>;

const familyPath = (slug: string) => `/catalog/families/${encodeURIComponent(slug)}`;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const fam = await load<FamilyDetailDTO>(familyPath(slug));
  if (fam.error) {
    return pageMetadata(locale, {
      title: { ar: 'المناظرات', fr: 'Concours' },
      description: { ar: 'الشروط والمراحل والبرنامج لكل مناظرة عمومية في تونس.', fr: 'Conditions, épreuves et programme de chaque concours public en Tunisie.' },
      path: `/concours/${slug}`,
    });
  }
  if (!fam.data) {
    return pageMetadata(locale, {
      title: { ar: 'المناظرة غير موجودة', fr: 'Concours introuvable' },
      description: { ar: 'هذه المناظرة غير موجودة.', fr: 'Ce concours n’existe pas.' },
      path: `/concours/${slug}`,
      noIndex: true,
    });
  }
  const f = fam.data;
  return pageMetadata(locale, {
    title: { ar: `${f.name_ar}: الشروط والمراحل والبرنامج`, fr: `${f.name_fr} : conditions, épreuves, programme` },
    description: { ar: truncate(f.description_ar, 160), fr: truncate(f.description_fr, 160) },
    path: `/concours/${f.slug}`,
    type: 'article',
  });
}

const SECTIONS = [
  { id: 'editions', label: { ar: 'الدورات', fr: 'Sessions' } },
  { id: 'positions', label: { ar: 'الرتب والشروط', fr: 'Grades & conditions' } },
  { id: 'syllabus', label: { ar: 'البرنامج', fr: 'Programme' } },
  { id: 'past-exams', label: { ar: 'امتحانات سابقة', fr: 'Annales' } },
  { id: 'tips', label: { ar: 'نصائح', fr: 'Conseils' } },
  { id: 'sources', label: { ar: 'المصادر', fr: 'Sources' } },
] as const;

export default async function FamilyPage({ params }: { params: Params }) {
  const { slug } = await params;
  const locale = await getLocale();
  const [fam, syl] = await Promise.all([
    load<FamilyDetailDTO>(familyPath(slug)),
    load<SyllabusNodeDTO[]>(`/catalog/syllabus/${encodeURIComponent(slug)}`),
  ]);
  if (fam.error) throw new Error('CATALOG_UNAVAILABLE');
  if (!fam.data) notFound();
  const f = fam.data;
  const name = loc(locale, f, 'name');
  const syllabus = syl.data ?? f.syllabus;
  const tips = locale === 'fr' && f.tips_fr.length ? f.tips_fr : f.tips_ar.length ? f.tips_ar : f.tips_fr;
  const next = f.nextEdition;
  const hasMastery = syllabus.some((n) => n.mastery != null);

  return (
    <>
      <TrackEvent name="family_view" props={{ familySlug: f.slug }} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Concours TN', item: absoluteUrl('/') },
            { '@type': 'ListItem', position: 2, name: t(locale, { ar: 'المناظرات', fr: 'Concours' }), item: absoluteUrl('/concours') },
            { '@type': 'ListItem', position: 3, name, item: absoluteUrl(`/concours/${f.slug}`) },
          ],
        }}
      />

      {/* Header */}
      <div className="border-b border-border bg-surface">
        <Container className="flex flex-col gap-4 py-6 sm:py-8">
          <Breadcrumbs locale={locale} items={[{ href: '/', label: t(locale, { ar: 'الرئيسية', fr: 'Accueil' }) }, { href: '/concours', label: t(locale, { ar: 'المناظرات', fr: 'Concours' }) }, { label: name }]} />
          <div className="flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary"><FieldIcon field={f.field} className="size-6" /></span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1 text-sm text-muted">
                <Building2 className="size-4 shrink-0" aria-hidden />
                {loc(locale, f.organization, 'name')}
                {f.organization.ministry_fr && <span className="text-xs" dir="ltr">· {f.organization.ministry_fr}</span>}
              </p>
              <h1 className="mt-1 text-2xl font-extrabold leading-tight sm:text-3xl">{name}</h1>
              <p className="mt-1 text-sm text-muted" lang={locale === 'ar' ? 'fr' : 'ar'} dir="auto">{locale === 'ar' ? f.name_fr : f.name_ar}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{t(locale, FIELD_LABELS[f.field])}</Badge>
            <Badge tone="neutral"><CalendarDays className="size-3.5" aria-hidden />{t(locale, FREQUENCY_LABELS[f.frequency] ?? FREQUENCY_LABELS.UNKNOWN)}</Badge>
            <Badge tone="neutral"><Users className="size-3.5" aria-hidden />{countLabel(locale, f.positionsCount, 'position')}</Badge>
            {f.questionCount > 0 && <Badge tone="neutral"><FileQuestion className="size-3.5" aria-hidden />{countLabel(locale, f.questionCount, 'question')}</Badge>}
          </div>
          <FollowButton slug={f.slug} />
          <div className="max-w-3xl text-[15px] leading-relaxed text-muted"><ClampText locale={locale} text={loc(locale, f, 'description')} /></div>
          <IndependenceNotice locale={locale} orgWebsite={f.organization.website} />
        </Container>
      </div>

      <Container className="flex flex-col gap-10 py-8">
        {/* Next edition */}
        {next && (
          <Card as="section" className="flex flex-col gap-4 border-primary/40">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-muted">{t(locale, next.status === 'OPEN' ? { ar: 'الدورة الحالية', fr: 'Session en cours' } : { ar: 'الدورة القادمة أو الأخيرة', fr: 'Prochaine ou dernière session' })}</p>
                <h2 className="text-lg font-bold">{editionTitle(locale, next)}</h2>
                {next.sessionLabel && <p className="mt-1 text-sm text-muted" dir="auto">{sessionLabelFor(locale, next.sessionLabel)}</p>}
              </div>
              <EditionStatusBadge locale={locale} edition={next} provenance={false} />
            </div>
            <EditionDates locale={locale} edition={next} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {next.positionsCount != null && <span>{t(locale, { ar: 'عدد الخطط', fr: 'Postes' })}: <span className="font-semibold tabular-nums text-text">{next.positionsCount}</span></span>}
              {next.announcementUrl && (
                <a href={next.announcementUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary hover:underline">
                  {t(locale, next.source?.sourceType === 'OFFICIAL' ? { ar: 'اقرأ البلاغ الرسمي', fr: 'Lire l’avis officiel' } : { ar: 'رابط الإعلان', fr: 'Lien de l’annonce' })}<ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </div>
            <div><ProvenanceBadge p={next} /></div>
            {f.editions.some((e) => e.registrationOpen || e.registrationDeadline || e.examDate) && <CalendarSubscribe familySlug={f.slug} />}
          </Card>
        )}

        {/* Primary CTAs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link href={`/concours/${f.slug}/eligibility`} className="card flex items-center gap-3 p-4 hover:border-primary">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-success-soft text-success"><ClipboardCheck className="size-6" aria-hidden /></span>
            <span>
              <span className="block font-bold">{t(locale, { ar: 'تحقق من أهليتك', fr: 'Vérifiez votre éligibilité' })}</span>
              <span className="text-sm text-muted">{t(locale, { ar: 'السن، الشهادة، الطول… في أقل من دقيقة', fr: 'Âge, diplôme, taille… en moins d’une minute' })}</span>
            </span>
          </Link>
          <Link href={`/diagnostic/${f.slug}`} className="card flex items-center gap-3 p-4 hover:border-primary">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Sparkles className="size-6" aria-hidden /></span>
            <span>
              <span className="block font-bold">{t(locale, { ar: 'ابدأ الاختبار التشخيصي', fr: 'Commencer le test diagnostique' })}</span>
              <span className="text-sm text-muted">{t(locale, { ar: 'مجاني، دون تسجيل، 24 سؤالًا', fr: 'Gratuit, sans inscription, 24 questions' })}</span>
            </span>
          </Link>
        </div>

        {/* In-page navigation */}
        <nav aria-label={t(locale, { ar: 'أقسام الصفحة', fr: 'Sections de la page' })} className="-mx-4 overflow-x-auto px-4">
          <ul className="flex gap-2">
            {SECTIONS.filter((s) => s.id !== 'tips' || tips.length > 0).map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2">{t(locale, s.label)}</a>
              </li>
            ))}
          </ul>
        </nav>

        <Section id="editions" title={t(locale, { ar: 'الدورات والمواعيد', fr: 'Sessions et dates' })}>
          {f.editions.length ? (
            <EditionsTimeline locale={locale} editions={f.editions} />
          ) : (
            <EmptyState title={t(locale, { ar: 'لا توجد دورات مسجلة بعد', fr: 'Aucune session enregistrée' })} body={t(locale, { ar: 'فعّل التنبيه لنعلمك عند الإعلان عن دورة جديدة.', fr: 'Activez l’alerte pour être prévenu(e) d’une nouvelle session.' })} />
          )}
        </Section>

        <Section id="positions" title={t(locale, { ar: 'الرتب: الشروط والمراحل والمواد', fr: 'Grades : conditions, épreuves et matières' })}>
          {f.positions.length === 0 ? (
            <EmptyState title={t(locale, { ar: 'لم نضف تفاصيل الرتب بعد', fr: 'Détails des grades pas encore ajoutés' })} />
          ) : f.positions.length === 1 ? (
            <PositionPanel locale={locale} position={f.positions[0]} slugPrefix={f.slug} />
          ) : (
            <PositionTabs
              tabs={f.positions.map((p) => ({ key: p.slug, label: loc(locale, p, 'title') }))}
              panels={f.positions.map((p) => <PositionPanel key={p.slug} locale={locale} position={p} slugPrefix={f.slug} />)}
            />
          )}
        </Section>

        <Section
          id="syllabus"
          title={t(locale, { ar: 'البرنامج', fr: 'Programme' })}
          lead={hasMastery
            ? t(locale, { ar: 'نسبة إتقانك محسوبة من إجاباتك على المنصة.', fr: 'Votre maîtrise est calculée à partir de vos réponses sur la plateforme.' })
            : t(locale, { ar: 'كل مادة تحمل نوعها: برنامج رسمي، مستنتج من امتحانات سابقة، أو مقترح للتحقق.', fr: 'Chaque matière indique sa nature : programme officiel, déduit des annales ou suggestion à vérifier.' })}
        >
          {syllabus.length ? (
            <SyllabusOutline locale={locale} nodes={syllabus} />
          ) : (
            <EmptyState icon={<ListTree className="size-8" aria-hidden />} title={t(locale, { ar: 'البرنامج قيد الإعداد', fr: 'Programme en préparation' })} />
          )}
        </Section>

        <Section id="past-exams" title={t(locale, { ar: 'امتحانات سابقة', fr: 'Annales' })} lead={t(locale, { ar: 'روابط نحو مصادرها الأصلية؛ لا ننشر نصوص الامتحانات حرفيًا.', fr: 'Liens vers les sources d’origine ; nous ne republions pas les sujets tels quels.' })}>
          {f.pastExams.length ? (
            <ul className="flex flex-col gap-2">
              {f.pastExams.map((x, i) => {
                const st = SOURCE_TYPE_LABELS[x.sourceType];
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
                    <span className="font-bold tabular-nums">{x.year}</span>
                    {x.url ? (
                      <a href={x.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold hover:underline" dir="auto">{x.title}<ExternalLink className="size-3.5" aria-hidden /></a>
                    ) : <span className="font-semibold" dir="auto">{x.title}</span>}
                    <Badge tone={st.tone}>{t(locale, st)}</Badge>
                    {!x.isVerified && <Badge tone="warning">{t(locale, { ar: 'غير مؤكد', fr: 'Non vérifié' })}</Badge>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<Library className="size-8" aria-hidden />} title={t(locale, { ar: 'لا توجد امتحانات سابقة موثقة بعد', fr: 'Pas encore d’annales référencées' })} />
          )}
        </Section>

        {tips.length > 0 && (
          <Section id="tips" title={t(locale, { ar: 'نصائح للتحضير', fr: 'Conseils de préparation' })}>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-[15px]">
                  <Lightbulb className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
                  <span dir="auto">{tip}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section id="sources" title={t(locale, { ar: 'المصادر', fr: 'Sources' })} lead={t(locale, { ar: 'كل معلومة في هذه الصفحة مربوطة بأحد هذه المصادر.', fr: 'Chaque information de cette page est rattachée à l’une de ces sources.' })}>
          {f.sources.length ? (
            <ul className="flex flex-col gap-2">
              {f.sources.map((s) => {
                const st = SOURCE_TYPE_LABELS[s.sourceType];
                return (
                  <li key={s.id} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st.tone}>{t(locale, st)}</Badge>
                      <Badge tone="neutral">{t(locale, CONFIDENCE_LABELS[s.confidence])}</Badge>
                    </div>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline" dir="auto">{s.title}<ExternalLink className="size-3.5 shrink-0" aria-hidden /></a>
                    ) : <span className="font-semibold" dir="auto">{s.title}</span>}
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                      {s.publisher && <span dir="auto">{s.publisher}</span>}
                      {s.publicationDate && <span>{t(locale, { ar: 'نُشر في', fr: 'Publié le' })} {formatDate(locale, s.publicationDate)}</span>}
                      <span>{t(locale, { ar: 'آخر تحقق', fr: 'Dernière vérification' })}: {s.lastVerifiedAt ? formatDate(locale, s.lastVerifiedAt) : t(locale, { ar: 'لم يتم بعد', fr: 'pas encore' })}</span>
                    </p>
                    {s.notes && <div className="text-sm text-muted"><ClampText locale={locale} text={s.notes} lines={3} threshold={200} /></div>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<BookMarked className="size-8" aria-hidden />} title={t(locale, { ar: 'لا مصادر مسجلة بعد — كل المعلومات أعلاه للتحقق', fr: 'Aucune source enregistrée — tout ce qui précède est à vérifier' })} />
          )}
        </Section>

        {f.researchNotes && (
          <section aria-labelledby="research-title" className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning-soft p-4">
            <h2 id="research-title" className="flex items-center gap-2 font-bold"><TriangleAlert className="size-5 text-warning" aria-hidden />{t(locale, { ar: 'معلومات بحاجة إلى تحقق', fr: 'Informations à vérifier' })}</h2>
            <div className="text-sm"><ClampText locale={locale} text={f.researchNotes} lines={6} threshold={500} /></div>
            <p className="text-xs text-muted">
              {t(locale, { ar: 'لديك البلاغ الرسمي أو معلومة أدق؟ أرسلها لنا لنتحقق منها.', fr: 'Vous avez l’avis officiel ou une information plus précise ? Envoyez-la-nous pour vérification.' })}{' '}
              <Link href="/methodology#corrections" className="font-semibold underline">{t(locale, { ar: 'كيف تُبلغ عن خطأ', fr: 'Signaler une erreur' })}</Link>
            </p>
          </section>
        )}

        <Section id="share" title={t(locale, { ar: 'شارك مع من يحضّر معك', fr: 'Partagez avec ceux qui préparent avec vous' })} headingLevel="h2">
          <ShareButtons path={`/concours/${f.slug}`} title={name} />
        </Section>

        <FamilyFooterNote locale={locale} />
      </Container>

      {/* Mobile sticky CTA */}
      <div className="sticky bottom-0 z-20 border-t border-border bg-surface/95 p-3 backdrop-blur md:hidden" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
          <ButtonLink href={`/concours/${f.slug}/eligibility`} variant="secondary" size="sm" className="min-h-11">{t(locale, { ar: 'تحقق من أهليتك', fr: 'Éligibilité' })}</ButtonLink>
          <ButtonLink href={`/diagnostic/${f.slug}`} variant="accent" size="sm" className="min-h-11">{t(locale, { ar: 'الاختبار التشخيصي', fr: 'Diagnostic' })}</ButtonLink>
        </div>
      </div>
    </>
  );
}

function FamilyFooterNote({ locale }: { locale: Locale }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted">
      <ScrollText className="mt-0.5 size-4 shrink-0" aria-hidden />
      {t(locale, {
        ar: 'المعلومات معروضة كما وجدناها في مصادرها مع تاريخ آخر تحقق. في حال الاختلاف، البلاغ الرسمي هو المرجع الوحيد.',
        fr: 'Les informations sont présentées telles que trouvées dans leurs sources, avec la date de dernière vérification. En cas de divergence, seul l’avis officiel fait foi.',
      })}{' '}
      <Link href="/methodology" className="underline">{t(locale, { ar: 'منهجيتنا', fr: 'Notre méthodologie' })}</Link>
    </p>
  );
}

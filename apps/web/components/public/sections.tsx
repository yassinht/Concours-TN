import clsx from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, ExternalLink, Info } from 'lucide-react';
import type { Locale, Provenance } from '@ctn/shared';
import { ProvenanceBadge } from '@/components/ui/provenance';
import { t, type Bi } from '@/lib/i18n';
import { OFFICIAL_PORTAL } from './labels';

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('mx-auto w-full max-w-6xl px-4', className)}>{children}</div>;
}

export function Section({ id, className, title, lead, action, children, headingLevel = 'h2' }: {
  id?: string; className?: string; title?: ReactNode; lead?: ReactNode; action?: ReactNode; children: ReactNode; headingLevel?: 'h2' | 'h3';
}) {
  const H = headingLevel;
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={clsx('scroll-mt-28', className)}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            {title && <H id={headingId} className={clsx('font-extrabold', H === 'h2' ? 'text-xl sm:text-2xl' : 'text-lg')}>{title}</H>}
            {lead && <p className="mt-1 max-w-2xl text-sm text-muted sm:text-[15px]">{lead}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, lead, children, eyebrow }: { title: ReactNode; lead?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-border bg-surface">
      <Container className="py-6 sm:py-8">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">{title}</h1>
        {lead && <p className="mt-2 max-w-3xl text-[15px] text-muted sm:text-base">{lead}</p>}
        {children}
      </Container>
    </div>
  );
}

export function Breadcrumbs({ locale, items }: { locale: Locale; items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label={t(locale, { ar: 'مسار التنقل', fr: 'Fil d’Ariane' })} className="text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>/</span>}
            {it.href ? <Link href={it.href} className="inline-flex min-h-8 items-center hover:text-text hover:underline">{it.label}</Link> : <span aria-current="page" className="line-clamp-1">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** JSON-LD for rich results; `<` is escaped so content can never close the script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

/** Permanent "independent platform" notice, required on every concours page. */
export function IndependenceNotice({ locale, orgWebsite, className }: { locale: Locale; orgWebsite?: string | null; className?: string }) {
  return (
    <div className={clsx('flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm', className)} role="note">
      <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p>
        <strong>{t(locale, { ar: 'منصة مستقلة وليست الموقع الرسمي.', fr: 'Plateforme indépendante, pas le site officiel.' })}</strong>{' '}
        {t(locale, { ar: 'تحقق دائمًا من البلاغ الرسمي قبل الترشح على', fr: 'Vérifiez toujours l’avis officiel avant de candidater sur' })}{' '}
        <a href={OFFICIAL_PORTAL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline" dir="ltr">
          concours.gov.tn<ExternalLink className="size-3" aria-hidden />
        </a>
        {orgWebsite && (
          <>
            {' '}{t(locale, { ar: 'أو على موقع الهيكل المنظم', fr: 'ou sur le site de l’organisme' })}{' '}
            <a href={orgWebsite} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline" dir="ltr">
              {safeHost(orgWebsite)}<ExternalLink className="size-3" aria-hidden />
            </a>
          </>
        )}
        .
      </p>
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Legend of the four trust levels, rendered with the real badge component. */
export function ProvenanceLegend({ locale }: { locale: Locale }) {
  const mk = (sourceType: 'OFFICIAL' | 'SECONDARY' | 'COMMUNITY', needsVerification = false): Provenance => ({
    source: { id: sourceType, title: '', url: null, sourceType, publicationDate: null },
    confidence: 'HIGH',
    needsVerification,
  });
  const rows: { p: Provenance; text: Bi }[] = [
    { p: mk('OFFICIAL'), text: { ar: 'منقولة من نص رسمي (بلاغ، قرار، الرائد الرسمي، concours.gov.tn) مع اقتباس ورقم الصفحة، وراجعها إنسان.', fr: 'Reprise d’un texte officiel (avis, arrêté, JORT, concours.gov.tn) avec citation et page, relue par un humain.' } },
    { p: mk('SECONDARY'), text: { ar: 'من الصحافة أو مصدر جدي غير رسمي. مفيدة لكن تحقق منها في البلاغ.', fr: 'Presse ou source sérieuse non officielle. Utile, mais à confirmer dans l’avis.' } },
    { p: mk('COMMUNITY'), text: { ar: 'من تجارب مترشحين سابقين (مثل نوعية الأسئلة). نذكرها كما هي دون تعميم.', fr: 'Retours de candidats (type de questions…). Présentés comme tels, sans généralisation.' } },
    { p: mk('COMMUNITY', true), text: { ar: 'استنتاج أو تقدير لم نجد له نصًا رسميًا بعد. يُعرض كاقتراح، وليس كمعلومة رسمية أبدًا.', fr: 'Déduction ou estimation sans texte officiel trouvé. Affichée comme suggestion, jamais comme officielle.' } },
  ];
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((r, i) => (
        <li key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
          <div><ProvenanceBadge p={r.p} compact /></div>
          <p className="text-sm text-muted">{t(locale, r.text)}</p>
        </li>
      ))}
    </ul>
  );
}

/** Native disclosure (searchable with find-in-page, works without JS). */
export function Disclosure({ summary, children, name, open, className }: { summary: ReactNode; children: ReactNode; name?: string; open?: boolean; className?: string }) {
  return (
    <details name={name} open={open} className={clsx('group rounded-xl border border-border bg-surface', className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{summary}</span>
        <ChevronDown className="size-5 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4 text-[15px] text-muted">{children}</div>
    </details>
  );
}

/** Long-form text (legal pages, methodology) without a typography plugin. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'max-w-3xl text-[15px] leading-relaxed text-text',
        '[&_h2]:mt-10 [&_h2]:scroll-mt-28 [&_h2]:text-xl [&_h2]:font-extrabold [&_h3]:mt-6 [&_h3]:font-bold',
        '[&_p]:mt-3 [&_p]:text-muted [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:ps-5 [&_ul]:text-muted',
        '[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:ps-5 [&_ol]:text-muted [&_strong]:text-text',
        '[&_a]:font-semibold [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Honest banner on texts that still need a lawyer's review (docs/10-legal.md). */
export function DraftNotice({ locale, updated }: { locale: Locale; updated: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm" role="note">
      <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p>
        {t(locale, {
          ar: 'نص أولي في انتظار المراجعة القانونية النهائية، وقد يتغير. سنعلم المستعملين المسجلين بأي تغيير جوهري.',
          fr: 'Texte provisoire en attente de validation juridique ; il peut évoluer. Les utilisateurs inscrits seront informés de tout changement important.',
        })}{' '}
        <span className="text-muted">{t(locale, { ar: 'آخر تحديث', fr: 'Dernière mise à jour' })}: {updated}</span>
      </p>
    </div>
  );
}

/** Optional public contact address (NEXT_PUBLIC_CONTACT_EMAIL); nothing is shown when it is not configured. */
export function ContactLine({ locale }: { locale: Locale }) {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  if (!email) return null;
  return (
    <p>
      {t(locale, { ar: 'للتواصل معنا', fr: 'Nous contacter' })}: <a href={`mailto:${email}`} dir="ltr">{email}</a>
    </p>
  );
}

/**
 * Long text clamped to a few lines with a native "read more" toggle. The full text stays in the HTML
 * (searchable with find-in-page, indexable) and works without JavaScript.
 */
export function ClampText({ locale, text, lines = 4, threshold = 320, className }: { locale: Locale; text: string; lines?: 3 | 4 | 6; threshold?: number; className?: string }) {
  const cls = clsx('whitespace-pre-line', className);
  if (text.length <= threshold) return <p className={cls} dir="auto">{text}</p>;
  const clamp = { 3: 'line-clamp-3', 4: 'line-clamp-4', 6: 'line-clamp-6' }[lines];
  return (
    <details className="group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className={clsx('block', cls, clamp, 'group-open:line-clamp-none')} dir="auto">{text}</span>
        <span className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
          <span className="group-open:hidden">{t(locale, { ar: 'اقرأ المزيد', fr: 'Lire la suite' })}</span>
          <span className="hidden group-open:inline">{t(locale, { ar: 'عرض أقل', fr: 'Réduire' })}</span>
        </span>
      </summary>
    </details>
  );
}

import Link from 'next/link';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import type { Locale } from '@ctn/shared';
import { t } from '@/lib/i18n';
import { AuthCta, LangSwitch, NavLinks } from './header-client';
import { OFFICIAL_PORTAL } from './labels';

export function Logo({ locale }: { locale: Locale }) {
  return (
    <Link href="/" className="inline-flex min-h-11 items-center gap-2 font-extrabold tracking-tight" aria-label={t(locale, { ar: 'Concours TN — الصفحة الرئيسية', fr: 'Concours TN — accueil' })}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon.svg" alt="" width={32} height={32} className="size-8 rounded-lg" />
      <span dir="ltr" className="text-[17px]">Concours <span className="text-accent">TN</span></span>
    </Link>
  );
}

export function PublicHeader({ locale }: { locale: Locale }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1.5 md:flex-nowrap md:py-2">
        <div className="me-auto md:me-2">
          <Logo locale={locale} />
        </div>
        {/* On phones the language switch sits at the end of the nav row so the top row keeps logo + sign-in + CTA. */}
        <div className="order-last flex w-full min-w-0 items-center gap-1 md:order-none md:w-auto md:flex-1">
          <NavLinks className="min-w-0 flex-1" />
          <div className="shrink-0 pb-1 md:hidden"><LangSwitch /></div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden md:block"><LangSwitch /></div>
          <AuthCta />
        </div>
      </div>
    </header>
  );
}

const FOOTER_LINKS: { href: string; label: { ar: string; fr: string } }[] = [
  { href: '/methodology', label: { ar: 'كيف نتحقق من المعلومات', fr: 'Comment nous vérifions' } },
  { href: '/about', label: { ar: 'من نحن', fr: 'À propos' } },
  { href: '/pricing', label: { ar: 'الأسعار', fr: 'Tarifs' } },
  { href: '/calendar', label: { ar: 'رزنامة المناظرات', fr: 'Calendrier des concours' } },
  { href: '/alerts', label: { ar: 'تنبيهات المناظرات', fr: 'Alertes concours' } },
  { href: '/legal/privacy', label: { ar: 'سياسة الخصوصية', fr: 'Confidentialité' } },
  { href: '/legal/terms', label: { ar: 'شروط الاستعمال', fr: 'Conditions d’utilisation' } },
];

export function PublicFooter({ locale }: { locale: Locale }) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo locale={locale} />
          <p className="max-w-md text-sm text-muted">
            {t(locale, {
              ar: 'منصة تونسية مستقلة للتحضير للمناظرات العمومية: معلومات مرفقة بمصادرها، اختبارات تشخيصية، بنك أسئلة وخطة دراسة شخصية.',
              fr: 'Plateforme tunisienne indépendante de préparation aux concours publics : informations sourcées, tests diagnostiques, banque de questions et plan de révision personnalisé.',
            })}
          </p>
          <p className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-xs text-text">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              {t(locale, { ar: 'منصة مستقلة وليست الموقع الرسمي للمناظرات. الترشح الرسمي يتم عبر', fr: 'Plateforme indépendante, pas le site officiel des concours. Les candidatures officielles se font sur' })}{' '}
              <a href={OFFICIAL_PORTAL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline" dir="ltr">
                concours.gov.tn<ExternalLink className="size-3" aria-hidden />
              </a>{' '}
              {t(locale, { ar: 'ومواقع الهياكل المعنية.', fr: 'et les sites des organismes concernés.' })}
            </span>
          </p>
        </div>
        <nav aria-label={t(locale, { ar: 'روابط التذييل', fr: 'Liens de pied de page' })}>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {FOOTER_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center text-muted hover:text-text hover:underline">{t(locale, l.label)}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted">
          © {year} Concours TN · {t(locale, { ar: 'لا شعارات رسمية، لا أسئلة مسربة، لا وعود بالنجاح.', fr: 'Pas de logos officiels, pas de « fuites », pas de promesse de réussite.' })}
        </p>
      </div>
    </footer>
  );
}

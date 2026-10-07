import type { ReactNode } from 'react';
import { FollowsProvider } from '@/components/public/follows';
import { PublicFooter, PublicHeader } from '@/components/public/site-chrome';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:shadow">
        {t(locale, { ar: 'انتقل إلى المحتوى', fr: 'Aller au contenu' })}
      </a>
      <PublicHeader locale={locale} />
      <FollowsProvider>
        <main id="main" className="flex-1">{children}</main>
      </FollowsProvider>
      <PublicFooter locale={locale} />
    </div>
  );
}

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { getLocale } from '@/lib/i18n-server';
import { dirOf } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Concours TN — استعد لمناظرتك خطوة بخطوة', template: '%s · Concours TN' },
  description: 'منصة تونسية للتحضير للمناظرات العمومية: معلومات موثقة بمصادرها، اختبار تشخيصي، بنك أسئلة، امتحانات تجريبية وخطة دراسة شخصية.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'Concours TN', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#0e6b5c' }, { media: '(prefers-color-scheme: dark)', color: '#0f1412' }],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)} suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}

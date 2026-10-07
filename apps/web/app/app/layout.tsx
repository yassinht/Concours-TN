import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app/shell';
import { THEME_BOOT_SCRIPT } from '@/components/app/theme';

export const metadata: Metadata = {
  title: { default: 'فضائي', template: '%s · Concours TN' },
  // Personal space: never indexed.
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <AppShell>{children}</AppShell>
    </>
  );
}

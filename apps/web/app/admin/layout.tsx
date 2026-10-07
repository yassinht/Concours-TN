import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/shell';
import { THEME_BOOT_SCRIPT } from '@/components/app/theme';

export const metadata: Metadata = {
  title: { default: 'Back-office', template: '%s · Admin Concours TN' },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <AdminShell>{children}</AdminShell>
    </>
  );
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthHeader } from '@/components/app/auth/auth-ui';

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <AuthHeader />
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        {children}
      </main>
    </div>
  );
}

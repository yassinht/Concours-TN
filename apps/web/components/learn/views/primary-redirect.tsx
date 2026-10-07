'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ListTree } from 'lucide-react';
import { ButtonLink, EmptyState, PageLoader } from '@/components/ui';
import { useT } from '@/components/providers';
import { ErrorState } from '@/components/app/bits';
import { useEnrollments } from '../hooks';

/** Sends /app/syllabus and /app/checklist to the page of the primary enrollment. */
export function PrimaryFamilyRedirect({ to }: { to: 'syllabus' | 'checklist' }) {
  const tr = useT();
  const router = useRouter();
  const enr = useEnrollments();
  const slug = enr.primary?.familySlug;
  useEffect(() => {
    if (slug) router.replace(`/app/${to}/${encodeURIComponent(slug)}`);
  }, [slug, to, router]);
  if (enr.error) return <ErrorState error={enr.error} onRetry={() => void enr.reload()} />;
  if (enr.data && !slug) {
    return (
      <EmptyState
        icon={<ListTree className="size-8" aria-hidden />}
        title={tr({ ar: 'اختر مناظرتك أولًا', fr: 'Choisissez d’abord votre concours' })}
        action={<ButtonLink href="/app/onboarding">{tr({ ar: 'اختيار المناظرة', fr: 'Choisir le concours' })}</ButtonLink>}
      />
    );
  }
  return <PageLoader />;
}

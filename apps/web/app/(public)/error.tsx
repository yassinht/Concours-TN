'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, ButtonLink, EmptyState } from '@/components/ui';
import { useT } from '@/components/providers';

export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tr = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        icon={<RefreshCw className="size-8" aria-hidden />}
        title={tr({ ar: 'حدث خطأ أثناء تحميل الصفحة', fr: 'Une erreur est survenue lors du chargement' })}
        body={tr({ ar: 'قد يكون الخادم غير متاح مؤقتًا. أعد المحاولة بعد لحظات.', fr: 'Le serveur est peut-être momentanément indisponible. Réessayez dans un instant.' })}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>{tr({ ar: 'أعد المحاولة', fr: 'Réessayer' })}</Button>
            <ButtonLink href="/" variant="secondary">{tr({ ar: 'الصفحة الرئيسية', fr: 'Accueil' })}</ButtonLink>
          </div>
        }
      />
    </div>
  );
}

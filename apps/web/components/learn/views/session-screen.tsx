'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { SearchX, WifiOff } from 'lucide-react';
import { Alert, ButtonLink, EmptyState } from '@/components/ui';
import { useT } from '@/components/providers';
import { ErrorState, Skeleton } from '@/components/app/bits';
import { errorCode } from '@/components/app/use-api';
import { readLocal, useSessionApi, writeLocal } from '../hooks';
import { QuestionPlayer } from '../question-player';
import { isResult, type AttemptGet, type SessionView } from '../types';

/** The last opened session is kept on the device so a reload while offline can still continue it. */
const CACHE_KEY = 'ctn_last_session';

export function SessionScreen({ id }: { id: string }) {
  const tr = useT();
  const router = useRouter();
  const state = useSessionApi<AttemptGet>(`/attempts/${encodeURIComponent(id)}`);
  const code = state.error ? errorCode(state.error) : null;

  const cached = useMemo(() => {
    if (code !== 'NETWORK') return null;
    const c = readLocal<{ id: string; data: SessionView } | null>(CACHE_KEY, null);
    return c && c.id === id ? c.data : null;
  }, [code, id]);

  useEffect(() => {
    const d = state.data;
    if (!d) return;
    if (isResult(d)) {
      writeLocal(CACHE_KEY, null);
      router.replace(`/app/results/${id}`);
    } else {
      writeLocal(CACHE_KEY, { id, data: d });
    }
  }, [state.data, id, router]);

  if (state.data && !isResult(state.data)) return <QuestionPlayer key={id} session={state.data} />;
  if (cached) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="warning" title={tr({ ar: 'وضع دون اتصال', fr: 'Mode hors ligne' })}>
          <span className="inline-flex items-center gap-1.5"><WifiOff className="size-4" aria-hidden />{tr({ ar: 'تواصل الجلسة من نسخة محفوظة على جهازك؛ ستتم مزامنة إجاباتك عند عودة الاتصال.', fr: 'Session reprise depuis une copie locale ; vos réponses seront synchronisées au retour de la connexion.' })}</span>
        </Alert>
        <QuestionPlayer key={`${id}-offline`} session={cached} />
      </div>
    );
  }
  if (code === 'NOT_FOUND') {
    return (
      <EmptyState
        icon={<SearchX className="size-8" aria-hidden />}
        title={tr({ ar: 'هذه الجلسة غير موجودة', fr: 'Session introuvable' })}
        body={tr({ ar: 'ربما انتهت صلاحيتها أو تخص حسابًا آخر.', fr: 'Elle a peut-être expiré ou appartient à un autre compte.' })}
        action={<ButtonLink href="/app/practice">{tr({ ar: 'ابدأ تمرينًا جديدًا', fr: 'Nouvel entraînement' })}</ButtonLink>}
      />
    );
  }
  if (state.error) return <ErrorState error={state.error} onRetry={() => void state.reload()} />;
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={tr({ ar: 'جارٍ التحميل', fr: 'Chargement' })}>
      <Skeleton className="h-16" />
      <Skeleton className="h-72" />
      <Skeleton className="h-14" />
    </div>
  );
}

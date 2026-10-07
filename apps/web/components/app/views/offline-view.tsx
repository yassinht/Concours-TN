'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CloudDownload, Dumbbell, HardDrive, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, ProgressBar } from '@/components/ui';
import { useLocale, useSession, useT } from '@/components/providers';
import { api } from '@/lib/api';
import { formatDate, type Bi } from '@/lib/i18n';
import { PageHeader, Skeleton, UpsellCard } from '../bits';
import { bi, countLabel, errorText } from '../format';
import { MarkdownLite } from '../offline/markdown-lite';
import { OfflineQuiz, pickQuestions, QuizSetup } from '../offline/quiz';
import {
  cacheSupported, deletePack, downloadPack, formatBytes, listPacks, readPack, readStats, storageEstimate, type OfflinePack, type PackSummary,
} from '../offline/store';
import { errorCode, track } from '../use-api';

interface EnrollmentRow { id: string; familySlug: string; familyName_ar: string; familyName_fr: string; isPrimary: boolean }
type Mode = { kind: 'list' } | { kind: 'setup'; pack: OfflinePack } | { kind: 'quiz'; pack: OfflinePack; questions: OfflinePack['questions'] } | { kind: 'lessons'; pack: OfflinePack; lessonId: string | null };

export function OfflineView() {
  const tr = useT();
  const { locale } = useLocale();
  const { me } = useSession();
  const [supported, setSupported] = useState(true);
  const [online, setOnline] = useState(true);
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[] | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<Bi | null>(null);
  const [needsPremium, setNeedsPremium] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [opening, setOpening] = useState<string | null>(null);

  const refreshPacks = useCallback(async () => {
    setPacks(await listPacks().catch(() => []));
    setEstimate(await storageEstimate());
  }, []);

  useEffect(() => {
    const ok = cacheSupported();
    setSupported(ok);
    setOnline(navigator.onLine);
    if (ok) void refreshPacks();
    else setPacks([]);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [refreshPacks]);

  // Enrollments are only needed to offer downloads (online).
  const userId = me?.id;
  useEffect(() => {
    if (!userId || !online) return;
    api<EnrollmentRow[]>('/me/enrollments').then(setEnrollments).catch(() => setEnrollments([]));
  }, [userId, online]);

  async function download(e: EnrollmentRow) {
    setDownloading(e.familySlug);
    setError(null);
    setNeedsPremium(false);
    try {
      await downloadPack(e.familySlug, { familyName_ar: e.familyName_ar, familyName_fr: e.familyName_fr });
      track('offline_pack_download', { familySlug: e.familySlug });
      await refreshPacks();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'PREMIUM_REQUIRED') {
        setNeedsPremium(true);
        track('paywall_view', { from: 'offline', reason: 'offline' });
      } else {
        setError(errorText(code));
      }
    } finally {
      setDownloading(null);
    }
  }

  async function remove(slug: string) {
    await deletePack(slug);
    await refreshPacks();
  }

  async function open(slug: string, kind: 'setup' | 'lessons') {
    setOpening(slug);
    try {
      const pack = await readPack(slug);
      if (!pack) {
        setError({ ar: 'تعذّر فتح الحزمة. أعد تنزيلها.', fr: 'Impossible d’ouvrir le pack. Téléchargez-le à nouveau.' });
        return;
      }
      setMode(kind === 'setup' ? { kind: 'setup', pack } : { kind: 'lessons', pack, lessonId: null });
      window.scrollTo({ top: 0 });
    } finally {
      setOpening(null);
    }
  }

  const downloadable = useMemo(() => {
    const have = new Set((packs ?? []).map((p) => p.slug));
    return (enrollments ?? []).map((e) => ({ e, have: have.has(e.familySlug) }));
  }, [enrollments, packs]);

  if (mode.kind === 'quiz') {
    return (
      <>
        <PageHeader title={tr({ ar: 'تدرّب دون اتصال', fr: 'Entraînement hors ligne' })} />
        <OfflineQuiz slug={mode.pack.familySlug} questions={mode.questions} onExit={() => setMode({ kind: 'setup', pack: mode.pack })} />
      </>
    );
  }

  if (mode.kind === 'setup') {
    const stats = readStats(mode.pack.familySlug);
    return (
      <>
        <PageHeader title={tr({ ar: 'تدرّب دون اتصال', fr: 'Entraînement hors ligne' })} subtitle={countLabel(locale, mode.pack.questions.length, 'question')} />
        <div className="flex flex-col gap-3">
          <QuizSetup
            questions={mode.pack.questions}
            wrongCount={stats.wrong.length}
            onStart={(cfg) => {
              const qs = pickQuestions(mode.pack.questions, cfg, stats.wrong);
              if (qs.length) setMode({ kind: 'quiz', pack: mode.pack, questions: qs });
            }}
          />
          {stats.answered > 0 && (
            <p className="text-sm text-muted">{tr({ ar: `على هذا الجهاز: ${stats.answered} إجابة، دقة ${Math.round((stats.correct / stats.answered) * 100)}%`, fr: `Sur cet appareil : ${stats.answered} réponses, ${Math.round((stats.correct / stats.answered) * 100)} % de réussite` })}</p>
          )}
          <Button variant="ghost" onClick={() => setMode({ kind: 'list' })} className="self-start">{tr({ ar: 'العودة إلى الحزم', fr: 'Retour aux packs' })}</Button>
        </div>
      </>
    );
  }

  if (mode.kind === 'lessons') {
    const lesson = mode.lessonId ? mode.pack.lessons.find((l) => l.id === mode.lessonId) : null;
    if (lesson) {
      return (
        <>
          <PageHeader title={lesson.title} subtitle={bi(locale, lesson.topicTitle_ar, lesson.topicTitle_fr)} />
          <article className="card flex flex-col gap-3 p-4" lang={lesson.language === 'fr' || lesson.language === 'en' ? lesson.language : 'ar'}>
            {lesson.unreviewed && <Badge tone="warning" className="self-start">{tr({ ar: 'محتوى تجريبي — لم يُراجع بعد', fr: 'Contenu bêta — non relu' })}</Badge>}
            <MarkdownLite source={lesson.bodyMd} />
          </article>
          <Button variant="ghost" onClick={() => setMode({ ...mode, lessonId: null })} className="mt-3">{tr({ ar: 'كل الدروس', fr: 'Toutes les leçons' })}</Button>
        </>
      );
    }
    return (
      <>
        <PageHeader title={tr({ ar: 'الدروس دون اتصال', fr: 'Leçons hors ligne' })} subtitle={countLabel(locale, mode.pack.lessons.length, 'lesson')} />
        {mode.pack.lessons.length === 0 ? (
          <EmptyState icon={<BookOpen className="size-8" aria-hidden />} title={tr({ ar: 'لا توجد دروس في هذه الحزمة', fr: 'Aucune leçon dans ce pack' })} />
        ) : (
          <ul className="card divide-y divide-border">
            {mode.pack.lessons.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setMode({ ...mode, lessonId: l.id })} className="flex min-h-14 w-full flex-col items-start gap-0.5 p-3 text-start hover:bg-surface-2">
                  <span className="font-semibold" dir="auto">{l.title}</span>
                  <span className="text-xs text-muted">{bi(locale, l.topicTitle_ar, l.topicTitle_fr)} · {countLabel(locale, l.estMinutes, 'minute')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" onClick={() => setMode({ kind: 'list' })} className="mt-3">{tr({ ar: 'العودة إلى الحزم', fr: 'Retour aux packs' })}</Button>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={tr({ ar: 'التحضير دون اتصال', fr: 'Révision hors ligne' })}
        subtitle={tr({ ar: 'نزّل حزمة أسئلة ودروس مناظرتك وتدرّب في أي مكان، حتى دون إنترنت.', fr: 'Téléchargez un pack de questions et de leçons de votre concours et révisez partout, même sans Internet.' })}
      />

      {!online && (
        <Alert tone="warning"><span className="inline-flex items-center gap-2"><WifiOff className="size-4" aria-hidden />{tr({ ar: 'أنت غير متصل: يمكنك استعمال الحزم المحمّلة أدناه.', fr: 'Hors ligne : vous pouvez utiliser les packs téléchargés ci-dessous.' })}</span></Alert>
      )}
      {!supported && <Alert tone="warning">{tr({ ar: 'متصفحك لا يدعم التخزين دون اتصال. جرّب Chrome أو Safari حديثًا.', fr: 'Votre navigateur ne prend pas en charge le stockage hors ligne. Essayez un Chrome ou Safari récent.' })}</Alert>}
      {error && <Alert tone="danger">{tr(error)}</Alert>}

      <section aria-labelledby="packs-h" className="flex flex-col gap-2">
        <h2 id="packs-h" className="text-lg font-bold">{tr({ ar: 'الحزم المحمّلة على هذا الجهاز', fr: 'Packs sur cet appareil' })}</h2>
        {packs == null ? (
          <Skeleton className="h-28" />
        ) : packs.length === 0 ? (
          <EmptyState icon={<HardDrive className="size-8" aria-hidden />} title={tr({ ar: 'لا توجد حزمة محمّلة بعد', fr: 'Aucun pack téléchargé' })} body={online ? tr({ ar: 'نزّل حزمة مناظرتك أدناه وأنت متصل.', fr: 'Téléchargez le pack de votre concours ci-dessous pendant que vous êtes connecté.' }) : tr({ ar: 'اتصل بالإنترنت لتنزيل حزمة.', fr: 'Connectez-vous à Internet pour télécharger un pack.' })} />
        ) : (
          <ul className="flex flex-col gap-2">
            {packs.map((p) => (
              <li key={p.slug} className="card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-bold">{p.meta ? bi(locale, p.meta.familyName_ar, p.meta.familyName_fr) : p.slug}</span>
                    <span className="text-xs text-muted">
                      {countLabel(locale, p.questions, 'question')} · {countLabel(locale, p.lessons, 'lesson')} · {formatBytes(p.bytes, locale)}
                    </span>
                    <span className="text-xs text-muted">{tr({ ar: 'حُدّثت في', fr: 'Mis à jour le' })} {formatDate(locale, p.meta?.savedAt ?? p.generatedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <button type="button" onClick={() => remove(p.slug)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger" aria-label={tr({ ar: 'حذف الحزمة', fr: 'Supprimer le pack' })}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => open(p.slug, 'setup')} loading={opening === p.slug} disabled={p.questions === 0}><Dumbbell className="size-4" aria-hidden />{tr({ ar: 'تدرّب', fr: 'S’entraîner' })}</Button>
                  <Button variant="secondary" onClick={() => open(p.slug, 'lessons')} disabled={p.lessons === 0}><BookOpen className="size-4" aria-hidden />{tr({ ar: 'الدروس', fr: 'Leçons' })}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {estimate && (
          <div className="flex flex-col gap-1 text-xs text-muted">
            <ProgressBar value={(estimate.usage / estimate.quota) * 100} label={tr({ ar: 'مساحة التخزين المستعملة', fr: 'Stockage utilisé' })} className="h-1.5" />
            <span>{tr({ ar: 'المساحة المستعملة:', fr: 'Stockage utilisé :' })} {formatBytes(estimate.usage, locale)} / {formatBytes(estimate.quota, locale)}</span>
          </div>
        )}
      </section>

      {online && me && (
        <section aria-labelledby="dl-h" className="flex flex-col gap-2">
          <h2 id="dl-h" className="text-lg font-bold">{tr({ ar: 'تنزيل حزمة', fr: 'Télécharger un pack' })}</h2>
          {needsPremium && <UpsellCard reason="offline" guest={me.isGuest} />}
          {enrollments == null ? (
            <Skeleton className="h-20" />
          ) : downloadable.length === 0 ? (
            <p className="text-sm text-muted">{tr({ ar: 'اختر مناظرة أولًا من «حسابي».', fr: 'Choisissez d’abord un concours dans « Compte ».' })}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {downloadable.map(({ e, have }) => (
                <li key={e.familySlug} className={clsx('card flex flex-wrap items-center justify-between gap-2 p-3', e.isPrimary && 'border-primary')}>
                  <span className="flex flex-col">
                    <span className="font-semibold">{bi(locale, e.familyName_ar, e.familyName_fr)}</span>
                    {e.isPrimary && <span className="text-xs text-primary">{tr({ ar: 'مناظرتك الرئيسية', fr: 'Votre concours principal' })}</span>}
                  </span>
                  <Button size="sm" variant={have ? 'secondary' : 'primary'} onClick={() => download(e)} loading={downloading === e.familySlug} disabled={downloading != null} className="min-h-11">
                    {have ? <RefreshCw className="size-4" aria-hidden /> : <CloudDownload className="size-4" aria-hidden />}
                    {have ? tr({ ar: 'تحديث', fr: 'Mettre à jour' }) : tr({ ar: 'تنزيل', fr: 'Télécharger' })}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!me.premium.active && !needsPremium && (
            <p className="text-xs text-muted">{tr({ ar: 'الحزم دون اتصال متاحة لمشتركي بريميوم.', fr: 'Les packs hors ligne sont réservés aux abonnés Premium.' })}</p>
          )}
          <p className="text-xs text-muted">{tr({ ar: 'تحتوي الحزمة على أسئلة مع إجاباتها وشروحها ودروس مناظرتك. نتائج التدرب دون اتصال تبقى على هذا الجهاز.', fr: 'Le pack contient des questions avec corrigés et explications, et les leçons de votre concours. Les résultats hors ligne restent sur cet appareil.' })}</p>
        </section>
      )}
    </div>
  );
}

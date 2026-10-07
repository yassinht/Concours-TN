import { BookOpen, ClipboardCheck, Gauge, Layers, ListChecks, ListTree, Search, Timer } from 'lucide-react';
import type { Locale } from '@ctn/shared';
import { t, type Bi } from '@/lib/i18n';

const STEPS: { icon: typeof Search; label: Bi; hint: Bi }[] = [
  { icon: Search, label: { ar: 'المناظرة', fr: 'Le concours' }, hint: { ar: 'اختر مناظرتك ورتبتك', fr: 'Choisissez concours et grade' } },
  { icon: ClipboardCheck, label: { ar: 'الشروط', fr: 'Conditions' }, hint: { ar: 'هل تستوفيها؟', fr: 'Êtes-vous éligible ?' } },
  { icon: Layers, label: { ar: 'المراحل', fr: 'Épreuves' }, hint: { ar: 'كتابي، رياضي، شفاهي…', fr: 'Écrit, sport, oral…' } },
  { icon: ListTree, label: { ar: 'البرنامج', fr: 'Programme' }, hint: { ar: 'المواد والمحاور', fr: 'Matières et thèmes' } },
  { icon: BookOpen, label: { ar: 'الدروس', fr: 'Leçons' }, hint: { ar: 'ملخصات قصيرة', fr: 'Fiches courtes' } },
  { icon: ListChecks, label: { ar: 'أسئلة QCM', fr: 'QCM' }, hint: { ar: 'تدريب مع تصحيح', fr: 'Entraînement corrigé' } },
  { icon: Timer, label: { ar: 'امتحان تجريبي', fr: 'Examen blanc' }, hint: { ar: 'نفس الوقت والعدد', fr: 'Mêmes durée et format' } },
  { icon: Gauge, label: { ar: 'الجاهزية', fr: 'Préparation' }, hint: { ar: 'أين وصلت؟', fr: 'Où en êtes-vous ?' } },
];

/** The preparation path, from "which concours?" to "am I ready?". */
export function PrepPath({ locale }: { locale: Locale }) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={i} className="relative flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface p-3 text-center">
            <span className="absolute start-2 top-2 text-[11px] font-bold tabular-nums text-muted" aria-hidden>{i + 1}</span>
            <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="text-sm font-bold">{t(locale, s.label)}</span>
            <span className="text-xs text-muted">{t(locale, s.hint)}</span>
          </li>
        );
      })}
    </ol>
  );
}

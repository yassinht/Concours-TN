import type { Locale } from '@ctn/shared';
import { t, type Bi } from '@/lib/i18n';
import { Prose } from './sections';

export type DocBlock = Bi | { list: Bi[] } | { steps: Bi[] };
export interface DocSection { id?: string; title: Bi; body: DocBlock[] }

/** Renders a bilingual long-form document (legal texts) with a table of contents. */
export function LegalDoc({ locale, sections }: { locale: Locale; sections: DocSection[] }) {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
      <nav aria-label={t(locale, { ar: 'المحتويات', fr: 'Sommaire' })} className="lg:sticky lg:top-24 lg:self-start">
        <p className="text-sm font-bold">{t(locale, { ar: 'المحتويات', fr: 'Sommaire' })}</p>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {sections.map((s, i) => (
            <li key={i}>
              <a href={`#${s.id ?? `s${i + 1}`}`} className="inline-flex min-h-9 items-center text-muted hover:text-text hover:underline">
                {i + 1}. {t(locale, s.title)}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <Prose>
        {sections.map((s, i) => (
          <section key={i} aria-labelledby={s.id ?? `s${i + 1}`}>
            <h2 id={s.id ?? `s${i + 1}`}>{i + 1}. {t(locale, s.title)}</h2>
            {s.body.map((b, j) =>
              'list' in b ? (
                <ul key={j}>{b.list.map((x, k) => <li key={k}>{t(locale, x)}</li>)}</ul>
              ) : 'steps' in b ? (
                <ol key={j}>{b.steps.map((x, k) => <li key={k}>{t(locale, x)}</li>)}</ol>
              ) : (
                <p key={j}>{t(locale, b)}</p>
              ),
            )}
          </section>
        ))}
      </Prose>
    </div>
  );
}

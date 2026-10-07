import type { ReactNode } from 'react';

/**
 * Tiny, safe Markdown renderer for lessons. It builds React elements only (raw HTML is never injected), so a lesson
 * body can't run scripts. Supported: # headings, paragraphs, - / 1. lists, > quotes, --- rules, simple | pipe | tables,
 * **bold**, *italic*, `code` and [links](https://…) (http(s) only, opened in a new tab).
 */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) {
      out.push(<strong key={k} className="font-bold">{inline(tok.slice(2, -2), k)}</strong>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={k} className="rounded bg-surface-2 px-1 py-0.5 text-[0.92em]" dir="auto">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm ? safeHref(lm[2]) : null;
      out.push(href
        ? <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-2">{lm![1]}</a>
        : <span key={k}>{lm ? lm[1] : tok}</span>);
    } else {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    const k = `p${key++}`;
    blocks.push(<p key={k} dir="auto">{inline(para.join(' '), k)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${key++}`;
    const items = list.items.map((it, i) => <li key={`${k}-${i}`} dir="auto" className="ps-1">{inline(it, `${k}-${i}`)}</li>);
    blocks.push(list.ordered
      ? <ol key={k} className="list-decimal space-y-1.5 ps-6">{items}</ol>
      : <ul key={k} className="list-disc space-y-1.5 ps-6">{items}</ul>);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const k = `q${key++}`;
    blocks.push(<blockquote key={k} className="rounded-e-xl border-s-4 border-primary/50 bg-primary-soft/50 px-3 py-2" dir="auto">{inline(quote.join(' '), k)}</blockquote>);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) {
      flushAll();
    } else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushAll();
      blocks.push(<hr key={`r${key++}`} className="border-border" />);
    } else if (h) {
      flushAll();
      const k = `h${key++}`;
      const level = h[1].length;
      const content = inline(h[2], k);
      // Lesson headings sit under the page h1/h2: start at h3 to keep the outline valid.
      if (level <= 2) blocks.push(<h3 key={k} className={level === 1 ? 'pt-2 text-xl font-extrabold' : 'pt-2 text-lg font-bold'} dir="auto">{content}</h3>);
      else blocks.push(<h4 key={k} className="pt-1 font-bold" dir="auto">{content}</h4>);
    } else if (line.trim().startsWith('|') && n + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[n + 1])) {
      flushAll();
      const head = splitRow(line);
      const rows: string[][] = [];
      n += 2;
      while (n < lines.length && lines[n].trim().startsWith('|')) rows.push(splitRow(lines[n++]));
      n--;
      const k = `t${key++}`;
      blocks.push(
        <div key={k} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" dir="auto">
            <thead><tr>{head.map((c, i) => <th key={i} className="border border-border bg-surface-2 px-2 py-1.5 text-start font-semibold">{inline(c, `${k}h${i}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-border px-2 py-1.5 align-top">{inline(c, `${k}${ri}-${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (bullet || num) {
      flushPara();
      flushQuote();
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
    } else if (list && /^\s{2,}\S/.test(lines[n])) {
      // Continuation line of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  return <div className={className ?? 'flex flex-col gap-3 text-[15px] leading-loose'}>{blocks}</div>;
}

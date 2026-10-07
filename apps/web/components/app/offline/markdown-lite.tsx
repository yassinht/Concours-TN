import type { ReactNode } from 'react';

/**
 * Minimal, safe Markdown renderer for offline lessons (no HTML is ever injected):
 * headings (#, ##, ###), paragraphs, bullet / numbered lists, blockquotes, **bold**, *italic*, `code`.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-surface-2 px-1 py-0.5 text-[0.92em]" dir="auto">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownLite({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      const k = `p${key++}`;
      blocks.push(<p key={k} dir="auto">{inline(para.join(' '), k)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${key++}`;
      const items = list.items.map((it, i) => <li key={`${k}-${i}`} dir="auto">{inline(it, `${k}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={k} className="list-inside list-decimal space-y-1">{items}</ol> : <ul key={k} className="list-inside list-disc space-y-1">{items}</ul>);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const k = `h${key++}`;
      const level = h[1].length;
      const cls = level === 1 ? 'text-xl font-extrabold' : level === 2 ? 'text-lg font-bold' : 'font-bold';
      const content = inline(h[2], k);
      blocks.push(level <= 2 ? <h3 key={k} className={cls} dir="auto">{content}</h3> : <h4 key={k} className={cls} dir="auto">{content}</h4>);
    } else if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (quote) {
      flushPara();
      flushList();
      const k = `q${key++}`;
      blocks.push(<blockquote key={k} className="border-s-4 border-primary/40 ps-3 text-muted" dir="auto">{inline(quote[1], k)}</blockquote>);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="flex flex-col gap-3 leading-relaxed">{blocks}</div>;
}

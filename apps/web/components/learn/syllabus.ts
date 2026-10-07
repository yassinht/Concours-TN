/** Pure helpers over the syllabus tree (GET /catalog/syllabus/:slug). */
import type { Domain, SyllabusNodeDTO } from '@ctn/shared';

/** Leaves of the tree (topics), depth-first in authored order. */
export function leaves(nodes: SyllabusNodeDTO[]): SyllabusNodeDTO[] {
  const out: SyllabusNodeDTO[] = [];
  const walk = (list: SyllabusNodeDTO[]) => {
    for (const n of list) {
      if (n.children?.length) walk(n.children);
      else out.push(n);
    }
  };
  walk(nodes);
  return out;
}

/** Average known mastery (0..1) of a set of topics, null when none was practised. */
export function averageMastery(topics: SyllabusNodeDTO[]): number | null {
  const known = topics.map((t) => t.mastery).filter((m): m is number => typeof m === 'number');
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

export interface DomainGroup { domain: Domain; topics: SyllabusNodeDTO[]; mastery: number | null; questions: number }

/** Topics grouped by domain, in the order the domains first appear in the syllabus. */
export function byDomain(nodes: SyllabusNodeDTO[]): DomainGroup[] {
  const groups = new Map<Domain, SyllabusNodeDTO[]>();
  for (const t of leaves(nodes)) {
    const l = groups.get(t.domain) ?? [];
    l.push(t);
    groups.set(t.domain, l);
  }
  return [...groups].map(([domain, topics]) => ({
    domain,
    topics,
    mastery: averageMastery(topics),
    questions: topics.reduce((a, t) => a + (t.questionCount || 0), 0),
  }));
}

/** Case/diacritics-insensitive match on both titles and the key (Arabic tashkeel and French accents ignored). */
export function matches(n: SyllabusNodeDTO, q: string): boolean {
  if (!q) return true;
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ًͯ-ْٰ]/g, '').replace(/[إأآ]/g, 'ا').toLowerCase();
  const needle = fold(q.trim());
  return [n.title_ar, n.title_fr, n.key].some((s) => fold(s ?? '').includes(needle));
}

/** Prunes a tree to the branches that contain a match (a matching node keeps its whole subtree). */
export function filterTree(nodes: SyllabusNodeDTO[], q: string): SyllabusNodeDTO[] {
  if (!q.trim()) return nodes;
  const out: SyllabusNodeDTO[] = [];
  for (const n of nodes) {
    if (matches(n, q)) out.push(n);
    else if (n.children?.length) {
      const kids = filterTree(n.children, q);
      if (kids.length) out.push({ ...n, children: kids });
    }
  }
  return out;
}

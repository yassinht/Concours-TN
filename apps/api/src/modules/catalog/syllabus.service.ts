import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { shrunkMastery, type Domain, type SyllabusNodeDTO } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { learningObjectives, lessons, mastery, sources, syllabusNodes } from '../../db/schema';
import {
  DOMAIN_ORDER, VISIBLE_STATUSES, foldSql, inList, servableLessonStatuses, servableQuestionStatuses, toSource, type SourceRow,
} from './catalog.util';

interface NodeRow {
  id: string;
  key: string;
  parentId: string | null;
  level: SyllabusNodeDTO['level'];
  domain: Domain;
  titleAr: string;
  titleFr: string;
  orderIndex: number;
  scope: SyllabusNodeDTO['scope'];
  sourceId: string | null;
}

export interface LessonItem { id: string; title: string; bodyMd: string; estMinutes: number; unreviewed: boolean; language: string }

/**
 * Curriculum read-side: a family's syllabus = nodes linked in family_syllabus + the family's own nodes, with all descendants.
 * A question is usable by a family when it is general and its topic is in that syllabus, or when it is linked to the family.
 */
@Injectable()
export class SyllabusService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** SQL returning the ids of the visible syllabus nodes of a family (recursive over children). */
  familyNodeIdsSql(familyId: string) {
    return sql`
      with recursive base as (
        select fs.node_id as id from family_syllabus fs where fs.family_id = ${familyId}
        union
        select n.id from syllabus_nodes n where n.family_id = ${familyId}
      ), tree as (
        select n.id from syllabus_nodes n join base b on b.id = n.id where n.status in ${inList(VISIBLE_STATUSES)}
        union
        select c.id from syllabus_nodes c join tree t on c.parent_id = t.id where c.status in ${inList(VISIBLE_STATUSES)}
      )
      select id from tree`;
  }

  /** Servable-question predicate on alias `q` (status, validity) as SQL. */
  private servableSql() {
    return sql`q.status in ${inList(servableQuestionStatuses())} and (q.valid_until is null or q.valid_until >= ${tunisToday()})`;
  }

  /** Number of servable questions usable by each family (all families when ids omitted). Set-based: hash joins, no per-row lookups. */
  async questionCountsByFamily(familyIds?: string[]): Promise<Map<string, number>> {
    if (familyIds && !familyIds.length) return new Map();
    const fsFilter = familyIds ? sql`where fs.family_id in ${inList(familyIds)}` : sql``;
    const ownFilter = familyIds ? sql`and n.family_id in ${inList(familyIds)}` : sql``;
    const qfFilter = familyIds ? sql`where qf.family_id in ${inList(familyIds)}` : sql``;
    const res = await this.db.execute<{ family_id: string; n: string }>(sql`
      with recursive base as (
        select fs.family_id, fs.node_id as id from family_syllabus fs ${fsFilter}
        union
        select n.family_id, n.id from syllabus_nodes n where n.family_id is not null ${ownFilter}
      ), tree as (
        select b.family_id, n.id from syllabus_nodes n join base b on b.id = n.id where n.status in ${inList(VISIBLE_STATUSES)}
        union
        select t.family_id, c.id from syllabus_nodes c join tree t on c.parent_id = t.id where c.status in ${inList(VISIBLE_STATUSES)}
      ), usable as (
        select t.family_id, q.id from tree t join questions q on q.topic_id = t.id and q.is_general and ${this.servableSql()}
        union
        select qf.family_id, q.id from question_families qf join questions q on q.id = qf.question_id and ${this.servableSql()} ${qfFilter}
      )
      select u.family_id, count(*)::text as n from usable u
      join competition_families f on f.id = u.family_id and f.status in ${inList(VISIBLE_STATUSES)}
      group by u.family_id`);
    return new Map(res.rows.map((r) => [r.family_id, Number(r.n)]));
  }

  /** Servable question counts per topic for a family (or globally when familyId is null). */
  private async questionCountsByTopic(familyId: string | null, nodeIds: string[]): Promise<Map<string, number>> {
    if (!nodeIds.length) return new Map();
    const usable = familyId
      ? sql`and (q.is_general or exists (select 1 from question_families qf where qf.family_id = ${familyId} and qf.question_id = q.id))`
      : sql``;
    const res = await this.db.execute<{ topic_id: string; n: string }>(sql`
      select q.topic_id, count(*)::text as n from questions q
      where ${this.servableSql()} and q.topic_id in ${inList(nodeIds)} ${usable}
      group by q.topic_id`);
    return new Map(res.rows.map((r) => [r.topic_id, Number(r.n)]));
  }

  private async loadNodes(ids: string[]): Promise<NodeRow[]> {
    if (!ids.length) return [];
    return this.db
      .select({
        id: syllabusNodes.id, key: syllabusNodes.key, parentId: syllabusNodes.parentId, level: syllabusNodes.level, domain: syllabusNodes.domain,
        titleAr: syllabusNodes.titleAr, titleFr: syllabusNodes.titleFr, orderIndex: syllabusNodes.orderIndex, scope: syllabusNodes.scope,
        sourceId: syllabusNodes.sourceId,
      })
      .from(syllabusNodes)
      .where(inArray(syllabusNodes.id, ids));
  }

  /** Builds DTOs (flat) for the given nodes with counts, sources, objectives, lessons and optional mastery. */
  private async decorate(nodes: NodeRow[], familyId: string | null, userId: string | null): Promise<Decorated> {
    const ids = nodes.map((n) => n.id);
    const sourceIds = [...new Set(nodes.map((n) => n.sourceId).filter((s): s is string => !!s))];
    const [srcRows, objRows, lessonRows, counts, masteryRows] = await Promise.all([
      sourceIds.length
        ? this.db.select({ id: sources.id, title: sources.title, url: sources.url, sourceType: sources.sourceType, publicationDate: sources.publicationDate, lastVerifiedAt: sources.lastVerifiedAt }).from(sources).where(inArray(sources.id, sourceIds))
        : Promise.resolve([] as SourceRow[]),
      ids.length
        ? this.db.select({ nodeId: learningObjectives.nodeId, key: learningObjectives.key, textAr: learningObjectives.textAr, textFr: learningObjectives.textFr })
          .from(learningObjectives).where(and(inArray(learningObjectives.nodeId, ids), inArray(learningObjectives.status, VISIBLE_STATUSES))).orderBy(learningObjectives.key)
        : Promise.resolve([]),
      ids.length
        ? this.db.selectDistinct({ nodeId: lessons.nodeId }).from(lessons).where(and(inArray(lessons.nodeId, ids), inArray(lessons.status, servableLessonStatuses())))
        : Promise.resolve([]),
      this.questionCountsByTopic(familyId, ids),
      userId && ids.length
        ? this.db.select({ nodeId: mastery.nodeId, rating: mastery.rating, attempts: mastery.attempts }).from(mastery).where(and(eq(mastery.userId, userId), inArray(mastery.nodeId, ids)))
        : Promise.resolve([]),
    ]);
    const srcById = new Map(srcRows.map((s) => [s.id, s]));
    const keyById = new Map(nodes.map((n) => [n.id, n.key]));
    const withLesson = new Set(lessonRows.map((l) => l.nodeId));
    const masteryById = new Map(masteryRows.map((m) => [m.nodeId, m]));
    const out = new Map<string, SyllabusNodeDTO>();
    for (const n of nodes) {
      const m = masteryById.get(n.id);
      out.set(n.id, {
        id: n.id, key: n.key, parentKey: n.parentId ? keyById.get(n.parentId) ?? null : null, level: n.level, domain: n.domain,
        title_ar: n.titleAr, title_fr: n.titleFr, scope: n.scope, source: toSource(srcById.get(n.sourceId ?? '')),
        questionCount: counts.get(n.id) ?? 0,
        ...(userId ? { mastery: m && m.attempts > 0 ? round3(shrunkMastery(m.rating, m.attempts)) : null } : {}),
        hasLesson: withLesson.has(n.id),
        objectives: objRows.filter((o) => o.nodeId === n.id).map((o) => ({ key: o.key, text_ar: o.textAr, text_fr: o.textFr })),
      });
    }
    // Parent keys of nodes whose parent is outside the set are resolved lazily (rare: partial trees).
    const missingParents = nodes.filter((n) => n.parentId && !keyById.has(n.parentId)).map((n) => n.parentId!);
    if (missingParents.length) {
      const parents = await this.db.select({ id: syllabusNodes.id, key: syllabusNodes.key }).from(syllabusNodes).where(inArray(syllabusNodes.id, missingParents));
      const pk = new Map(parents.map((p) => [p.id, p.key]));
      for (const n of nodes) if (n.parentId && pk.has(n.parentId)) out.get(n.id)!.parentKey = pk.get(n.parentId)!;
    }
    return { dtos: out, attempts: new Map(masteryRows.map((m) => [m.nodeId, m.attempts])) };
  }

  /** Nested syllabus tree of a family (shared + specialty nodes); `mastery` is filled when userId is given. */
  async familyTree(familyId: string, userId: string | null): Promise<SyllabusNodeDTO[]> {
    const res = await this.db.execute<{ id: string }>(this.familyNodeIdsSql(familyId));
    const nodes = await this.loadNodes(res.rows.map((r) => r.id));
    return buildTree(nodes, await this.decorate(nodes, familyId, userId), !!userId);
  }

  async familyTreeBySlug(slug: string, userId: string | null): Promise<SyllabusNodeDTO[]> {
    const [f] = await this.db.execute<{ id: string }>(sql`select id from competition_families where slug = ${slug} and status in ${inList(VISIBLE_STATUSES)}`).then((r) => r.rows);
    if (!f) throw new NotFoundException('NOT_FOUND');
    return this.familyTree(f.id, userId);
  }

  /** Topic (with its children) and its lessons; requested language first, other languages as fallback. */
  async lessons(topicKey: string, lang: 'ar' | 'fr' | 'en' | undefined, userId: string | null): Promise<{ topic: SyllabusNodeDTO; lessons: Omit<LessonItem, 'language'>[] }> {
    const [node] = await this.db
      .select({ id: syllabusNodes.id })
      .from(syllabusNodes)
      .where(and(eq(syllabusNodes.key, topicKey), inArray(syllabusNodes.status, VISIBLE_STATUSES)))
      .limit(1);
    if (!node) throw new NotFoundException('NOT_FOUND');
    const childIds = await this.db
      .select({ id: syllabusNodes.id })
      .from(syllabusNodes)
      .where(and(eq(syllabusNodes.parentId, node.id), inArray(syllabusNodes.status, VISIBLE_STATUSES)));
    const nodes = await this.loadNodes([node.id, ...childIds.map((c) => c.id)]);
    const [topic] = buildTree(nodes, await this.decorate(nodes, null, userId), !!userId).filter((t) => t.id === node.id);

    const rows = await this.db
      .select({ id: lessons.id, title: lessons.title, bodyMd: lessons.bodyMd, estMinutes: lessons.estMinutes, status: lessons.status, language: lessons.language })
      .from(lessons)
      .where(and(eq(lessons.nodeId, node.id), inArray(lessons.status, servableLessonStatuses())))
      .orderBy(lessons.title);
    const inLang = lang ? rows.filter((r) => r.language === lang) : rows;
    const chosen = inLang.length ? inLang : rows;
    return {
      topic,
      lessons: chosen.map((r) => ({ id: r.id, title: r.title, bodyMd: r.bodyMd, estMinutes: r.estMinutes, unreviewed: r.status === 'AI_REVIEWED' })),
    };
  }

  /** Topic search on folded titles/keys (shared with /catalog/search). */
  async searchTopics(pattern: string, limit = 20): Promise<{ key: string; title_ar: string; title_fr: string; domain: Domain }[]> {
    const res = await this.db.execute<{ key: string; title_ar: string; title_fr: string; domain: Domain }>(sql`
      select n.key, n.title_ar, n.title_fr, n.domain from syllabus_nodes n
      where n.status in ${inList(VISIBLE_STATUSES)}
        and (${foldSql(sql`n.title_ar`)} ilike ${pattern}
          or ${foldSql(sql`n.title_fr`)} ilike ${pattern}
          or lower(n.key) ilike ${pattern})
      order by case n.level when 'TOPIC' then 0 when 'UNIT' then 1 else 2 end, n.key
      limit ${limit}`);
    return res.rows.map((r) => ({ key: r.key, title_ar: r.title_ar, title_fr: r.title_fr, domain: r.domain }));
  }
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

interface Decorated {
  dtos: Map<string, SyllabusNodeDTO>;
  /** Mastery attempts per node id (for attempts-weighted aggregation onto parents). */
  attempts: Map<string, number>;
}

function compareNodes(a: NodeRow, b: NodeRow): number {
  return (DOMAIN_ORDER.get(a.domain) ?? 99) - (DOMAIN_ORDER.get(b.domain) ?? 99) || a.orderIndex - b.orderIndex || a.key.localeCompare(b.key);
}

/** Nests DTOs under their parents; parent counts include descendants, parent mastery is the attempts-weighted mean. */
function buildTree(nodes: NodeRow[], { dtos, attempts: attemptsById }: Decorated, withMastery: boolean): SyllabusNodeDTO[] {
  const sorted = [...nodes].sort(compareNodes);
  const roots: SyllabusNodeDTO[] = [];
  for (const n of sorted) {
    const dto = dtos.get(n.id)!;
    const parent = n.parentId ? dtos.get(n.parentId) : undefined;
    if (parent) (parent.children ??= []).push(dto);
    else roots.push(dto);
  }
  const aggregate = (d: SyllabusNodeDTO): { count: number; weighted: number; attempts: number } => {
    const own = attemptsById.get(d.id) ?? 0;
    let count = d.questionCount;
    let weighted = own && d.mastery != null ? d.mastery * own : 0;
    let attempts = own && d.mastery != null ? own : 0;
    for (const c of d.children ?? []) {
      const r = aggregate(c);
      count += r.count;
      weighted += r.weighted;
      attempts += r.attempts;
    }
    d.questionCount = count;
    if (withMastery && d.children?.length) d.mastery = attempts > 0 ? round3(weighted / attempts) : null;
    return { count, weighted, attempts };
  };
  for (const r of roots) aggregate(r);
  return roots;
}


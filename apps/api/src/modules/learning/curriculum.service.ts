import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DOMAINS, type Domain, type DomainWeight } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { blueprints, competitionFamilies, enrollments, positions } from '../../db/schema';
import { VISIBLE_STATUSES, inList, servableLessonStatuses, servableQuestionStatuses } from '../catalog/catalog.util';

export interface FamilyRef {
  id: string;
  slug: string;
}

export interface FamilyTopic {
  id: string;
  key: string;
  domain: Domain;
  titleAr: string;
  titleFr: string;
}

export interface ExamFormat {
  /** Questions (or minutes when counts are missing) per domain in the blueprint; empty when there is no blueprint. */
  domainSizes: Map<Domain, number>;
  fidelity: 'OFFICIAL_FORMAT' | 'APPROXIMATED' | null;
  blueprintId: string | null;
}

export interface WeightPlan {
  /** Domains that are both in the exam and covered by the syllabus (input for computeReadiness / buildDailyPlan). */
  weights: DomainWeight[];
  /** Exam domains with no syllabus topic on the platform yet, with their share of the exam (0..1). */
  uncovered: { domain: Domain; share: number }[];
  formatOfficial: boolean;
}

interface BlueprintSection {
  domain?: unknown;
  count?: unknown;
  minutes?: unknown;
}

const isDomain = (v: unknown): v is Domain => typeof v === 'string' && (DOMAINS as readonly string[]).includes(v);
const positiveNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Sums blueprint sections per domain: question counts, or minutes when the blueprint gives no counts. */
export function sectionSizes(sections: unknown): Map<Domain, number> {
  const list: BlueprintSection[] = Array.isArray(sections) ? (sections as BlueprintSection[]) : [];
  const sum = (pick: (s: BlueprintSection) => number) => {
    const out = new Map<Domain, number>();
    for (const s of list) {
      if (!s || !isDomain(s.domain)) continue;
      const v = pick(s);
      if (v > 0) out.set(s.domain, (out.get(s.domain) ?? 0) + v);
    }
    return out;
  };
  const byCount = sum((s) => positiveNumber(s.count));
  return byCount.size ? byCount : sum((s) => positiveNumber(s.minutes));
}

/**
 * Domain weights for a family: blueprint sizes when a blueprint exists (domains without any topic are reported as
 * uncovered instead of dragging every score down), equal weights over the syllabus domains otherwise.
 */
export function planWeights(format: ExamFormat, topics: FamilyTopic[]): WeightPlan {
  const topicCount = new Map<Domain, number>();
  for (const t of topics) topicCount.set(t.domain, (topicCount.get(t.domain) ?? 0) + 1);
  const formatOfficial = format.fidelity === 'OFFICIAL_FORMAT';

  if (!format.domainSizes.size) {
    const weights = DOMAINS.filter((d) => topicCount.has(d)).map((domain) => ({ domain, weight: 1, topicCount: topicCount.get(domain)! }));
    return { weights, uncovered: [], formatOfficial };
  }
  const total = [...format.domainSizes.values()].reduce((a, b) => a + b, 0);
  const weights: DomainWeight[] = [];
  const uncovered: WeightPlan['uncovered'] = [];
  for (const domain of DOMAINS) {
    const size = format.domainSizes.get(domain);
    if (!size) continue;
    const n = topicCount.get(domain) ?? 0;
    if (n > 0) weights.push({ domain, weight: size, topicCount: n });
    else uncovered.push({ domain, share: size / total });
  }
  return { weights, uncovered, formatOfficial };
}

/** Read-side curriculum queries shared by readiness and the daily plan. */
@Injectable()
export class CurriculumService {
  constructor(@InjectDb() private readonly db: Database) {}

  async familyBySlug(slug: string): Promise<FamilyRef | null> {
    const [f] = await this.db
      .select({ id: competitionFamilies.id, slug: competitionFamilies.slug })
      .from(competitionFamilies)
      .where(and(eq(competitionFamilies.slug, slug), inArray(competitionFamilies.status, VISIBLE_STATUSES)))
      .limit(1);
    return f ?? null;
  }

  async familyById(id: string): Promise<FamilyRef | null> {
    const [f] = await this.db
      .select({ id: competitionFamilies.id, slug: competitionFamilies.slug })
      .from(competitionFamilies)
      .where(eq(competitionFamilies.id, id))
      .limit(1);
    return f ?? null;
  }

  /** TOPIC nodes of a family: linked nodes (family_syllabus) and the family's own nodes, with their whole subtrees. */
  async topics(familyId: string): Promise<FamilyTopic[]> {
    const res = await this.db.execute<{ id: string; key: string; domain: Domain; title_ar: string; title_fr: string }>(sql`
      with recursive base as (
        select fs.node_id as id from family_syllabus fs where fs.family_id = ${familyId}
        union
        select n.id from syllabus_nodes n where n.family_id = ${familyId}
      ), tree as (
        select n.id, 0 as depth from syllabus_nodes n join base b on b.id = n.id where n.status in ${inList(VISIBLE_STATUSES)}
        union
        select c.id, t.depth + 1 from syllabus_nodes c join tree t on c.parent_id = t.id
        where c.status in ${inList(VISIBLE_STATUSES)} and t.depth < 6
      )
      select distinct n.id, n.key, n.domain, n.title_ar, n.title_fr, n.order_index
      from syllabus_nodes n join tree t on t.id = n.id
      where n.level = 'TOPIC'
      order by n.domain, n.order_index, n.key`);
    return res.rows.map((r) => ({ id: r.id, key: r.key, domain: r.domain, titleAr: r.title_ar, titleFr: r.title_fr }));
  }

  /**
   * Exam format used for weights: the blueprint of the user's enrolled position for this family, else the blueprint of
   * the family's first position (by order) that has one.
   */
  async examFormat(userId: string, familyId: string): Promise<ExamFormat> {
    const [enr] = await this.db
      .select({ positionId: enrollments.positionId })
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.familyId, familyId)))
      .limit(1);
    const rows = await this.db
      .select({ id: blueprints.id, positionId: blueprints.positionId, fidelity: blueprints.fidelity, sections: blueprints.sections })
      .from(blueprints)
      .innerJoin(positions, eq(positions.id, blueprints.positionId))
      .where(and(eq(positions.familyId, familyId), inArray(positions.status, VISIBLE_STATUSES), inArray(blueprints.status, VISIBLE_STATUSES)))
      .orderBy(asc(positions.orderIndex), asc(positions.slug), asc(blueprints.title));
    const chosen = (enr?.positionId ? rows.find((r) => r.positionId === enr.positionId) : undefined) ?? rows[0];
    if (!chosen) return { domainSizes: new Map(), fidelity: null, blueprintId: null };
    return {
      domainSizes: sectionSizes(chosen.sections),
      fidelity: chosen.fidelity === 'OFFICIAL_FORMAT' ? 'OFFICIAL_FORMAT' : 'APPROXIMATED',
      blueprintId: chosen.id,
    };
  }

  /** Servable questions usable by the family, per topic (general questions or questions linked to the family). */
  async servableQuestionCounts(familyId: string, topicIds: string[]): Promise<Map<string, number>> {
    if (!topicIds.length) return new Map();
    const res = await this.db.execute<{ topic_id: string; n: number }>(sql`
      select q.topic_id, count(*)::int as n from questions q
      where q.topic_id in ${inList(topicIds)}
        and q.status in ${inList(servableQuestionStatuses())}
        and (q.valid_until is null or q.valid_until >= ${tunisToday()})
        and (q.is_general or exists (select 1 from question_families qf where qf.family_id = ${familyId} and qf.question_id = q.id))
      group by q.topic_id`);
    return new Map(res.rows.map((r) => [r.topic_id, Number(r.n)]));
  }

  /** Topics (among the given ids) that have at least one servable lesson. */
  async topicsWithLessons(topicIds: string[]): Promise<Set<string>> {
    if (!topicIds.length) return new Set();
    const res = await this.db.execute<{ node_id: string }>(sql`
      select distinct l.node_id from lessons l
      where l.node_id in ${inList(topicIds)} and l.status in ${inList(servableLessonStatuses())}`);
    return new Set(res.rows.map((r) => r.node_id));
  }

  /** Next known exam date of the family (today or later), from its published editions. */
  async nextExamDate(familyId: string, today: string): Promise<string | null> {
    const res = await this.db.execute<{ exam_date: string }>(sql`
      select to_char(c.exam_date, 'YYYY-MM-DD') as exam_date from competitions c
      where c.family_id = ${familyId} and c.exam_date is not null and c.exam_date >= ${today}
        and c.content_status in ${inList(VISIBLE_STATUSES)}
      order by c.exam_date asc limit 1`);
    return res.rows[0]?.exam_date ?? null;
  }
}

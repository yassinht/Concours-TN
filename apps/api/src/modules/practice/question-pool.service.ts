import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { START_RATING, shrunkMastery, type Domain } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { POOL_SAMPLE, VISIBLE_NODE_STATUSES, inList, likePrefix, servableStatuses } from './practice.util';
import { shuffle, type Candidate } from './selection';

export interface PoolFilter {
  userId: string;
  /** Family scope: general questions whose topic is in the family syllabus tree, or questions linked to the family. */
  familyId?: string | null;
  /** Restrict to these syllabus nodes and their descendants (null = no topic filter, [] = nothing matches). */
  topicRootIds?: string[] | null;
  domains?: Domain[] | null;
  excludeIds?: string[];
  limit?: number;
}

/**
 * QuestionPool: which questions a user may be served, with their history on each (freshness, topic rating).
 * Only servable content (status + validity) is returned; selection strategies live in ./selection.ts.
 */
@Injectable()
export class QuestionPoolService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Servable-question predicate on alias `q` (status, not expired). */
  servableSql(): SQL {
    return sql`q.status in ${inList(servableStatuses())} and (q.valid_until is null or q.valid_until >= ${tunisToday()})`;
  }

  /** Recursive CTEs `fam_base` + `fam_tree`: nodes linked to the family (or owned by it) and all their visible descendants. */
  familyTreeCtes(familyId: string): SQL {
    const visible = inList(VISIBLE_NODE_STATUSES);
    return sql`fam_base as (
        select fs.node_id as id from family_syllabus fs where fs.family_id = ${familyId}
        union
        select n.id from syllabus_nodes n where n.family_id = ${familyId}
      ), fam_tree as (
        select n.id from syllabus_nodes n join fam_base b on b.id = n.id where n.status in ${visible}
        union
        select c.id from syllabus_nodes c join fam_tree t on c.parent_id = t.id where c.status in ${visible}
      )`;
  }

  /** Family-usable predicate on alias `q` (requires the fam_* CTEs unless a topic filter already scopes the topics). */
  private familyPredicate(familyId: string, topicScoped: boolean): SQL {
    const linked = sql`exists (select 1 from question_families qf where qf.question_id = q.id and qf.family_id = ${familyId})`;
    return topicScoped
      ? sql`(q.is_general or ${linked})`
      : sql`((q.is_general and q.topic_id in (select id from fam_tree)) or ${linked})`;
  }

  async candidates(f: PoolFilter): Promise<Candidate[]> {
    if (f.topicRootIds && !f.topicRootIds.length) return [];
    if (f.domains && !f.domains.length) return [];
    const visible = inList(VISIBLE_NODE_STATUSES);
    const ctes: SQL[] = [];
    const where: SQL[] = [this.servableSql()];

    if (f.familyId) {
      if (!f.topicRootIds) ctes.push(this.familyTreeCtes(f.familyId));
      where.push(this.familyPredicate(f.familyId, !!f.topicRootIds));
    } else {
      // Without a family, family-specific questions stay with their families.
      where.push(sql`q.is_general`);
    }
    if (f.topicRootIds) {
      ctes.push(sql`root_tree as (
          select n.id from syllabus_nodes n where n.id in ${inList(f.topicRootIds)}
          union
          select c.id from syllabus_nodes c join root_tree t on c.parent_id = t.id where c.status in ${visible}
        )`);
      where.push(sql`q.topic_id in (select id from root_tree)`);
    }
    if (f.domains) where.push(sql`q.domain in ${inList(f.domains)}`);
    if (f.excludeIds?.length) where.push(sql`q.id not in ${inList(f.excludeIds)}`);
    ctes.push(sql`recent as (
        select distinct aa.question_id from attempt_answers aa join attempts a on a.id = aa.attempt_id
        where a.user_id = ${f.userId} and aa.answered_at > now() - interval '24 hours'
      )`);

    const res = await this.db.execute<{
      id: string; topic_id: string; domain: Domain; difficulty: Candidate['difficulty']; rating: number;
      times_seen: number; last_correct: boolean | null; user_rating: number | null; recent: boolean;
    }>(sql`
      with recursive ${sql.join(ctes, sql`, `)}
      select q.id, q.topic_id, q.domain, q.difficulty, q.rating, coalesce(s.times_seen, 0)::int as times_seen,
             s.last_correct, m.rating as user_rating,
             (r.question_id is not null or coalesce(s.last_answered_at > now() - interval '24 hours', false)) as recent
      from questions q
      join syllabus_nodes n on n.id = q.topic_id and n.status in ${visible}
      left join user_question_state s on s.user_id = ${f.userId} and s.question_id = q.id
      left join mastery m on m.user_id = ${f.userId} and m.node_id = q.topic_id
      left join recent r on r.question_id = q.id
      where ${sql.join(where, sql` and `)}
      order by random()
      limit ${f.limit ?? POOL_SAMPLE}`);

    return res.rows.map((r) => ({
      id: r.id,
      topicId: r.topic_id,
      domain: r.domain,
      difficulty: r.difficulty,
      rating: Number(r.rating),
      userRating: r.user_rating == null ? null : Number(r.user_rating),
      timesSeen: Number(r.times_seen),
      lastCorrect: r.last_correct,
      recent: !!r.recent,
    }));
  }

  /**
   * Node ids for a key: the node with exactly that key, else every node whose key extends it (`spec.douane` → `spec.douane.*`).
   * Blueprint specialty keys are sometimes broader than the syllabus nodes that exist.
   */
  async nodesByKeyOrPrefix(key: string): Promise<string[]> {
    const res = await this.db.execute<{ id: string }>(sql`
      select n.id from syllabus_nodes n
      where n.status in ${inList(VISIBLE_NODE_STATUSES)}
        and (n.key = ${key} or (n.key like ${likePrefix(key)} and not exists (select 1 from syllabus_nodes x where x.key = ${key})))`);
    return res.rows.map((r) => r.id);
  }

  /** The given nodes and all their visible descendants. */
  async subtreeIds(rootIds: readonly string[]): Promise<Set<string>> {
    if (!rootIds.length) return new Set();
    const res = await this.db.execute<{ id: string }>(sql`
      with recursive t as (
        select n.id from syllabus_nodes n where n.id in ${inList(rootIds)}
        union
        select c.id from syllabus_nodes c join t on c.parent_id = t.id where c.status in ${inList(VISIBLE_NODE_STATUSES)}
      ) select id from t`);
    return new Set(res.rows.map((r) => r.id));
  }

  /** Exam weight per domain from family_syllabus (sum of linked node weights). Empty when the family links nothing. */
  async familyDomainWeights(familyId: string): Promise<Map<Domain, number>> {
    const res = await this.db.execute<{ domain: Domain; w: number }>(sql`
      select n.domain, sum(fs.weight)::float8 as w from family_syllabus fs join syllabus_nodes n on n.id = fs.node_id
      where fs.family_id = ${familyId} and n.status in ${inList(VISIBLE_NODE_STATUSES)}
      group by n.domain`);
    return new Map(res.rows.map((r) => [r.domain, Number(r.w)]));
  }

  /**
   * Due mistakes for spaced review: wrong last time or `next_review_at` reached. Questions answered in the last 24h go
   * last; then the most overdue and most often missed first.
   */
  async dueMistakeIds(userId: string, familyId: string | null, limit: number): Promise<string[]> {
    const scope = familyId ? sql`and ${this.familyPredicate(familyId, false)}` : sql``;
    const ctes = familyId ? sql`with recursive ${this.familyTreeCtes(familyId)}` : sql``;
    const res = await this.db.execute<{ id: string }>(sql`
      ${ctes}
      select q.id from user_question_state s
      join questions q on q.id = s.question_id
      join syllabus_nodes n on n.id = q.topic_id and n.status in ${inList(VISIBLE_NODE_STATUSES)}
      where s.user_id = ${userId} and (s.last_correct = false or s.next_review_at <= now())
        and ${this.servableSql()} ${scope}
      order by (s.last_answered_at > now() - interval '24 hours') asc nulls first,
               s.next_review_at asc nulls first, s.times_wrong desc, s.last_answered_at asc nulls first
      limit ${limit}`);
    return res.rows.map((r) => r.id);
  }

  /** The family's weakest topics that have servable questions (untouched topics sit at the prior mastery). */
  async weakestTopicIds(userId: string, familyId: string, n: number): Promise<string[]> {
    const res = await this.db.execute<{ id: string; rating: number | null; attempts: number | null }>(sql`
      with recursive ${this.familyTreeCtes(familyId)}
      select t.id, m.rating, m.attempts from fam_tree t
      left join mastery m on m.user_id = ${userId} and m.node_id = t.id
      where exists (select 1 from questions q where q.topic_id = t.id and q.is_general and ${this.servableSql()})`);
    return shuffle(res.rows)
      .map((r) => ({ id: r.id, m: shrunkMastery(r.rating == null ? START_RATING : Number(r.rating), Number(r.attempts ?? 0)) }))
      .sort((a, b) => a.m - b.m)
      .slice(0, n)
      .map((r) => r.id);
  }
}

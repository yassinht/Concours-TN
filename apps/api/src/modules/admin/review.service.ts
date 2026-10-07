import { HttpException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { ContentStatus, QuestionType } from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { competitionFacts, competitionFamilies, competitions, lessons, questionFamilies, questions, sources, syllabusNodes } from '../../db/schema';
import { CatalogService } from '../catalog/catalog.service';
import { assertUuid, conflict, badRequest, notFound, type BulkReviewInput, type ReviewEntity, type ReviewQueueQuery } from './admin.util';
import { loadEditionsByIds, loadFacts, type AdminEditionDTO, type AdminFactDTO } from './catalog-loaders';
import { loadLessonDetails, loadQuestionDetails, type AdminLessonDetail, type AdminQuestionDetail } from './content-loaders';
import { EditionAlertsService, type EditionAlertOutcome } from './edition-alerts.service';
import { validateQuestionContent, type QuestionOption } from './question-content';
import { hops, planTransition, type ReviewAction, type TransitionPlan } from './review.workflow';

export type ReviewItem = AdminQuestionDetail | AdminLessonDetail | AdminFactDTO | AdminEditionDTO;

export interface ReviewResult {
  entity: ReviewEntity;
  id: string;
  from: ContentStatus;
  status: ContentStatus;
  needsVerification?: boolean;
  alerts?: EditionAlertOutcome;
  item: ReviewItem | null;
}

const DEFAULT_LIMIT = 50;

/** Ids of the syllabus node `key` and all its descendants. */
function topicSubtree(key: string) {
  return sql`with recursive sub as (
      select ${syllabusNodes.id} as id from ${syllabusNodes} where ${syllabusNodes.key} = ${key}
      union all
      select n.id from ${syllabusNodes} n join sub on n.parent_id = sub.id
    ) select id from sub`;
}

/**
 * Human review of content. Nothing reaches PUBLISHED without a human reviewer recorded on the row; every status change is
 * written to content_reviews (one row per hop) and every action to the audit log.
 */
@Injectable()
export class ReviewService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly editionAlerts: EditionAlertsService,
  ) {}

  // ───────────── Queue ─────────────

  async queue(q: ReviewQueueQuery): Promise<{ entity: ReviewEntity; status: ContentStatus | null; needsVerification: boolean | null; total: number; items: ReviewItem[] }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    switch (q.entity) {
      case 'question': {
        const status = q.status ?? 'AI_REVIEWED';
        const where = and(
          eq(questions.status, status),
          q.domain ? eq(questions.domain, q.domain) : undefined,
          q.topicKey ? sql`${questions.topicId} in (${topicSubtree(q.topicKey)})` : undefined,
          q.familySlug ? sql`exists (select 1 from ${questionFamilies} join ${competitionFamilies} on ${competitionFamilies.id} = ${questionFamilies.familyId}
            where ${questionFamilies.questionId} = ${questions.id} and ${competitionFamilies.slug} = ${q.familySlug})` : undefined,
        );
        const [ids, total] = await Promise.all([
          this.db.select({ id: questions.id }).from(questions).where(where).orderBy(asc(questions.createdAt), asc(questions.id)).limit(limit),
          this.count(questions, where),
        ]);
        return { entity: 'question', status, needsVerification: null, total, items: await loadQuestionDetails(this.db, ids.map((r) => r.id)) };
      }
      case 'lesson': {
        const status = q.status ?? 'AI_REVIEWED';
        const where = and(eq(lessons.status, status), q.topicKey ? sql`${lessons.nodeId} in (${topicSubtree(q.topicKey)})` : undefined);
        const [ids, total] = await Promise.all([
          this.db.select({ id: lessons.id }).from(lessons).where(where).orderBy(asc(lessons.updatedAt), asc(lessons.id)).limit(limit),
          this.count(lessons, where),
        ]);
        return { entity: 'lesson', status, needsVerification: null, total, items: await loadLessonDetails(this.db, ids.map((r) => r.id)) };
      }
      case 'fact': {
        const family = q.familySlug ? sql`${competitionFacts.familyId} in (select id from ${competitionFamilies} where ${competitionFamilies.slug} = ${q.familySlug})` : undefined;
        const where = q.status
          ? and(eq(competitionFacts.status, q.status), family)
          : and(eq(competitionFacts.needsVerification, true), ne(competitionFacts.status, 'ARCHIVED'), family);
        const [items, total] = await Promise.all([loadFacts(this.db, where, limit), this.count(competitionFacts, where)]);
        return { entity: 'fact', status: q.status ?? null, needsVerification: q.status ? null : true, total, items };
      }
      case 'edition': {
        const family = q.familySlug ? sql`${competitions.familyId} in (select id from ${competitionFamilies} where ${competitionFamilies.slug} = ${q.familySlug})` : undefined;
        const where = q.status
          ? and(eq(competitions.contentStatus, q.status), family)
          : and(eq(competitions.needsVerification, true), ne(competitions.contentStatus, 'ARCHIVED'), family);
        const [ids, total] = await Promise.all([
          // Most urgent first: open/announced editions with the nearest deadline.
          this.db.select({ id: competitions.id }).from(competitions).where(where)
            .orderBy(sql`case ${competitions.status} when 'OPEN' then 0 when 'ANNOUNCED' then 1 when 'EXPECTED' then 2 else 3 end`,
              sql`${competitions.registrationDeadline} asc nulls last`, competitions.id)
            .limit(limit),
          this.count(competitions, where),
        ]);
        return { entity: 'edition', status: q.status ?? null, needsVerification: q.status ? null : true, total, items: await loadEditionsByIds(this.db, ids.map((r) => r.id)) };
      }
    }
  }

  // ───────────── Actions ─────────────

  async act(entity: ReviewEntity, id: string, input: { action: ReviewAction; comment?: string }, actorId: string): Promise<ReviewResult> {
    assertUuid(id);
    const comment = input.comment?.trim() || undefined;
    switch (entity) {
      case 'question':
        return this.actQuestion(id, input.action, comment, actorId);
      case 'lesson':
        return this.actLesson(id, input.action, comment, actorId);
      case 'fact':
        return this.actFact(id, input.action, comment, actorId);
      case 'edition':
        return this.actEdition(id, input.action, comment, actorId);
    }
  }

  async bulkQuestions(input: BulkReviewInput, actorId: string): Promise<{ action: ReviewAction; ok: { id: string; status: ContentStatus }[]; failed: { id: string; error: string }[] }> {
    const ok: { id: string; status: ContentStatus }[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of [...new Set(input.ids)]) {
      try {
        const r = await this.actQuestion(id, input.action, input.comment?.trim() || undefined, actorId, { withItem: false });
        ok.push({ id, status: r.status });
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        const res = e.getResponse();
        failed.push({ id, error: typeof res === 'string' ? res : String((res as { message?: unknown }).message ?? e.message) });
      }
    }
    await this.audit.log(actorId, `review.bulk.${input.action}`, 'question', null, { ok: ok.length, failed: failed.length, ids: input.ids.slice(0, 200) });
    return { action: input.action, ok, failed };
  }

  private async actQuestion(id: string, action: ReviewAction, comment: string | undefined, actorId: string, opts: { withItem?: boolean } = {}): Promise<ReviewResult> {
    assertUuid(id);
    const [q] = await this.db
      .select({ id: questions.id, status: questions.status, origin: questions.origin, type: questions.type, options: questions.options, correct: questions.correct })
      .from(questions)
      .where(eq(questions.id, id))
      .limit(1);
    if (!q) throw notFound();
    const plan = planTransition('question', q.status, action, { aiGenerated: q.origin === 'AI_GENERATED', comment });
    const to = plan.path.at(-1) ?? q.status;
    if (to === 'PUBLISHED') {
      const { issues } = validateQuestionContent(q.type as QuestionType, (q.options ?? []) as QuestionOption[], q.correct);
      if (issues.length) throw new UnprocessableEntityException({ message: 'QUESTION_INVALID', issues });
    }
    const now = new Date();
    const updated = await this.db
      .update(questions)
      .set({ status: to, updatedAt: now, ...(plan.setsReviewer ? { reviewedBy: actorId, reviewedAt: now } : {}) })
      .where(and(eq(questions.id, id), eq(questions.status, q.status)))
      .returning({ id: questions.id });
    if (!updated.length) throw conflict('STALE_STATUS');
    await this.record('question', id, q.status, plan, action, comment, actorId);
    const item = opts.withItem === false ? null : (await loadQuestionDetails(this.db, [id]))[0] ?? null;
    return { entity: 'question', id, from: q.status, status: to, item };
  }

  private async actLesson(id: string, action: ReviewAction, comment: string | undefined, actorId: string): Promise<ReviewResult> {
    const [l] = await this.db.select({ id: lessons.id, status: lessons.status, origin: lessons.origin }).from(lessons).where(eq(lessons.id, id)).limit(1);
    if (!l) throw notFound();
    const plan = planTransition('lesson', l.status, action, { aiGenerated: l.origin === 'AI_GENERATED', comment });
    const to = plan.path.at(-1) ?? l.status;
    const updated = await this.db
      .update(lessons)
      .set({ status: to, updatedAt: new Date(), ...(plan.setsReviewer ? { reviewedBy: actorId } : {}) })
      .where(and(eq(lessons.id, id), eq(lessons.status, l.status)))
      .returning({ id: lessons.id });
    if (!updated.length) throw conflict('STALE_STATUS');
    await this.record('lesson', id, l.status, plan, action, comment, actorId);
    return { entity: 'lesson', id, from: l.status, status: to, item: (await loadLessonDetails(this.db, [id]))[0] ?? null };
  }

  private async actFact(id: string, action: ReviewAction, comment: string | undefined, actorId: string): Promise<ReviewResult> {
    const [f] = await this.db
      .select({ id: competitionFacts.id, status: competitionFacts.status, needsVerification: competitionFacts.needsVerification, sourceId: competitionFacts.sourceId })
      .from(competitionFacts)
      .where(eq(competitionFacts.id, id))
      .limit(1);
    if (!f) throw notFound();
    const plan = planTransition('fact', f.status, action, { comment });
    // "Verified" means checked against a source: a fact without one stays a suggestion.
    if (plan.needsVerification === false && !f.sourceId) throw badRequest('SOURCE_REQUIRED');
    const to = plan.path.at(-1) ?? f.status;
    const now = new Date();
    const updated = await this.db
      .update(competitionFacts)
      .set({
        status: to,
        ...(plan.needsVerification !== undefined ? { needsVerification: plan.needsVerification } : {}),
        ...(plan.needsVerification === false ? { lastVerifiedAt: now } : {}),
      })
      .where(and(eq(competitionFacts.id, id), eq(competitionFacts.status, f.status)))
      .returning({ id: competitionFacts.id });
    if (!updated.length) throw conflict('STALE_STATUS');
    if (plan.needsVerification === false && f.sourceId) await this.touchSource(f.sourceId, now);
    await this.record('fact', id, f.status, plan, action, comment, actorId, f.needsVerification);
    this.catalog.invalidate();
    const [item] = await loadFacts(this.db, eq(competitionFacts.id, id), 1);
    return { entity: 'fact', id, from: f.status, status: to, needsVerification: plan.needsVerification ?? f.needsVerification, item: item ?? null };
  }

  private async actEdition(id: string, action: ReviewAction, comment: string | undefined, actorId: string): Promise<ReviewResult> {
    const before = await this.editionAlerts.snapshot(id);
    if (!before) throw notFound();
    const [row] = await this.db.select({ sourceId: competitions.sourceId }).from(competitions).where(eq(competitions.id, id)).limit(1);
    const plan = planTransition('edition', before.contentStatus, action, { comment });
    if (plan.needsVerification === false && !row?.sourceId) throw badRequest('SOURCE_REQUIRED');
    const to = plan.path.at(-1) ?? before.contentStatus;
    const now = new Date();
    const updated = await this.db
      .update(competitions)
      .set({ contentStatus: to, updatedAt: now, ...(plan.needsVerification !== undefined ? { needsVerification: plan.needsVerification } : {}) })
      .where(and(eq(competitions.id, id), eq(competitions.contentStatus, before.contentStatus)))
      .returning({ id: competitions.id });
    if (!updated.length) throw conflict('STALE_STATUS');
    // Editions have no last_verified_at column: the catalog reads the verification date from their source.
    if (plan.needsVerification === false && row?.sourceId) await this.touchSource(row.sourceId, now);
    await this.record('edition', id, before.contentStatus, plan, action, comment, actorId, before.needsVerification);
    this.catalog.invalidate();

    const after = await this.editionAlerts.snapshot(id);
    const alerts = after ? await this.editionAlerts.afterChange(before, after, { notifyUpdates: true }) : undefined;
    const [item] = await loadEditionsByIds(this.db, [id]);
    return { entity: 'edition', id, from: before.contentStatus, status: to, needsVerification: after?.needsVerification, alerts, item: item ?? null };
  }

  // ───────────── Helpers ─────────────

  /** One content_reviews row per hop (and per verification flip), plus one audit log entry for the action. */
  private async record(
    entity: ReviewEntity, id: string, from: ContentStatus, plan: TransitionPlan, action: ReviewAction, comment: string | undefined, actorId: string,
    wasUnverified?: boolean,
  ): Promise<void> {
    for (const [f, t] of hops(from, plan.path)) await this.audit.review(entity, id, f, t, actorId, comment);
    if (plan.needsVerification !== undefined && wasUnverified !== undefined && plan.needsVerification !== wasUnverified) {
      await this.audit.review(entity, id, wasUnverified ? 'UNVERIFIED' : 'VERIFIED', plan.needsVerification ? 'UNVERIFIED' : 'VERIFIED', actorId, comment);
    }
    await this.audit.log(actorId, `review.${action}`, entity, id, {
      from, to: plan.path.at(-1) ?? from, path: plan.path, comment: comment ?? null,
      ...(plan.needsVerification !== undefined ? { needsVerification: plan.needsVerification } : {}),
    });
  }

  private async touchSource(sourceId: string, at: Date): Promise<void> {
    await this.db.update(sources).set({ lastVerifiedAt: at }).where(eq(sources.id, sourceId));
  }

  private async count(table: typeof questions | typeof lessons | typeof competitionFacts | typeof competitions, where: SQL | undefined): Promise<number> {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
    return Number(r?.n ?? 0);
  }
}

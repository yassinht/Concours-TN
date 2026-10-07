import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  CONTENT_STATUSES, DIFFICULTY_RATING, QuestionUpsertInput, type ContentStatus, type QuestionType,
} from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  competitionFamilies, contentReviews, learningObjectives, lessons, questionFamilies, questionObjectives, questionReports, questions, sources,
  syllabusNodes,
} from '../../db/schema';
import {
  assertUuid, badRequest, conflict, diffFields, isoDate, likeAny, likeChildren, notFound, paging, type LessonPatchInput, type LessonsQuery,
  type QuestionsQuery,
} from './admin.util';
import { loadLessonDetails, loadQuestionDetails, peopleByIds, type AdminLessonDetail, type AdminQuestionDetail } from './content-loaders';
import { validateQuestionContent, type QuestionOption } from './question-content';
import { editPath, hops } from './review.workflow';

/** QuestionUpsertInput plus the provenance an editor may set (AI_GENERATED is reserved for the AI pipeline). */
export const AdminQuestionInput = QuestionUpsertInput.extend({
  origin: z.enum(['PAST_EXAM_VERBATIM', 'PAST_EXAM_REWRITTEN', 'AUTHORED', 'ALGORITHMIC']).optional(),
  extId: z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/).nullable().optional(),
});
export type AdminQuestionInput = z.infer<typeof AdminQuestionInput>;
export const AdminQuestionPatch = AdminQuestionInput.partial();
export type AdminQuestionPatch = z.infer<typeof AdminQuestionPatch>;

export interface AdminQuestionSummary {
  id: string; extId: string | null; type: QuestionType; domain: string; language: string; difficulty: string;
  status: ContentStatus; version: number; origin: string; stem: string;
  topicKey: string; topicTitle_ar: string; topicTitle_fr: string; year: number | null; aiModel: string | null;
  reviewedAt: string | null; createdAt: string; updatedAt: string;
  stats: { attempts: number; correct: number; accuracy: number | null; openReports: number };
}

interface Resolved {
  topicId: string;
  objectiveIds: string[];
  familyIds: string[];
  correct: unknown;
}

const openReportsSql = sql<number>`(select count(*)::int from ${questionReports} where ${questionReports.questionId} = ${questions.id} and ${questionReports.status} = 'OPEN')`;

/** Question bank editing. An editor saving content is its human reviewer: the question lands in HUMAN_REVIEWED. */
@Injectable()
export class AdminQuestionsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ───────────── List ─────────────

  async list(q: QuestionsQuery): Promise<{ items: AdminQuestionSummary[]; total: number; page: number; pageSize: number; counts: Record<ContentStatus, number> }> {
    const { page, pageSize, offset } = paging(q.page, q.pageSize);
    const base = this.filters(q);
    const where = and(base, q.status ? eq(questions.status, q.status) : undefined);
    const order = this.order(q.sort);

    const [rows, [{ total }], countRows] = await Promise.all([
      this.db
        .select({
          q: {
            id: questions.id, extId: questions.extId, type: questions.type, domain: questions.domain, language: questions.language,
            difficulty: questions.difficulty, status: questions.status, version: questions.version, origin: questions.origin, stem: questions.stem,
            year: questions.year, aiModel: questions.aiModel, reviewedAt: questions.reviewedAt, createdAt: questions.createdAt, updatedAt: questions.updatedAt,
            attempts: questions.attemptsCount, correct: questions.correctCount,
          },
          topicKey: syllabusNodes.key, topicTitleAr: syllabusNodes.titleAr, topicTitleFr: syllabusNodes.titleFr,
          openReports: openReportsSql,
        })
        .from(questions)
        .innerJoin(syllabusNodes, eq(syllabusNodes.id, questions.topicId))
        .where(where)
        .orderBy(...order)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(questions).innerJoin(syllabusNodes, eq(syllabusNodes.id, questions.topicId)).where(where),
      // Per-status counts under the same filters (status tabs).
      this.db
        .select({ status: questions.status, n: sql<number>`count(*)::int` })
        .from(questions)
        .innerJoin(syllabusNodes, eq(syllabusNodes.id, questions.topicId))
        .where(base)
        .groupBy(questions.status),
    ]);
    const counts = Object.fromEntries(CONTENT_STATUSES.map((s) => [s, 0])) as Record<ContentStatus, number>;
    for (const r of countRows) counts[r.status] = Number(r.n);

    return {
      items: rows.map(({ q: r, ...t }) => ({
        id: r.id, extId: r.extId, type: r.type, domain: r.domain, language: r.language, difficulty: r.difficulty,
        status: r.status, version: r.version, origin: r.origin, stem: r.stem,
        topicKey: t.topicKey, topicTitle_ar: t.topicTitleAr, topicTitle_fr: t.topicTitleFr, year: r.year, aiModel: r.aiModel,
        reviewedAt: r.reviewedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
        stats: {
          attempts: r.attempts, correct: r.correct,
          accuracy: r.attempts ? Math.round((r.correct / r.attempts) * 1000) / 1000 : null,
          openReports: Number(t.openReports ?? 0),
        },
      })),
      total: Number(total),
      page,
      pageSize,
      counts,
    };
  }

  private filters(q: QuestionsQuery): SQL | undefined {
    const pattern = likeAny(q.q);
    return and(
      q.domain ? eq(questions.domain, q.domain) : undefined,
      q.origin ? eq(questions.origin, q.origin) : undefined,
      q.topicKey ? or(eq(syllabusNodes.key, q.topicKey), sql`${syllabusNodes.key} like ${likeChildren(q.topicKey)}`) : undefined,
      q.familySlug
        ? sql`exists (select 1 from ${questionFamilies} join ${competitionFamilies} on ${competitionFamilies.id} = ${questionFamilies.familyId}
            where ${questionFamilies.questionId} = ${questions.id} and ${competitionFamilies.slug} = ${q.familySlug})`
        : undefined,
      pattern
        ? or(ilike(questions.stem, pattern), ilike(questions.extId, pattern), ilike(questions.explanation, pattern), sql`${questions.id}::text = ${q.q!.trim()}`)
        : undefined,
      q.reported === true ? sql`${openReportsSql} > 0` : q.reported === false ? sql`${openReportsSql} = 0` : undefined,
    );
  }

  private order(sort: QuestionsQuery['sort']): SQL[] {
    switch (sort) {
      case 'oldest':
        return [asc(questions.createdAt), asc(questions.id)];
      case 'accuracy':
        return [sql`case when ${questions.attemptsCount} > 0 then ${questions.correctCount}::float / ${questions.attemptsCount} end asc nulls last`, desc(questions.attemptsCount)];
      case 'attempts':
        return [desc(questions.attemptsCount), asc(questions.id)];
      case 'reports':
        return [sql`${openReportsSql} desc`, desc(questions.updatedAt)];
      default:
        return [desc(questions.updatedAt), asc(questions.id)];
    }
  }

  // ───────────── Detail ─────────────

  async get(id: string): Promise<AdminQuestionDetail & { history: { fromStatus: string | null; toStatus: string; comment: string | null; at: string; reviewer: { id: string; name: string | null } | null }[]; reports: { id: string; reason: string; comment: string | null; status: string; createdAt: string }[] }> {
    assertUuid(id);
    const [item] = await loadQuestionDetails(this.db, [id]);
    if (!item) throw notFound();
    const [history, reports] = await Promise.all([
      this.db
        .select({ fromStatus: contentReviews.fromStatus, toStatus: contentReviews.toStatus, comment: contentReviews.comment, at: contentReviews.createdAt, reviewerId: contentReviews.reviewerId })
        .from(contentReviews)
        .where(and(eq(contentReviews.entityType, 'question'), eq(contentReviews.entityId, id)))
        .orderBy(desc(contentReviews.createdAt))
        .limit(100),
      this.db
        .select({ id: questionReports.id, reason: questionReports.reason, comment: questionReports.comment, status: questionReports.status, createdAt: questionReports.createdAt })
        .from(questionReports)
        .where(eq(questionReports.questionId, id))
        .orderBy(desc(questionReports.createdAt))
        .limit(100),
    ]);
    const people = await peopleByIds(this.db, history.map((h) => h.reviewerId));
    return {
      ...item,
      history: history.map((h) => ({
        fromStatus: h.fromStatus, toStatus: h.toStatus, comment: h.comment, at: h.at.toISOString(),
        reviewer: h.reviewerId ? people.get(h.reviewerId) ?? { id: h.reviewerId, name: null } : null,
      })),
      reports: reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  }

  // ───────────── Create / update ─────────────

  async create(input: AdminQuestionInput, actorId: string, opts: { publish?: boolean } = {}): Promise<AdminQuestionDetail> {
    const r = await this.resolve(input);
    await this.assertNotDuplicate(input.stem, r.topicId, null);
    if (input.extId) await this.assertExtIdFree(input.extId, null);
    const path: ContentStatus[] = opts.publish ? ['HUMAN_REVIEWED', 'PUBLISHED'] : ['HUMAN_REVIEWED'];
    const now = new Date();

    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(questions)
        .values({
          extId: input.extId ?? null,
          type: input.type, domain: input.domain, language: input.language, stem: input.stem.trim(),
          options: input.options, correct: r.correct as object, explanation: input.explanation.trim(), difficulty: input.difficulty,
          rating: DIFFICULTY_RATING[input.difficulty], topicId: r.topicId, isGeneral: input.isGeneral,
          origin: input.origin ?? 'AUTHORED', sourceId: input.sourceId ?? null, year: input.year ?? null, validUntil: input.validUntil ?? null,
          tags: dedupe(input.tags), status: path.at(-1)!, version: 1, createdBy: actorId, reviewedBy: actorId, reviewedAt: now,
        })
        .returning({ id: questions.id });
      if (r.objectiveIds.length) await tx.insert(questionObjectives).values(r.objectiveIds.map((objectiveId) => ({ questionId: row.id, objectiveId })));
      if (r.familyIds.length) await tx.insert(questionFamilies).values(r.familyIds.map((familyId) => ({ questionId: row.id, familyId })));
      return row.id;
    });

    let prev: ContentStatus | null = null;
    for (const s of path) {
      await this.audit.review('question', id, prev, s, actorId, prev === null ? 'created by editor' : undefined);
      prev = s;
    }
    await this.audit.log(actorId, 'question.create', 'question', id, { topicKey: input.topicKey, type: input.type, status: path.at(-1) });
    return (await loadQuestionDetails(this.db, [id]))[0];
  }

  async update(id: string, patch: AdminQuestionPatch, actorId: string, opts: { publish?: boolean } = {}): Promise<AdminQuestionDetail & { changed: boolean }> {
    assertUuid(id);
    const [current] = await loadQuestionDetails(this.db, [id]);
    if (!current) throw notFound();
    const [{ sourceId }] = await this.db.select({ sourceId: questions.sourceId }).from(questions).where(eq(questions.id, id));

    const before: AdminQuestionInput = {
      type: current.type, domain: current.domain, language: current.language as AdminQuestionInput['language'], stem: current.stem,
      options: current.options, correct: current.correct, explanation: current.explanation, difficulty: current.difficulty,
      topicKey: current.topic.key, objectiveKeys: current.objectives.map((o) => o.key), familySlugs: current.families.map((f) => f.slug),
      isGeneral: current.isGeneral, sourceId, year: current.year, validUntil: current.validUntil, tags: current.tags,
      origin: current.origin === 'AI_GENERATED' ? undefined : (current.origin as AdminQuestionInput['origin']), extId: current.extId,
    };
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const parsed = AdminQuestionInput.safeParse({ ...before, ...defined });
    if (!parsed.success) throw badRequest('VALIDATION_FAILED', { issues: parsed.error.issues });
    const next = parsed.data;

    const r = await this.resolve(next);
    const nextComparable = { ...next, correct: r.correct, objectiveKeys: [...next.objectiveKeys].sort(), familySlugs: [...next.familySlugs].sort(), tags: dedupe(next.tags) };
    const beforeComparable = { ...before, objectiveKeys: [...before.objectiveKeys].sort(), familySlugs: [...before.familySlugs].sort() };
    const diff = diffFields(beforeComparable, nextComparable);
    const changed = Object.keys(diff).length > 0;

    if (!changed && !opts.publish) return { ...current, changed: false };
    if (diff.stem || diff.topicKey) await this.assertNotDuplicate(next.stem, r.topicId, id);
    if (diff.extId && next.extId) await this.assertExtIdFree(next.extId, id);

    const path = changed ? editPath(current.status) : [];
    const landed = path.at(-1) ?? current.status;
    if (opts.publish) {
      if (landed !== 'HUMAN_REVIEWED' && landed !== 'AI_REVIEWED' && landed !== 'PUBLISHED') throw conflict('INVALID_TRANSITION', { from: landed, action: 'publish' });
      if (landed === 'AI_REVIEWED') path.push('HUMAN_REVIEWED');
      if (landed !== 'PUBLISHED') path.push('PUBLISHED');
    }
    const status = path.at(-1) ?? current.status;
    const now = new Date();
    const answerKeyChanged = !!(diff.correct || diff.options || diff.type);

    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(questions)
        .set({
          ...(changed ? {
            type: next.type, domain: next.domain, language: next.language, stem: next.stem.trim(), options: next.options, correct: r.correct as object,
            explanation: next.explanation.trim(), difficulty: next.difficulty, topicId: r.topicId, isGeneral: next.isGeneral,
            sourceId: next.sourceId ?? null, year: next.year ?? null, validUntil: next.validUntil ?? null, tags: dedupe(next.tags),
            extId: next.extId ?? null, ...(next.origin ? { origin: next.origin } : {}),
            version: current.version + 1,
          } : {}),
          // Stats measured against a different answer key would mislead the "suspicious accuracy" checks.
          ...(answerKeyChanged ? { attemptsCount: 0, correctCount: 0 } : {}),
          status, updatedAt: now,
          ...(path.length ? { reviewedBy: actorId, reviewedAt: now } : {}),
        })
        .where(and(eq(questions.id, id), eq(questions.version, current.version), eq(questions.status, current.status)))
        .returning({ id: questions.id });
      if (!updated.length) throw conflict('STALE_VERSION');
      if (diff.objectiveKeys) {
        await tx.delete(questionObjectives).where(eq(questionObjectives.questionId, id));
        if (r.objectiveIds.length) await tx.insert(questionObjectives).values(r.objectiveIds.map((objectiveId) => ({ questionId: id, objectiveId })));
      }
      if (diff.familySlugs) {
        await tx.delete(questionFamilies).where(eq(questionFamilies.questionId, id));
        if (r.familyIds.length) await tx.insert(questionFamilies).values(r.familyIds.map((familyId) => ({ questionId: id, familyId })));
      }
    });

    const note = changed ? `edited (v${current.version + 1})` : undefined;
    for (const [f, t] of hops(current.status, path)) await this.audit.review('question', id, f, t, actorId, note);
    await this.audit.log(actorId, 'question.update', 'question', id, { version: changed ? current.version + 1 : current.version, status, diff: summarizeDiff(diff) });
    const [item] = await loadQuestionDetails(this.db, [id]);
    return { ...item, changed };
  }

  /** Resolves keys/slugs to ids and checks the answer key; throws 400/422 with the offending values. */
  private async resolve(input: AdminQuestionInput): Promise<Resolved> {
    if (input.validUntil && !isoDate.safeParse(input.validUntil).success) throw badRequest('VALIDATION_FAILED', { issues: [{ path: ['validUntil'], message: 'YYYY-MM-DD' }] });
    const { correct, issues } = validateQuestionContent(input.type, input.options as QuestionOption[], input.correct);
    if (issues.length) throw new UnprocessableEntityException({ message: 'QUESTION_INVALID', issues });

    const [topic] = await this.db
      .select({ id: syllabusNodes.id, key: syllabusNodes.key, status: syllabusNodes.status })
      .from(syllabusNodes)
      .where(eq(syllabusNodes.key, input.topicKey))
      .limit(1);
    if (!topic || topic.status === 'ARCHIVED') throw badRequest('UNKNOWN_TOPIC', { topicKey: input.topicKey });

    const objectiveKeys = [...new Set(input.objectiveKeys)];
    const objectives = await this.db
      .select({ id: learningObjectives.id, key: learningObjectives.key, nodeKey: syllabusNodes.key })
      .from(learningObjectives)
      .innerJoin(syllabusNodes, eq(syllabusNodes.id, learningObjectives.nodeId))
      .where(inArray(learningObjectives.key, objectiveKeys));
    const missing = objectiveKeys.filter((k) => !objectives.some((o) => o.key === k));
    if (missing.length) throw badRequest('UNKNOWN_OBJECTIVE', { objectiveKeys: missing });
    // An objective must belong to the question's topic, one of its ancestors or descendants (same branch of the syllabus).
    const related = (nodeKey: string) => nodeKey === topic.key || topic.key.startsWith(`${nodeKey}.`) || nodeKey.startsWith(`${topic.key}.`);
    const foreign = objectives.filter((o) => !related(o.nodeKey)).map((o) => o.key);
    if (foreign.length) throw badRequest('OBJECTIVE_TOPIC_MISMATCH', { objectiveKeys: foreign, topicKey: topic.key });

    const slugs = [...new Set(input.familySlugs)];
    const families = slugs.length
      ? await this.db.select({ id: competitionFamilies.id, slug: competitionFamilies.slug }).from(competitionFamilies).where(inArray(competitionFamilies.slug, slugs))
      : [];
    const unknownFamilies = slugs.filter((s) => !families.some((f) => f.slug === s));
    if (unknownFamilies.length) throw badRequest('UNKNOWN_FAMILY', { familySlugs: unknownFamilies });

    if (input.sourceId) {
      const [src] = await this.db.select({ id: sources.id }).from(sources).where(eq(sources.id, input.sourceId)).limit(1);
      if (!src) throw badRequest('UNKNOWN_SOURCE');
    }
    return { topicId: topic.id, objectiveIds: objectives.map((o) => o.id), familyIds: families.map((f) => f.id), correct };
  }

  private async assertNotDuplicate(stem: string, topicId: string, exceptId: string | null): Promise<void> {
    const [dupe] = await this.db
      .select({ id: questions.id })
      .from(questions)
      .where(and(
        eq(questions.topicId, topicId),
        ne(questions.status, 'ARCHIVED'),
        sql`lower(regexp_replace(trim(${questions.stem}), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(${stem}), '\\s+', ' ', 'g'))`,
        exceptId ? ne(questions.id, exceptId) : undefined,
      ))
      .limit(1);
    if (dupe) throw conflict('DUPLICATE_QUESTION', { id: dupe.id });
  }

  private async assertExtIdFree(extId: string, exceptId: string | null): Promise<void> {
    const [row] = await this.db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.extId, extId), exceptId ? ne(questions.id, exceptId) : undefined))
      .limit(1);
    if (row) throw conflict('EXT_ID_TAKEN', { id: row.id });
  }

  // ───────────── Lessons ─────────────

  async listLessons(q: LessonsQuery): Promise<{ items: (Omit<AdminLessonDetail, 'bodyMd' | 'lastReview'> & { excerpt: string })[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize, offset } = paging(q.page, q.pageSize);
    const pattern = likeAny(q.q);
    const where = and(
      q.status ? eq(lessons.status, q.status) : undefined,
      q.topicKey ? or(eq(syllabusNodes.key, q.topicKey), sql`${syllabusNodes.key} like ${likeChildren(q.topicKey)}`) : undefined,
      pattern ? or(ilike(lessons.title, pattern), ilike(lessons.bodyMd, pattern)) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ l: lessons, topicKey: syllabusNodes.key, titleAr: syllabusNodes.titleAr, titleFr: syllabusNodes.titleFr, domain: syllabusNodes.domain })
        .from(lessons)
        .innerJoin(syllabusNodes, eq(syllabusNodes.id, lessons.nodeId))
        .where(where)
        .orderBy(desc(lessons.updatedAt), asc(lessons.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(lessons).innerJoin(syllabusNodes, eq(syllabusNodes.id, lessons.nodeId)).where(where),
    ]);
    const people = await peopleByIds(this.db, rows.map((r) => r.l.reviewedBy));
    return {
      items: rows.map(({ l, ...t }) => ({
        entity: 'lesson' as const,
        id: l.id, status: l.status, version: l.version, language: l.language, title: l.title, estMinutes: l.estMinutes, origin: l.origin,
        excerpt: l.bodyMd.slice(0, 240),
        topic: { key: t.topicKey, title_ar: t.titleAr, title_fr: t.titleFr, domain: t.domain },
        reviewedBy: l.reviewedBy ? people.get(l.reviewedBy) ?? { id: l.reviewedBy, name: null } : null,
        updatedAt: l.updatedAt.toISOString(),
      })),
      total: Number(total),
      page,
      pageSize,
    };
  }

  async getLesson(id: string): Promise<AdminLessonDetail> {
    assertUuid(id);
    const [item] = await loadLessonDetails(this.db, [id]);
    if (!item) throw notFound();
    return item;
  }

  async updateLesson(id: string, patch: LessonPatchInput, actorId: string, opts: { publish?: boolean } = {}): Promise<AdminLessonDetail & { changed: boolean }> {
    assertUuid(id);
    const [l] = await this.db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
    if (!l) throw notFound();
    const diff = diffFields(
      { title: l.title, bodyMd: l.bodyMd, estMinutes: l.estMinutes, language: l.language },
      { title: patch.title?.trim(), bodyMd: patch.bodyMd, estMinutes: patch.estMinutes, language: patch.language },
    );
    const changed = Object.keys(diff).length > 0;
    if (!changed && !opts.publish) return { ...(await this.getLesson(id)), changed: false };

    const path = changed ? editPath(l.status) : [];
    const landed = path.at(-1) ?? l.status;
    if (opts.publish) {
      if (landed !== 'HUMAN_REVIEWED' && landed !== 'AI_REVIEWED' && landed !== 'PUBLISHED') throw conflict('INVALID_TRANSITION', { from: landed, action: 'publish' });
      if (landed === 'AI_REVIEWED') path.push('HUMAN_REVIEWED');
      if (landed !== 'PUBLISHED') path.push('PUBLISHED');
    }
    const status = path.at(-1) ?? l.status;
    const updated = await this.db
      .update(lessons)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.bodyMd !== undefined ? { bodyMd: patch.bodyMd } : {}),
        ...(patch.estMinutes !== undefined ? { estMinutes: patch.estMinutes } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(changed ? { version: l.version + 1 } : {}),
        status, updatedAt: new Date(),
        ...(path.length ? { reviewedBy: actorId } : {}),
      })
      .where(and(eq(lessons.id, id), eq(lessons.version, l.version), eq(lessons.status, l.status)))
      .returning({ id: lessons.id });
    if (!updated.length) throw conflict('STALE_VERSION');
    const note = changed ? `edited (v${l.version + 1})` : undefined;
    for (const [f, t] of hops(l.status, path)) await this.audit.review('lesson', id, f, t, actorId, note);
    await this.audit.log(actorId, 'lesson.update', 'lesson', id, { status, diff: summarizeDiff(diff) });
    return { ...(await this.getLesson(id)), changed };
  }
}

function dedupe(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((s) => s.trim()).filter(Boolean))];
}

/** Long text fields are logged as "changed" rather than copied into the audit log in full. */
function summarizeDiff(diff: Record<string, { from: unknown; to: unknown }>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(diff)) {
    const long = (x: unknown) => typeof x === 'string' && x.length > 200;
    out[k] = long(v.from) || long(v.to) || k === 'options' ? 'changed' : v;
  }
  return out;
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { QuestionDTO, ReportQuestionInput } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { competitionFamilies, questionReports, questions, userQuestionState } from '../../db/schema';
import { EntitlementsService } from '../billing/entitlements.service';
import {
  EXAM_GRACE_MS, OFFLINE_PACK_SIZE, UserLimiter, VISIBLE_NODE_STATUSES, assertUuid, inList, paymentRequired, servableStatuses,
} from './practice.util';
import { loadQuestionRows, toQuestionDTO } from './question.mapper';
import { QuestionPoolService } from './question-pool.service';
import { pickSpread } from './selection';

export type ReportQuestionBody = z.infer<typeof ReportQuestionInput>;

export interface MistakeItem {
  question: QuestionDTO;
  timesWrong: number;
  lastAnsweredAt: string | null;
  /** Answered correctly since (kept in the notebook as a win; due ones come back in REVIEW). */
  fixed: boolean;
  nextReviewAt: string | null;
}

export interface OfflineLesson {
  id: string; topicKey: string; topicTitle_ar: string; topicTitle_fr: string; language: string;
  title: string; bodyMd: string; estMinutes: number; unreviewed: boolean;
}

export interface OfflinePack {
  generatedAt: string;
  familySlug: string;
  questions: QuestionDTO[];
  lessons: OfflineLesson[];
}

/** Unsubmitted exam attempts younger than this (no time limit) still hide their questions' answers everywhere. */
const OPEN_DIAGNOSTIC_MS = 24 * 3600_000;

/**
 * The learner's notebook: mistakes, bookmarks, question reports, and the premium offline pack.
 * Answers are never revealed for a question that sits in one of the user's open exam attempts.
 */
@Injectable()
export class NotebookService {
  private readonly reportLimiter = new UserLimiter(20, 3600_000);
  private readonly packLimiter = new UserLimiter(10, 3600_000);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly pool: QuestionPoolService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Question ids of the user's open exam attempts (answers must stay hidden until submit). */
  async openExamQuestionIds(userId: string): Promise<Set<string>> {
    const res = await this.db.execute<{ id: string }>(sql`
      select distinct unnest(a.question_ids)::text as id from attempts a
      where a.user_id = ${userId} and a.submitted_at is null and a.kind in ('DIAGNOSTIC', 'MOCK')
        and ((a.expires_at is not null and a.expires_at > ${new Date(Date.now() - EXAM_GRACE_MS)})
          or (a.expires_at is null and a.started_at > ${new Date(Date.now() - OPEN_DIAGNOSTIC_MS)}))`);
    return new Set(res.rows.map((r) => r.id));
  }

  private servableWhere() {
    return and(
      inArray(questions.status, servableStatuses()),
      sql`(${questions.validUntil} is null or ${questions.validUntil} >= ${tunisToday()})`,
    );
  }

  // ───────────── Mistakes ─────────────

  async mistakes(userId: string, limit: number): Promise<MistakeItem[]> {
    const rows = await this.db
      .select({
        questionId: userQuestionState.questionId, timesWrong: userQuestionState.timesWrong, lastCorrect: userQuestionState.lastCorrect,
        lastAnsweredAt: userQuestionState.lastAnsweredAt, nextReviewAt: userQuestionState.nextReviewAt, bookmarked: userQuestionState.bookmarked,
      })
      .from(userQuestionState)
      .innerJoin(questions, eq(questions.id, userQuestionState.questionId))
      .where(and(eq(userQuestionState.userId, userId), gt(userQuestionState.timesWrong, 0), this.servableWhere()))
      // Still-wrong first, then the most recent.
      .orderBy(sql`${userQuestionState.lastCorrect} is not false`, desc(userQuestionState.lastAnsweredAt))
      .limit(limit);
    const [qRows, locked] = await Promise.all([loadQuestionRows(this.db, rows.map((r) => r.questionId)), this.openExamQuestionIds(userId)]);
    return rows
      .filter((r) => qRows.has(r.questionId))
      .map((r) => ({
        question: toQuestionDTO(qRows.get(r.questionId)!, { reveal: !locked.has(r.questionId), bookmarked: r.bookmarked }),
        timesWrong: r.timesWrong,
        lastAnsweredAt: r.lastAnsweredAt?.toISOString() ?? null,
        fixed: r.lastCorrect === true,
        nextReviewAt: r.nextReviewAt?.toISOString() ?? null,
      }));
  }

  // ───────────── Bookmarks ─────────────

  /** Bookmarked questions; the answer is included once the user has already been shown it (answered with feedback). */
  async bookmarks(userId: string): Promise<QuestionDTO[]> {
    const rows = await this.db
      .select({ questionId: userQuestionState.questionId, timesSeen: userQuestionState.timesSeen, lastAnsweredAt: userQuestionState.lastAnsweredAt })
      .from(userQuestionState)
      .innerJoin(questions, eq(questions.id, userQuestionState.questionId))
      .where(and(eq(userQuestionState.userId, userId), eq(userQuestionState.bookmarked, true), this.servableWhere()))
      .orderBy(sql`${userQuestionState.lastAnsweredAt} desc nulls last`)
      .limit(500);
    const [qRows, locked] = await Promise.all([loadQuestionRows(this.db, rows.map((r) => r.questionId)), this.openExamQuestionIds(userId)]);
    return rows
      .filter((r) => qRows.has(r.questionId))
      .map((r) => {
        const seen = r.timesSeen > 0 || !!r.lastAnsweredAt;
        return toQuestionDTO(qRows.get(r.questionId)!, { reveal: seen && !locked.has(r.questionId), bookmarked: true });
      });
  }

  async addBookmark(userId: string, questionId: string): Promise<{ ok: true }> {
    await this.assertQuestion(questionId);
    await this.db
      .insert(userQuestionState)
      .values({ userId, questionId, bookmarked: true })
      .onConflictDoUpdate({ target: [userQuestionState.userId, userQuestionState.questionId], set: { bookmarked: true } });
    return { ok: true };
  }

  async removeBookmark(userId: string, questionId: string): Promise<{ ok: true }> {
    assertUuid(questionId);
    await this.db
      .update(userQuestionState)
      .set({ bookmarked: false })
      .where(and(eq(userQuestionState.userId, userId), eq(userQuestionState.questionId, questionId)));
    return { ok: true };
  }

  private async assertQuestion(questionId: string): Promise<void> {
    assertUuid(questionId);
    const [q] = await this.db.select({ id: questions.id }).from(questions).where(eq(questions.id, questionId)).limit(1);
    if (!q) throw new NotFoundException('NOT_FOUND');
  }

  // ───────────── Reports ─────────────

  /** One open report per user and question: a new report updates the open one instead of piling up duplicates. */
  async report(userId: string, questionId: string, input: ReportQuestionBody): Promise<{ ok: true }> {
    await this.assertQuestion(questionId);
    this.reportLimiter.hit(userId);
    const comment = input.comment?.trim() || null;
    const [open] = await this.db
      .select({ id: questionReports.id })
      .from(questionReports)
      .where(and(eq(questionReports.userId, userId), eq(questionReports.questionId, questionId), eq(questionReports.status, 'OPEN')))
      .limit(1);
    if (open) {
      await this.db.update(questionReports).set({ reason: input.reason, comment }).where(eq(questionReports.id, open.id));
    } else {
      await this.db.insert(questionReports).values({ questionId, userId, reason: input.reason, comment });
    }
    return { ok: true };
  }

  // ───────────── Offline pack ─────────────

  /**
   * Premium offline pack: up to 200 questions of the family (topic-balanced, previous mistakes first) with answers, plus the
   * family's lessons. Questions of the user's open exam attempts are left out so the pack cannot reveal them.
   */
  async offlinePack(userId: string, familySlug: string): Promise<OfflinePack> {
    const ent = await this.entitlements.get(userId);
    if (!ent.limits.offline) throw paymentRequired('PREMIUM_REQUIRED');
    const [family] = await this.db
      .select({ id: competitionFamilies.id, slug: competitionFamilies.slug })
      .from(competitionFamilies)
      .where(and(eq(competitionFamilies.slug, familySlug), inArray(competitionFamilies.status, VISIBLE_NODE_STATUSES)))
      .limit(1);
    if (!family) throw new NotFoundException('NOT_FOUND');
    this.packLimiter.hit(userId);

    const locked = await this.openExamQuestionIds(userId);
    const pool = await this.pool.candidates({ userId, familyId: family.id, excludeIds: [...locked] });
    const picked = pickSpread(pool, OFFLINE_PACK_SIZE);
    const ids = picked.map((c) => c.id);
    const [qRows, bookmarked, lessons] = await Promise.all([
      loadQuestionRows(this.db, ids),
      ids.length
        ? this.db
          .select({ id: userQuestionState.questionId })
          .from(userQuestionState)
          .where(and(eq(userQuestionState.userId, userId), eq(userQuestionState.bookmarked, true), inArray(userQuestionState.questionId, ids)))
        : Promise.resolve([] as { id: string }[]),
      this.familyLessons(family.id),
    ]);
    const marks = new Set(bookmarked.map((b) => b.id));
    return {
      generatedAt: new Date().toISOString(),
      familySlug: family.slug,
      questions: ids.filter((id) => qRows.has(id)).map((id) => toQuestionDTO(qRows.get(id)!, { reveal: true, bookmarked: marks.has(id) })),
      lessons,
    };
  }

  /** Lessons attached to the family's syllabus tree (same review rule as questions: unreviewed ones are flagged). */
  private async familyLessons(familyId: string): Promise<OfflineLesson[]> {
    const res = await this.db.execute<{
      id: string; topic_key: string; title_ar: string; title_fr: string; language: string; title: string; body_md: string;
      est_minutes: number; status: string;
    }>(sql`
      with recursive ${this.pool.familyTreeCtes(familyId)}
      select l.id, n.key as topic_key, n.title_ar, n.title_fr, l.language, l.title, l.body_md, l.est_minutes, l.status
      from lessons l join syllabus_nodes n on n.id = l.node_id
      where l.node_id in (select id from fam_tree) and l.status in ${inList(servableStatuses())}
      order by n.domain, n.order_index, n.key, l.title
      limit 500`);
    return res.rows.map((r) => ({
      id: r.id, topicKey: r.topic_key, topicTitle_ar: r.title_ar, topicTitle_fr: r.title_fr, language: r.language,
      title: r.title, bodyMd: r.body_md, estMinutes: Number(r.est_minutes), unreviewed: r.status !== 'PUBLISHED',
    }));
  }

  /** Test hook: clears the in-memory limiters. */
  resetLimits(): void {
    this.reportLimiter.reset();
    this.packLimiter.reset();
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { START_RATING, nextReviewDays, shrunkMastery, updateRating } from '@ctn/shared';
import { addDays } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { mastery, questions, userQuestionState, userStats, weaknessEvents } from '../../db/schema';

/** How far up the syllabus tree an answer propagates (topic → unit → subject is 2). */
const MAX_ANCESTORS = 4;
/** A mistake comes back the next day; a fixed mistake is checked again a few days later. */
const REVIEW_AFTER_WRONG_DAYS = 1;
const REVIEW_AFTER_FIX_DAYS = 3;

/**
 * CONTRACT (owned by the learning module):
 * - recordAnswer(userId, { questionId, topicId, rating }, isCorrect, timeMs?) → updates `mastery` (Elo via @ctn/shared updateRating),
 *   question rating/attempts counters, `user_question_state` (mistakes notebook / spaced repetition), and `weakness_events` when wrong.
 *   Returns { masteryBefore, masteryAfter } as 0..1 shrunk mastery for that topic.
 */
@Injectable()
export class MasteryService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * One transaction: topic mastery (full K) and every ancestor node (half K, so subject/domain-level mastery exists),
   * question calibration, the per-question review schedule, mistakes-fixed counter and weakness log.
   * Rows are locked in a fixed order (mastery by node id, then question state) so concurrent answers cannot deadlock.
   */
  async recordAnswer(
    userId: string,
    q: { questionId: string; topicId: string; rating: number },
    isCorrect: boolean,
    _timeMs?: number,
  ): Promise<{ masteryBefore: number; masteryAfter: number }> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const chain = await tx.execute<{ id: string; depth: number }>(sql`
        with recursive chain as (
          select id, parent_id, 0 as depth from syllabus_nodes where id = ${q.topicId}
          union all
          select n.id, n.parent_id, c.depth + 1 from syllabus_nodes n join chain c on n.id = c.parent_id
          where c.depth < ${MAX_ANCESTORS}
        )
        select id, min(depth)::int as depth from chain group by id order by min(depth)`);
      if (!chain.rows.length) throw new NotFoundException('NOT_FOUND');
      const nodeIds = chain.rows.map((r) => r.id);

      const [question] = await tx.select({ rating: questions.rating }).from(questions).where(eq(questions.id, q.questionId)).limit(1);
      if (!question) throw new NotFoundException('NOT_FOUND');
      const questionRating = Number.isFinite(question.rating) ? question.rating : q.rating;

      await tx
        .insert(mastery)
        .values(nodeIds.map((nodeId) => ({ userId, nodeId, rating: START_RATING })))
        .onConflictDoNothing();
      const rows = await tx
        .select()
        .from(mastery)
        .where(and(eq(mastery.userId, userId), inArray(mastery.nodeId, nodeIds)))
        .orderBy(asc(mastery.nodeId))
        .for('update');
      const byNode = new Map(rows.map((r) => [r.nodeId, r]));

      const topic = byNode.get(q.topicId)!;
      const masteryBefore = shrunkMastery(topic.rating, topic.attempts);
      const topicStep = updateRating(topic.rating, questionRating, isCorrect, topic.attempts);
      let masteryAfter = masteryBefore;
      let topicStreak = 0;

      for (const { id, depth } of chain.rows) {
        const m = byNode.get(id);
        if (!m) continue;
        const step = depth === 0 ? topicStep : updateRating(m.rating, questionRating, isCorrect, m.attempts);
        const rating = depth === 0 ? step.user : m.rating + (step.user - m.rating) / 2;
        const attempts = m.attempts + 1;
        const streakCorrect = isCorrect ? m.streakCorrect + 1 : 0;
        const value = shrunkMastery(rating, attempts);
        if (depth === 0) {
          masteryAfter = value;
          topicStreak = streakCorrect;
        }
        await tx
          .update(mastery)
          .set({
            rating,
            attempts,
            correct: m.correct + (isCorrect ? 1 : 0),
            streakCorrect,
            lastSeenAt: now,
            nextReviewAt: addDays(now, nextReviewDays(value, isCorrect, streakCorrect)),
          })
          .where(and(eq(mastery.userId, userId), eq(mastery.nodeId, id)));
      }

      // Atomic delta: other users answering the same question concurrently must not overwrite each other.
      const questionDelta = topicStep.question - questionRating;
      await tx
        .update(questions)
        .set({
          rating: sql`${questions.rating} + ${questionDelta}`,
          attemptsCount: sql`${questions.attemptsCount} + 1`,
          correctCount: sql`${questions.correctCount} + ${isCorrect ? 1 : 0}`,
        })
        .where(eq(questions.id, q.questionId));

      await tx.insert(userQuestionState).values({ userId, questionId: q.questionId }).onConflictDoNothing();
      const [state] = await tx
        .select()
        .from(userQuestionState)
        .where(and(eq(userQuestionState.userId, userId), eq(userQuestionState.questionId, q.questionId)))
        .for('update');
      const fixedMistake = isCorrect && state.lastCorrect === false;
      const reviewInDays = !isCorrect
        ? REVIEW_AFTER_WRONG_DAYS
        : fixedMistake
          ? REVIEW_AFTER_FIX_DAYS
          : nextReviewDays(masteryAfter, true, topicStreak);
      await tx
        .update(userQuestionState)
        .set({
          timesSeen: state.timesSeen + 1,
          timesWrong: state.timesWrong + (isCorrect ? 0 : 1),
          lastCorrect: isCorrect,
          lastAnsweredAt: now,
          nextReviewAt: addDays(now, reviewInDays),
        })
        .where(and(eq(userQuestionState.userId, userId), eq(userQuestionState.questionId, q.questionId)));

      if (fixedMistake) {
        await tx
          .insert(userStats)
          .values({ userId, mistakesFixed: 1 })
          .onConflictDoUpdate({ target: userStats.userId, set: { mistakesFixed: sql`${userStats.mistakesFixed} + 1` } });
      }
      if (!isCorrect) {
        await tx.insert(weaknessEvents).values({ userId, nodeId: q.topicId, questionId: q.questionId });
      }
      return { masteryBefore, masteryAfter };
    });
  }
}

import { Injectable } from '@nestjs/common';

/**
 * CONTRACT (owned by the learning module):
 * - recordAnswer(userId, { questionId, topicId, rating }, isCorrect, timeMs?) → updates `mastery` (Elo via @ctn/shared updateRating),
 *   question rating/attempts counters, `user_question_state` (mistakes notebook / spaced repetition), and `weakness_events` when wrong.
 *   Returns { masteryBefore, masteryAfter } as 0..1 shrunk mastery for that topic.
 */
@Injectable()
export class MasteryService {
  async recordAnswer(
    _userId: string,
    _q: { questionId: string; topicId: string; rating: number },
    _isCorrect: boolean,
    _timeMs?: number,
  ): Promise<{ masteryBefore: number; masteryAfter: number }> {
    throw new Error('NOT_IMPLEMENTED');
  }
}

import { Injectable } from '@nestjs/common';

/**
 * CONTRACT (owned by the gamification module):
 * - awardXp(userId, amount, reason, familyId?) → inserts xp_events, increments user_stats.xp_total; returns new total.
 * - touchStreak(userId) → updates streak for today (Africa/Tunis) using @ctn/shared updateStreak; returns current streak.
 * - checkBadges(userId) → awards any newly earned badges (see BADGES in @ctn/shared), returns the new badge codes.
 * - incrementAnswered(userId, n) → user_stats.questions_answered += n.
 */
@Injectable()
export class GamificationService {
  async awardXp(_userId: string, _amount: number, _reason: string, _familyId?: string | null): Promise<number> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async touchStreak(_userId: string): Promise<number> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async checkBadges(_userId: string): Promise<string[]> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async incrementAnswered(_userId: string, _n: number): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }
}

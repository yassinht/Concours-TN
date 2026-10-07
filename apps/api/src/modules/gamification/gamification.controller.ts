import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, UserGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { ActiveUserGuard } from '../users/active-user.guard';
import { GamificationService } from './gamification.service';

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const LeaderboardQuery = z.object({
  familySlug: z.preprocess(blankToUndefined, z.string().min(1).max(120).optional()),
  period: z.preprocess(blankToUndefined, z.enum(['week', 'all']).default('week')),
});
type LeaderboardQuery = z.infer<typeof LeaderboardQuery>;

@Controller()
@UseGuards(UserGuard, ActiveUserGuard)
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Get('me/gamification')
  me(@CurrentUser() user: SessionUser) {
    return this.gamification.summary(user.id);
  }

  @Get('leaderboard')
  leaderboard(@CurrentUser() user: SessionUser, @Query(new ZodPipe(LeaderboardQuery)) q: LeaderboardQuery) {
    return this.gamification.leaderboard(user, { period: q.period, familySlug: q.familySlug ?? null });
  }
}

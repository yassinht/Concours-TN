import { Global, Module } from '@nestjs/common';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

/** Gamification module — XP, streaks, badges, leaderboard (see docs/api-contract.md). */
@Global()
@Module({
  imports: [],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}

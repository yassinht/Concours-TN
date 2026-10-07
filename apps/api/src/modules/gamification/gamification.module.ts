import { Global, Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';

/** Gamification module — see docs/api-contract.md for its endpoints. */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}

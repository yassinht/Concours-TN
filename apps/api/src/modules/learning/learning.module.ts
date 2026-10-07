import { Global, Module } from '@nestjs/common';
import { CurriculumService } from './curriculum.service';
import { LearningController } from './learning.controller';
import { MasteryService } from './mastery.service';
import { PlanService } from './plan.service';
import { ProgressService } from './progress.service';
import { ReadinessService } from './readiness.service';

/** Learning module — mastery (Elo), readiness, daily plan and progress. See docs/api-contract.md for its endpoints. */
@Global()
@Module({
  imports: [],
  controllers: [LearningController],
  providers: [MasteryService, ReadinessService, CurriculumService, PlanService, ProgressService],
  exports: [MasteryService, ReadinessService],
})
export class LearningModule {}

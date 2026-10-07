import { Global, Module } from '@nestjs/common';
import { MasteryService } from './mastery.service';
import { ReadinessService } from './readiness.service';

/** Learning module — see docs/api-contract.md for its endpoints. */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [MasteryService, ReadinessService],
  exports: [MasteryService, ReadinessService],
})
export class LearningModule {}

import { Global, Module } from '@nestjs/common';
import { MasteryService } from './mastery.service';

/** Learning module — see docs/api-contract.md for its endpoints. */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [MasteryService],
  exports: [MasteryService],
})
export class LearningModule {}

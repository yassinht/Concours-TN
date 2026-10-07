import { Module } from '@nestjs/common';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';

/** Tutor module — POST /tutor/explain (see docs/api-contract.md). Uses the global EntitlementsService and AiService. */
@Module({
  imports: [],
  controllers: [TutorController],
  providers: [TutorService],
  exports: [],
})
export class TutorModule {}

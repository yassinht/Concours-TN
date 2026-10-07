import { Module } from '@nestjs/common';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';

/** Growth module — see docs/api-contract.md for its endpoints. */
@Module({
  imports: [],
  controllers: [GrowthController],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}

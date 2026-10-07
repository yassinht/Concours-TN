import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';

/** Ai module — see docs/api-contract.md for its endpoints. */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}

import { Module } from '@nestjs/common';
import { AttemptsService } from './attempts.service';
import { NotebookService } from './notebook.service';
import { AttemptsController, NotebookController } from './practice.controller';
import { PracticeUserGuard } from './practice.util';
import { QuestionPoolService } from './question-pool.service';

/**
 * Practice module — attempts (diagnostic, practice, daily, mock, review), answers, results, mistakes notebook, bookmarks,
 * question reports and the premium offline pack. See docs/api-contract.md (practice).
 * Relies on the global MasteryService, ReadinessService, GamificationService and EntitlementsService.
 */
@Module({
  imports: [],
  controllers: [AttemptsController, NotebookController],
  providers: [QuestionPoolService, AttemptsService, NotebookService, PracticeUserGuard],
  exports: [QuestionPoolService, AttemptsService],
})
export class PracticeModule {}

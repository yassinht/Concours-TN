import { Module } from '@nestjs/common';
import { AiJobsService } from './ai-jobs.service';
import { AlgorithmicService } from './algorithmic.service';
import { DocumentsService } from './documents.service';
import { FactsExtractionService } from './facts-extraction.service';
import { IngestionController } from './ingestion.controller';
import { PageFetcher } from './page-fetcher';
import { QuestionGenerationService } from './question-generation.service';
import { StaffGuard } from './staff.guard';
import { WatchService } from './watch.service';

/**
 * Ingestion module — official documents (upload, text layer, page chunks), AI/heuristic facts extraction, AI question
 * generation with auto-validation, algorithmic psychotechnical items, and the official-page watcher feeding
 * ingest candidates. See docs/api-contract.md ("ingestion & ai"). Uses the global AiService and NotificationsService.
 */
@Module({
  imports: [],
  controllers: [IngestionController],
  providers: [
    DocumentsService, FactsExtractionService, QuestionGenerationService, AlgorithmicService, AiJobsService, WatchService, PageFetcher, StaffGuard,
  ],
  exports: [DocumentsService, WatchService],
})
export class IngestionModule {}

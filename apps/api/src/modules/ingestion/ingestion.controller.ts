import {
  ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, Param, Patch, PayloadTooLargeException, Post, Query, UploadedFile,
  UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AiExtractInput, AiGenerateInput } from '@ctn/shared';
import { CurrentUser, Roles, RolesGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { AiJobsService } from './ai-jobs.service';
import { AlgorithmicInput, AlgorithmicService } from './algorithmic.service';
import { DocumentsService, MAX_UPLOAD_BYTES, type UploadedFileLike } from './documents.service';
import { FactsExtractionService } from './facts-extraction.service';
import { QuestionGenerationService } from './question-generation.service';
import { StaffGuard } from './staff.guard';
import { CANDIDATE_STATUSES, CheckNowInput, DraftInput, WatchInput, WatchPatch, WatchService } from './watch.service';

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const Uuid = z.string().uuid();

const PageQuery = z.object({
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(200).default(50)),
  offset: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(100_000).default(0)),
});
type PageQuery = z.infer<typeof PageQuery>;

const UploadBody = z.object({ sourceId: z.preprocess(blankToUndefined, z.string().uuid().optional()) });
type UploadBody = z.infer<typeof UploadBody>;

const JobsQuery = z.object({
  kind: z.preprocess(blankToUndefined, z.enum(['EXTRACT_FACTS', 'GENERATE_QUESTIONS', 'GENERATE_ALGORITHMIC']).optional()),
  status: z.preprocess(blankToUndefined, z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']).optional()),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(200).default(50)),
});
type JobsQuery = z.infer<typeof JobsQuery>;

const IngestQuery = z.object({
  status: z.preprocess(blankToUndefined, z.enum(CANDIDATE_STATUSES).optional()),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(200).default(100)),
});
type IngestQuery = z.infer<typeof IngestQuery>;

type ExtractBody = z.infer<typeof AiExtractInput>;
type GenerateBody = z.infer<typeof AiGenerateInput>;

/** Multer reports oversize uploads with its own wording: answer with the API's stable error code instead. */
@Catch(PayloadTooLargeException)
class UploadTooLargeFilter implements ExceptionFilter {
  catch(_e: PayloadTooLargeException, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(413).json({ statusCode: 413, message: 'FILE_TOO_LARGE' });
  }
}

/** Ingestion & AI content tools (docs/api-contract.md — "ingestion & ai"). Staff only; roles re-checked in the DB. */
@Controller('admin')
@UseGuards(RolesGuard, StaffGuard)
@Roles('ADMIN', 'EDITOR')
export class IngestionController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly facts: FactsExtractionService,
    private readonly generation: QuestionGenerationService,
    private readonly algorithmic: AlgorithmicService,
    private readonly jobs: AiJobsService,
    private readonly watch: WatchService,
  ) {}

  // ───────────── Documents ─────────────

  @Post('documents')
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } }))
  upload(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body(new ZodPipe(UploadBody)) body: UploadBody,
    @CurrentUser() user: SessionUser,
  ) {
    return this.documents.upload(file, body.sourceId ?? null, user.id);
  }

  @Get('documents')
  listDocuments(@Query(new ZodPipe(PageQuery)) q: PageQuery) {
    return this.documents.list(q.limit, q.offset);
  }

  @Get('documents/:id')
  document(@Param('id', new ZodPipe(Uuid)) id: string) {
    return this.documents.detail(id);
  }

  // ───────────── AI ─────────────

  @Post('ai/extract')
  @HttpCode(201)
  extract(@Body(new ZodPipe(AiExtractInput)) body: ExtractBody, @CurrentUser() user: SessionUser) {
    return this.facts.extract(body, user.id);
  }

  /** Asynchronous: returns the QUEUED job; poll GET /admin/ai/jobs/:id until DONE/FAILED. */
  @Post('ai/generate-questions')
  @HttpCode(202)
  generate(@Body(new ZodPipe(AiGenerateInput)) body: GenerateBody, @CurrentUser() user: SessionUser) {
    return this.generation.start(body, user.id);
  }

  @Post('ai/generate-algorithmic')
  @HttpCode(201)
  generateAlgorithmic(@Body(new ZodPipe(AlgorithmicInput)) body: AlgorithmicInput, @CurrentUser() user: SessionUser) {
    return this.algorithmic.generate(body, user.id);
  }

  @Get('ai/jobs')
  listJobs(@Query(new ZodPipe(JobsQuery)) q: JobsQuery) {
    return this.jobs.list(q);
  }

  @Get('ai/jobs/:id')
  job(@Param('id', new ZodPipe(Uuid)) id: string) {
    return this.jobs.get(id);
  }

  // ───────────── Official page watcher ─────────────

  @Get('watch')
  listWatched() {
    return this.watch.list();
  }

  @Post('watch')
  @HttpCode(201)
  upsertWatched(@Body(new ZodPipe(WatchInput)) body: WatchInput, @CurrentUser() user: SessionUser) {
    return this.watch.upsert(body, user.id);
  }

  @Patch('watch/:id')
  patchWatched(@Param('id', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(WatchPatch)) body: WatchPatch, @CurrentUser() user: SessionUser) {
    return this.watch.patch(id, body, user.id);
  }

  @Post('watch/check-now')
  @HttpCode(200)
  async checkNow(@Body(new ZodPipe(CheckNowInput)) body: CheckNowInput, @CurrentUser() user: SessionUser) {
    const results = await this.watch.checkAll(user.id, body.ids);
    return { checked: results.length, newCandidates: results.reduce((n, r) => n + r.newCandidates, 0), results };
  }

  // ───────────── Ingest candidates ─────────────

  @Get('ingest')
  listCandidates(@Query(new ZodPipe(IngestQuery)) q: IngestQuery) {
    return this.watch.listCandidates(q.status, q.limit);
  }

  @Post('ingest/:id/draft')
  @HttpCode(201)
  draft(@Param('id', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(DraftInput)) body: DraftInput, @CurrentUser() user: SessionUser) {
    return this.watch.draft(id, body, user.id);
  }

  @Post('ingest/:id/ignore')
  @HttpCode(200)
  ignore(@Param('id', new ZodPipe(Uuid)) id: string, @CurrentUser() user: SessionUser) {
    return this.watch.ignore(id, user.id);
  }
}

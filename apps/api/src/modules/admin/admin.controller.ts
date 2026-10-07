import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { BroadcastInput, EditionUpsertInput, FactVerifyInput, ReviewActionInput, SourceUpsertInput } from '@ctn/shared';
import { CurrentUser, Roles, RolesGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { AdminActorGuard } from './admin-actor.guard';
import { AdminCatalogService, EditionPatch } from './admin-catalog.service';
import { AdminFactsService, SourcePatch } from './admin-facts.service';
import { AdminOpsService } from './admin-ops.service';
import { AdminQuestionInput, AdminQuestionPatch, AdminQuestionsService } from './admin-questions.service';
import { AdminStatsService } from './admin-stats.service';
import {
  AuditQuery, BlueprintCreateInput, BlueprintPatchInput, BlueprintsQuery, BulkReviewInput, DryRunQuery, EditionUpdateNoticeInput, EditionsQuery,
  FACT_KINDS, FactsQuery, FamilyCreateInput, FamilyPatchInput, LessonPatchInput, LessonsQuery, NotifyFlagQuery, PaymentRejectInput, PaymentsQuery,
  PositionCreateInput, PositionPatchInput, PublishFlagQuery, QuestionsQuery, REVIEW_ENTITIES, ReplaceFlagQuery, ReportPatchInput, ReportsQuery,
  ReviewQueueQuery, SourcesQuery, UserPatchInput, UsersQuery, WaitlistQuery, notFound, type FactKind, type ReviewEntity,
} from './admin.util';
import { ReviewService } from './review.service';

type Actor = SessionUser;

/** `question` and `questions` both name the entity (the bulk route uses the plural). */
function reviewEntity(raw: string): ReviewEntity {
  const singular = raw.endsWith('s') ? raw.slice(0, -1) : raw;
  if (!(REVIEW_ENTITIES as readonly string[]).includes(singular)) throw notFound();
  return singular as ReviewEntity;
}

function factKind(raw: string): FactKind {
  if (!(FACT_KINDS as readonly string[]).includes(raw)) throw notFound();
  return raw as FactKind;
}

// ───────────── Dashboard, review queue, question bank, lessons ─────────────

@Controller('admin')
@UseGuards(RolesGuard, AdminActorGuard)
@Roles('ADMIN', 'EDITOR')
export class AdminContentController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly review: ReviewService,
    private readonly questions: AdminQuestionsService,
  ) {}

  @Get('stats')
  getStats() {
    return this.stats.stats();
  }

  @Get('review')
  queue(@Query(new ZodPipe(ReviewQueueQuery)) q: ReviewQueueQuery) {
    return this.review.queue(q);
  }

  // Declared before `review/:entity/:id` so "questions/bulk" is not read as entity + id.
  @Post('review/questions/bulk')
  @HttpCode(200)
  bulk(@Body(new ZodPipe(BulkReviewInput)) body: BulkReviewInput, @CurrentUser() actor: Actor) {
    return this.review.bulkQuestions(body, actor.id);
  }

  @Post('review/:entity/:id')
  @HttpCode(200)
  act(@Param('entity') entity: string, @Param('id') id: string, @Body(new ZodPipe(ReviewActionInput)) body: z.infer<typeof ReviewActionInput>, @CurrentUser() actor: Actor) {
    return this.review.act(reviewEntity(entity), id, body, actor.id);
  }

  @Get('questions')
  listQuestions(@Query(new ZodPipe(QuestionsQuery)) q: QuestionsQuery) {
    return this.questions.list(q);
  }

  @Post('questions')
  createQuestion(@Body(new ZodPipe(AdminQuestionInput)) body: AdminQuestionInput, @Query(new ZodPipe(PublishFlagQuery)) f: z.infer<typeof PublishFlagQuery>, @CurrentUser() actor: Actor) {
    return this.questions.create(body, actor.id, { publish: f.publish });
  }

  @Get('questions/:id')
  getQuestion(@Param('id') id: string) {
    return this.questions.get(id);
  }

  @Patch('questions/:id')
  updateQuestion(@Param('id') id: string, @Body(new ZodPipe(AdminQuestionPatch)) body: AdminQuestionPatch, @Query(new ZodPipe(PublishFlagQuery)) f: z.infer<typeof PublishFlagQuery>, @CurrentUser() actor: Actor) {
    return this.questions.update(id, body, actor.id, { publish: f.publish });
  }

  @Get('lessons')
  listLessons(@Query(new ZodPipe(LessonsQuery)) q: LessonsQuery) {
    return this.questions.listLessons(q);
  }

  @Get('lessons/:id')
  getLesson(@Param('id') id: string) {
    return this.questions.getLesson(id);
  }

  @Patch('lessons/:id')
  updateLesson(@Param('id') id: string, @Body(new ZodPipe(LessonPatchInput)) body: LessonPatchInput, @Query(new ZodPipe(PublishFlagQuery)) f: z.infer<typeof PublishFlagQuery>, @CurrentUser() actor: Actor) {
    return this.questions.updateLesson(id, body, actor.id, { publish: f.publish });
  }
}

// ───────────── Concours structure: families, positions, editions, facts, sources, blueprints ─────────────

@Controller('admin')
@UseGuards(RolesGuard, AdminActorGuard)
@Roles('ADMIN', 'EDITOR')
export class AdminCatalogController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly facts: AdminFactsService,
  ) {}

  @Get('families')
  families() {
    return this.catalog.families();
  }

  @Get('families/:slug')
  family(@Param('slug') slug: string) {
    return this.catalog.family(slug);
  }

  @Post('families/:slug')
  createFamily(@Param('slug') slug: string, @Body(new ZodPipe(FamilyCreateInput)) body: FamilyCreateInput, @CurrentUser() actor: Actor) {
    return this.catalog.createFamily(slug, body, actor.id);
  }

  @Patch('families/:slug')
  updateFamily(@Param('slug') slug: string, @Body(new ZodPipe(FamilyPatchInput)) body: FamilyPatchInput, @CurrentUser() actor: Actor) {
    return this.catalog.updateFamily(slug, body, actor.id);
  }

  @Post('families/:slug/positions/:positionSlug')
  createPosition(@Param('slug') slug: string, @Param('positionSlug') positionSlug: string, @Body(new ZodPipe(PositionCreateInput)) body: PositionCreateInput, @CurrentUser() actor: Actor) {
    return this.catalog.createPosition(slug, positionSlug, body, actor.id);
  }

  @Patch('families/:slug/positions/:positionSlug')
  updatePosition(@Param('slug') slug: string, @Param('positionSlug') positionSlug: string, @Body(new ZodPipe(PositionPatchInput)) body: PositionPatchInput, @CurrentUser() actor: Actor) {
    return this.catalog.updatePosition(slug, positionSlug, body, actor.id);
  }

  @Get('editions')
  editions(@Query(new ZodPipe(EditionsQuery)) q: EditionsQuery) {
    return this.catalog.editions(q);
  }

  @Post('editions')
  createEdition(@Body(new ZodPipe(EditionUpsertInput)) body: z.infer<typeof EditionUpsertInput>, @CurrentUser() actor: Actor) {
    return this.catalog.createEdition(body, actor.id);
  }

  @Get('editions/:id')
  edition(@Param('id') id: string) {
    return this.catalog.edition(id);
  }

  /** `?notify=false` saves without sending the CONCOURS_UPDATE to followers (typo fixes). Profile matching always runs. */
  @Patch('editions/:id')
  updateEdition(@Param('id') id: string, @Body(new ZodPipe(EditionPatch)) body: EditionPatch, @Query(new ZodPipe(NotifyFlagQuery)) f: z.infer<typeof NotifyFlagQuery>, @CurrentUser() actor: Actor) {
    return this.catalog.updateEdition(id, body, actor.id, { notify: f.notify });
  }

  @Post('editions/:id/notify')
  @HttpCode(200)
  notifyEdition(@Param('id') id: string, @CurrentUser() actor: Actor) {
    return this.catalog.notifyEdition(id, actor.id);
  }

  @Post('editions/:id/update-notice')
  @HttpCode(200)
  updateNotice(@Param('id') id: string, @Body(new ZodPipe(EditionUpdateNoticeInput)) body: EditionUpdateNoticeInput, @CurrentUser() actor: Actor) {
    return this.catalog.editionUpdateNotice(id, { ar: body.summary_ar, fr: body.summary_fr }, actor.id);
  }

  @Get('facts')
  listFacts(@Query(new ZodPipe(FactsQuery)) q: FactsQuery) {
    return this.facts.facts(q);
  }

  @Patch('facts/:kind/:id')
  verifyFact(@Param('kind') kind: string, @Param('id') id: string, @Body(new ZodPipe(FactVerifyInput)) body: z.infer<typeof FactVerifyInput>, @CurrentUser() actor: Actor) {
    return this.facts.verify(factKind(kind), id, body, actor.id);
  }

  @Get('sources')
  sources(@Query(new ZodPipe(SourcesQuery)) q: SourcesQuery) {
    return this.facts.sources(q);
  }

  @Post('sources')
  createSource(@Body(new ZodPipe(SourceUpsertInput)) body: z.infer<typeof SourceUpsertInput>, @CurrentUser() actor: Actor) {
    return this.facts.createSource(body, actor.id);
  }

  @Patch('sources/:id')
  updateSource(@Param('id') id: string, @Body(new ZodPipe(SourcePatch)) body: SourcePatch, @CurrentUser() actor: Actor) {
    return this.facts.updateSource(id, body, actor.id);
  }

  @Post('sources/:id/verify')
  @HttpCode(200)
  verifySource(@Param('id') id: string, @CurrentUser() actor: Actor) {
    return this.facts.verifySource(id, actor.id);
  }

  @Get('blueprints')
  blueprints(@Query(new ZodPipe(BlueprintsQuery)) q: BlueprintsQuery) {
    return this.facts.blueprints(q);
  }

  /** `?replace=true` archives the position's current blueprint instead of refusing with BLUEPRINT_EXISTS. */
  @Post('blueprints')
  createBlueprint(@Body(new ZodPipe(BlueprintCreateInput)) body: BlueprintCreateInput, @Query(new ZodPipe(ReplaceFlagQuery)) f: z.infer<typeof ReplaceFlagQuery>, @CurrentUser() actor: Actor) {
    return this.facts.createBlueprint(body, actor.id, { replace: f.replace });
  }

  @Get('blueprints/:id')
  blueprint(@Param('id') id: string) {
    return this.facts.blueprint(id);
  }

  @Patch('blueprints/:id')
  updateBlueprint(@Param('id') id: string, @Body(new ZodPipe(BlueprintPatchInput)) body: BlueprintPatchInput, @CurrentUser() actor: Actor) {
    return this.facts.updateBlueprint(id, body, actor.id);
  }
}

// ───────────── Operations: reports, users, payments, broadcast, waitlist, audit ─────────────

@Controller('admin')
@UseGuards(RolesGuard, AdminActorGuard)
@Roles('ADMIN', 'EDITOR')
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('reports')
  reports(@Query(new ZodPipe(ReportsQuery)) q: ReportsQuery) {
    return this.ops.reports(q);
  }

  @Patch('reports/:id')
  updateReport(@Param('id') id: string, @Body(new ZodPipe(ReportPatchInput)) body: ReportPatchInput, @CurrentUser() actor: Actor) {
    return this.ops.updateReport(id, body, actor.id);
  }

  @Get('users')
  @Roles('ADMIN')
  users(@Query(new ZodPipe(UsersQuery)) q: UsersQuery) {
    return this.ops.users(q);
  }

  @Get('users/:id')
  @Roles('ADMIN')
  user(@Param('id') id: string) {
    return this.ops.user(id);
  }

  @Patch('users/:id')
  @Roles('ADMIN')
  updateUser(@Param('id') id: string, @Body(new ZodPipe(UserPatchInput)) body: UserPatchInput, @CurrentUser() actor: Actor) {
    return this.ops.updateUser(id, body, actor.id);
  }

  @Get('payments')
  @Roles('ADMIN')
  paymentsList(@Query(new ZodPipe(PaymentsQuery)) q: PaymentsQuery) {
    return this.ops.paymentsList(q);
  }

  @Post('payments/:id/approve')
  @Roles('ADMIN')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentUser() actor: Actor) {
    return this.ops.approvePayment(id, actor.id);
  }

  @Post('payments/:id/reject')
  @Roles('ADMIN')
  @HttpCode(200)
  reject(@Param('id') id: string, @Body(new ZodPipe(PaymentRejectInput)) body: PaymentRejectInput, @CurrentUser() actor: Actor) {
    return this.ops.rejectPayment(id, body.reason, actor.id);
  }

  /** `?dryRun=true` returns the audience size without sending anything. */
  @Post('notifications/broadcast')
  @Roles('ADMIN')
  @HttpCode(200)
  broadcast(@Body(new ZodPipe(BroadcastInput)) body: z.infer<typeof BroadcastInput>, @Query(new ZodPipe(DryRunQuery)) f: z.infer<typeof DryRunQuery>, @CurrentUser() actor: Actor) {
    return this.ops.broadcast(body, actor.id, { dryRun: f.dryRun });
  }

  /** Contact data: ADMIN only. `?format=csv` downloads the list. */
  @Get('waitlist')
  @Roles('ADMIN')
  async waitlist(@Query(new ZodPipe(WaitlistQuery)) q: WaitlistQuery, @CurrentUser() actor: Actor, @Res({ passthrough: true }) res: Response) {
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="waitlist-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return this.ops.waitlistCsv(q, actor.id);
    }
    return this.ops.waitlist(q);
  }

  @Get('audit')
  audit(@Query(new ZodPipe(AuditQuery)) q: AuditQuery, @CurrentUser() actor: Actor) {
    return this.ops.auditLog(q, actor.role);
  }
}

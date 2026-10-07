import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ATTEMPT_KINDS, AnswerInput, ReportQuestionInput, StartAttemptInput, type AttemptKind } from '@ctn/shared';
import { CurrentUser, UserGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { AttemptsService } from './attempts.service';
import { NotebookService, type ReportQuestionBody } from './notebook.service';
import { PracticeUserGuard, UserLimiter, intParam } from './practice.util';

/** Building an attempt runs the selection queries: a per-user speed bump against scripted session farming. */
const startLimiter = new UserLimiter(40, 10 * 60_000);

@Controller('attempts')
@UseGuards(UserGuard, PracticeUserGuard)
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Post()
  start(@CurrentUser() user: SessionUser, @Body(new ZodPipe(StartAttemptInput)) body: StartAttemptInput) {
    startLimiter.hit(user.id);
    return this.attempts.start(user.id, body);
  }

  /** History, most recent first; in-progress attempts have `submittedAt: null` (resume them with GET /attempts/:id). */
  @Get()
  history(@CurrentUser() user: SessionUser, @Query('kind') kind?: string, @Query('limit') limit?: string) {
    if (kind !== undefined && kind !== '' && !(ATTEMPT_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException('VALIDATION_FAILED');
    }
    return this.attempts.history(user.id, kind ? (kind as AttemptKind) : undefined, intParam(limit, 20, 100));
  }

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.attempts.get(user.id, id);
  }

  @Post(':id/answers')
  @HttpCode(200)
  answer(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(AnswerInput)) body: AnswerInput) {
    return this.attempts.answer(user.id, id, body);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.attempts.submit(user.id, id);
  }
}

@Controller()
@UseGuards(UserGuard, PracticeUserGuard)
export class NotebookController {
  constructor(private readonly notebook: NotebookService) {}

  @Get('me/mistakes')
  mistakes(@CurrentUser() user: SessionUser, @Query('limit') limit?: string) {
    return this.notebook.mistakes(user.id, intParam(limit, 50, 200));
  }

  @Get('me/bookmarks')
  bookmarks(@CurrentUser() user: SessionUser) {
    return this.notebook.bookmarks(user.id);
  }

  @Post('me/bookmarks/:questionId')
  @HttpCode(200)
  addBookmark(@CurrentUser() user: SessionUser, @Param('questionId') questionId: string) {
    return this.notebook.addBookmark(user.id, questionId);
  }

  @Delete('me/bookmarks/:questionId')
  removeBookmark(@CurrentUser() user: SessionUser, @Param('questionId') questionId: string) {
    return this.notebook.removeBookmark(user.id, questionId);
  }

  @Post('questions/:id/report')
  @HttpCode(200)
  report(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(ReportQuestionInput)) body: ReportQuestionBody) {
    return this.notebook.report(user.id, id, body);
  }

  @Get('offline/pack/:familySlug')
  offlinePack(@CurrentUser() user: SessionUser, @Param('familySlug') familySlug: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(familySlug)) throw new BadRequestException('VALIDATION_FAILED');
    return this.notebook.offlinePack(user.id, familySlug);
  }
}

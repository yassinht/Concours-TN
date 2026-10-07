import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { EnrollmentInput, PhysicalLogInput, ProfileInput } from '@ctn/shared';
import { CurrentUser, RegisteredGuard, UserGuard } from '../../common/auth.guards';
import { clearSessionCookie, type SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { appUrl } from '../auth/auth.util';
import { RateLimit } from '../auth/rate-limit';
import { ActiveUserGuard } from './active-user.guard';
import { CandidateToolsService } from './candidate-tools.service';
import { verifyUnsubscribeToken } from './email-preferences';
import { EnrollmentsService, type EnrollmentUpsert } from './enrollments.service';
import { UsersService } from './users.service';

const EnrollmentUpsertBody = EnrollmentInput.extend({ dailyMinutes: z.number().int().min(10).max(240).optional() });
const EnrollmentPatchBody = EnrollmentInput.partial().extend({ dailyMinutes: z.number().int().min(10).max(240).optional() });
const ChecklistBody = z.object({ checked: z.boolean() });
const DeleteAccountBody = z.object({ confirm: z.literal('DELETE') });
const SlugParam = z.string().min(1).max(120);

const slugPipe = new ZodPipe(SlugParam);
const slug = (value: string): string => slugPipe.transform(value);

@Controller('me')
@UseGuards(UserGuard, ActiveUserGuard)
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get('profile')
  profile(@CurrentUser() user: SessionUser) {
    return this.users.getProfile(user.id);
  }

  @Put('profile')
  updateProfile(@CurrentUser() user: SessionUser, @Body(new ZodPipe(ProfileInput)) body: ProfileInput) {
    return this.users.updateProfile(user.id, body);
  }

  @Get('referral')
  @UseGuards(RegisteredGuard)
  referral(@CurrentUser() user: SessionUser) {
    return this.users.referral(user.id);
  }

  @Get('export')
  @UseGuards(RegisteredGuard, RateLimit(10))
  async export(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response) {
    const data = await this.users.exportData(user.id);
    res.setHeader('Content-Disposition', `attachment; filename="concours-tn-export-${data.exportedAt.slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return data;
  }

  @Delete()
  @HttpCode(200)
  @UseGuards(RegisteredGuard, RateLimit(5))
  async deleteAccount(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(DeleteAccountBody)) _body: z.infer<typeof DeleteAccountBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.users.deleteAccount(user.id);
    clearSessionCookie(res);
    return r;
  }
}

@Controller('me')
@UseGuards(UserGuard, ActiveUserGuard)
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get('enrollments')
  list(@CurrentUser() user: SessionUser) {
    return this.enrollments.list(user.id);
  }

  @Post('enrollments')
  upsert(@CurrentUser() user: SessionUser, @Body(new ZodPipe(EnrollmentUpsertBody)) body: EnrollmentUpsert) {
    return this.enrollments.upsert(user.id, body);
  }

  @Patch('enrollments/:id')
  patch(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(EnrollmentPatchBody)) body: z.infer<typeof EnrollmentPatchBody>) {
    return this.enrollments.patch(user.id, id, body);
  }

  @Delete('enrollments/:id')
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.enrollments.remove(user.id, id);
  }

  @Get('follows')
  follows(@CurrentUser() user: SessionUser) {
    return this.enrollments.listFollows(user.id);
  }

  @Post('follows/:familySlug')
  @HttpCode(200)
  follow(@CurrentUser() user: SessionUser, @Param('familySlug') familySlug: string) {
    return this.enrollments.follow(user.id, slug(familySlug));
  }

  @Delete('follows/:familySlug')
  unfollow(@CurrentUser() user: SessionUser, @Param('familySlug') familySlug: string) {
    return this.enrollments.unfollow(user.id, slug(familySlug));
  }
}

@Controller('me')
@UseGuards(UserGuard, ActiveUserGuard)
export class CandidateToolsController {
  constructor(private readonly tools: CandidateToolsService) {}

  @Get('checklist/:familySlug')
  checklist(@CurrentUser() user: SessionUser, @Param('familySlug') familySlug: string) {
    return this.tools.checklist(user.id, slug(familySlug));
  }

  @Put('checklist/:factId')
  setChecked(@CurrentUser() user: SessionUser, @Param('factId') factId: string, @Body(new ZodPipe(ChecklistBody)) body: z.infer<typeof ChecklistBody>) {
    return this.tools.setChecked(user.id, factId, body.checked);
  }

  @Get('physical-logs')
  logs(@CurrentUser() user: SessionUser, @Query('testCode') testCode?: string, @Query('limit') limit?: string) {
    return this.tools.listLogs(user.id, typeof testCode === 'string' ? testCode : undefined, Number(limit) || 200);
  }

  @Post('physical-logs')
  @UseGuards(RateLimit(60))
  addLog(@CurrentUser() user: SessionUser, @Body(new ZodPipe(PhysicalLogInput)) body: z.infer<typeof PhysicalLogInput>) {
    return this.tools.addLog(user.id, body);
  }

  @Delete('physical-logs/:id')
  deleteLog(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.tools.deleteLog(user.id, id);
  }
}

/** One-click unsubscribe from notification emails (link + RFC 8058 List-Unsubscribe-Post). No session needed. */
@Controller('email')
export class EmailPreferencesController {
  constructor(private readonly users: UsersService) {}

  @Get('unsubscribe/:token')
  @UseGuards(RateLimit(30))
  async unsubscribeLink(@Param('token') token: string, @Res() res: Response) {
    const userId = verifyUnsubscribeToken(token);
    if (userId) await this.users.unsubscribeEmail(userId);
    res.redirect(302, appUrl(`/app/settings?emailUnsubscribed=${userId ? '1' : '0'}`));
  }

  @Post('unsubscribe/:token')
  @HttpCode(200)
  @UseGuards(RateLimit(30))
  async unsubscribeOneClick(@Param('token') token: string) {
    const userId = verifyUnsubscribeToken(token);
    if (userId) await this.users.unsubscribeEmail(userId);
    return { ok: !!userId };
  }
}

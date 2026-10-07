import { BadRequestException, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { ReadinessDTO, TodayPlanDTO } from '@ctn/shared';
import { CurrentUser, UserGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { ActiveUserGuard } from '../users/active-user.guard';
import { CurriculumService } from './curriculum.service';
import { PlanService } from './plan.service';
import { ProgressService, type ProgressDTO } from './progress.service';
import { ReadinessService } from './readiness.service';

const SlugSchema = z.string().trim().min(1).max(120);
const optionalSlug = new ZodPipe(SlugSchema.optional());
const MAX_PLAN_ITEMS = 50;

@Controller('me')
@UseGuards(UserGuard, ActiveUserGuard)
export class LearningController {
  constructor(
    private readonly plans: PlanService,
    private readonly readiness: ReadinessService,
    private readonly progress: ProgressService,
    private readonly curriculum: CurriculumService,
  ) {}

  @Get('plan/today')
  today(@CurrentUser() user: SessionUser, @Query('familySlug') familySlug?: string): Promise<TodayPlanDTO> {
    return this.plans.today(user.id, optionalSlug.transform(familySlug || undefined));
  }

  @Post('plan/today/:index/done')
  @HttpCode(200)
  done(@CurrentUser() user: SessionUser, @Param('index') index: string): Promise<TodayPlanDTO> {
    if (!/^\d{1,3}$/.test(index) || Number(index) >= MAX_PLAN_ITEMS) {
      throw new BadRequestException({ message: 'VALIDATION_FAILED', issues: [{ path: ['index'], message: 'invalid item index' }] });
    }
    return this.plans.markDone(user.id, Number(index));
  }

  @Get('readiness/:familySlug')
  async readinessFor(@CurrentUser() user: SessionUser, @Param('familySlug') familySlug: string): Promise<ReadinessDTO> {
    const slug = SlugSchema.safeParse(familySlug);
    const family = slug.success ? await this.curriculum.familyBySlug(slug.data) : null;
    if (!family) throw new NotFoundException('NOT_FOUND');
    return this.readiness.forFamily(user.id, family.id);
  }

  @Get('progress')
  progressOf(@CurrentUser() user: SessionUser): Promise<ProgressDTO> {
    return this.progress.forUser(user.id);
  }
}

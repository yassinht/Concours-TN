import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { TutorInput, type TutorResponseDTO } from '@ctn/shared';
import { CurrentUser, UserGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { ActiveUserGuard } from '../users/active-user.guard';
import { TutorService } from './tutor.service';

@Controller('tutor')
@UseGuards(UserGuard, ActiveUserGuard)
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  /** 403 NOT_ANSWERED / EXAM_IN_PROGRESS, 404 NOT_FOUND, 402 LIMIT_REACHED (free: 3/day), 429 RATE_LIMITED. */
  @Post('explain')
  @HttpCode(200)
  explain(@CurrentUser() user: SessionUser, @Body(new ZodPipe(TutorInput)) body: TutorInput): Promise<TutorResponseDTO> {
    return this.tutor.explain(user.id, body);
  }
}

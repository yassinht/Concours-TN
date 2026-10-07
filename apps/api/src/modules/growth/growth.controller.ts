import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { WaitlistInput } from '@ctn/shared';
import { CurrentUser } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { RateLimit } from '../auth/rate-limit';
import { EventInput, GrowthService, type WaitlistBody } from './growth.service';

@Controller()
export class GrowthController {
  constructor(private readonly growth: GrowthService) {}

  @Post('waitlist')
  @HttpCode(200)
  @UseGuards(RateLimit(10))
  join(@Body(new ZodPipe(WaitlistInput)) body: WaitlistBody) {
    return this.growth.joinWaitlist(body);
  }

  @Post('events')
  @HttpCode(200)
  @UseGuards(RateLimit(120))
  track(@CurrentUser() session: SessionUser | null, @Body(new ZodPipe(EventInput)) body: EventInput) {
    return this.growth.track(session?.id ?? null, body);
  }
}

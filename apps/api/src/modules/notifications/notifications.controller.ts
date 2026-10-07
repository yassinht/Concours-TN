import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PushSubscribeInput } from '@ctn/shared';
import { CurrentUser, UserGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { RateLimit } from '../auth/rate-limit';
import { ActiveUserGuard } from '../users/active-user.guard';
import { AlertsService } from './alerts.service';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const ListQuery = z.object({
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).default(30)),
  /** Keyset pagination: createdAt of the last item already shown. */
  before: z.preprocess(blankToUndefined, z.string().datetime({ offset: true }).optional()),
});
type ListQuery = z.infer<typeof ListQuery>;

const AlertsQuery = z.object({ limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(200).default(50)) });
type AlertsQuery = z.infer<typeof AlertsQuery>;

const SubscribeBody = PushSubscribeInput.extend({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
});
type SubscribeBody = z.infer<typeof SubscribeBody>;
const UnsubscribeBody = z.object({ endpoint: z.string().min(1).max(1000) });
type UnsubscribeBody = z.infer<typeof UnsubscribeBody>;

/** In-app inbox and "concours matching my profile". */
@Controller('me')
@UseGuards(UserGuard, ActiveUserGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService,
  ) {}

  @Get('notifications')
  list(@CurrentUser() user: SessionUser, @Query(new ZodPipe(ListQuery)) q: ListQuery) {
    return this.notifications.list(user.id, q.limit, q.before ? new Date(q.before) : undefined);
  }

  /** Extra (not in the base contract): cheap poll for the header bell. */
  @Get('notifications/unread-count')
  async unreadCount(@CurrentUser() user: SessionUser) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: SessionUser) {
    await this.notifications.markAllRead(user.id);
    return { ok: true };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    if (!(await this.notifications.markRead(user.id, id))) throw new NotFoundException('NOT_FOUND');
    return { ok: true };
  }

  @Get('alerts')
  alertsList(@CurrentUser() user: SessionUser, @Query(new ZodPipe(AlertsQuery)) q: AlertsQuery) {
    return this.alerts.listForUser(user.id, q.limit);
  }
}

/** Web push subscriptions (the service worker lives in apps/web/public/sw.js). */
@Controller('push')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('vapid-public-key')
  vapidPublicKey() {
    return { key: this.push.publicKey() };
  }

  @Post('subscribe')
  @HttpCode(200)
  @UseGuards(UserGuard, ActiveUserGuard, RateLimit(20))
  async subscribe(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(SubscribeBody)) body: SubscribeBody,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.push.subscribe(user.id, body, userAgent ?? null);
    return { ok: true };
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @UseGuards(UserGuard, RateLimit(20))
  async unsubscribe(@CurrentUser() user: SessionUser, @Body(new ZodPipe(UnsubscribeBody)) body: UnsubscribeBody) {
    await this.push.unsubscribe(user.id, body.endpoint);
    return { ok: true };
  }

  /** Extra (not in the base contract): "send me a test notification" button in the settings page. */
  @Post('test')
  @HttpCode(200)
  @UseGuards(UserGuard, ActiveUserGuard, RateLimit(3))
  async test(@CurrentUser() user: SessionUser, @Query('locale') locale?: string) {
    const r = await this.notifications.sendTestPush(user.id, locale === 'ar' || locale === 'fr' ? locale : undefined);
    return { ok: r.status === 'SENT', status: r.status, error: r.error ?? null };
  }
}

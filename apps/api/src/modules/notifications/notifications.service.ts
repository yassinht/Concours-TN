import { Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Locale, NotificationChannel, NotificationDTO, NotificationType } from '@ctn/shared';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { notificationDeliveries, notifications, userProfiles, users } from '../../db/schema';
import { unsubscribeUrl } from '../users/email-preferences';
import { MailService } from './mail.service';
import { notificationEmail } from './notification-email';
import {
  BATCH_SIZE, DELIVERY_CONCURRENCY, UUID_RE, absoluteLink, asLocale, chunks, errorMessage, mapLimit, resolveChannels, safeLink,
} from './notifications.util';
import { PushService, type DeliveryOutcome } from './push.service';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  url?: string | null;
  data?: Record<string, unknown>;
  /** Idempotency: the same (userId, dedupeKey) is never notified twice. */
  dedupeKey?: string;
  /**
   * Defaults to the user's profile alert_channels (IN_APP is always delivered). When given, it narrows the user's
   * channels (e.g. ['IN_APP','PUSH'] for daily nudges); it never re-enables a channel the user turned off.
   */
  channels?: NotificationChannel[];
  /** Web push time-to-live in seconds (default 24 h): a study nudge is useless the next day. */
  pushTtlSeconds?: number;
  pushUrgency?: 'very-low' | 'low' | 'normal' | 'high';
}

interface Recipient {
  id: string;
  email: string | null;
  isGuest: boolean;
  emailVerifiedAt: Date | null;
  channels: string[] | null;
}

type NotificationRow = typeof notifications.$inferSelect;

const ARABIC_RE = /[؀-ۿ]/;

export function toNotificationDTO(n: NotificationRow): NotificationDTO {
  return {
    id: n.id,
    type: n.type as NotificationType,
    title: n.title,
    body: n.body,
    url: n.url,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    data: (n.data ?? {}) as Record<string, unknown>,
  };
}

/**
 * CONTRACT (owned by the notifications module):
 * - notify(userId, input) → creates the in-app notification row, then delivers via web push and/or email per channels,
 *   recording notification_deliveries. Returns the notification id, or null when deduplicated.
 * - notifyMany(userIds, input) → same for many users (batched). Returns how many notifications were created.
 * Delivery problems (push service down, SMTP error) are recorded, never thrown: the in-app notification exists anyway.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly mail: MailService,
    private readonly push: PushService,
  ) {}

  async notify(userId: string, input: NotifyInput): Promise<string | null> {
    const created = await this.createAndDeliver([userId], input);
    return created.get(userId) ?? null;
  }

  async notifyMany(userIds: string[], input: NotifyInput): Promise<number> {
    const unique = [...new Set(userIds)];
    let created = 0;
    for (const batch of chunks(unique, BATCH_SIZE)) created += (await this.createAndDeliver(batch, input)).size;
    return created;
  }

  // ───────────── In-app inbox ─────────────

  async list(userId: string, limit = 30, before?: Date): Promise<{ items: NotificationDTO[]; unread: number }> {
    const [rows, unread] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, userId), before ? lt(notifications.createdAt, before) : undefined))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(Math.min(Math.max(limit, 1), 100)),
      this.unreadCount(userId),
    ]);
    return { items: rows.map(toNotificationDTO), unread };
  }

  async unreadCount(userId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(r?.n ?? 0);
  }

  /** False when the notification does not exist or belongs to someone else. Idempotent. */
  async markRead(userId: string, id: string): Promise<boolean> {
    if (!UUID_RE.test(id)) return false;
    const [n] = await this.db
      .select({ id: notifications.id, readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1);
    if (!n) return false;
    if (!n.readAt) await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), isNull(notifications.readAt)));
    return true;
  }

  async markAllRead(userId: string): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return rows.length;
  }

  /** Push-only test message so a user can check that notifications reach this device (settings page). */
  async sendTestPush(userId: string, locale?: Locale): Promise<DeliveryOutcome> {
    if (!locale) {
      const [u] = await this.db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
      locale = asLocale(u?.locale);
    }
    const text = locale === 'fr'
      ? { title: 'Notifications activées', body: 'Vous recevrez ici les alertes concours et les rappels de dates limites.' }
      : { title: 'التنبيهات مفعّلة', body: 'ستصلك هنا تنبيهات المناظرات وتذكيرات الآجال.' };
    return this.push.sendToUser(userId, { ...text, url: '/app/notifications', tag: 'test', type: 'SYSTEM' }, { ttlSeconds: 300 });
  }

  // ───────────── Internals ─────────────

  private async createAndDeliver(userIds: string[], input: NotifyInput): Promise<Map<string, string>> {
    const ids = userIds.filter((id) => UUID_RE.test(id));
    if (!ids.length) return new Map();
    const recipients = await this.db
      .select({
        id: users.id,
        email: users.email,
        isGuest: users.isGuest,
        emailVerifiedAt: users.emailVerifiedAt,
        channels: userProfiles.alertChannels,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(inArray(users.id, ids), isNull(users.deletedAt)));
    if (!recipients.length) return new Map();

    const url = safeLink(input.url);
    const title = input.title.trim().slice(0, 200);
    const body = input.body.trim().slice(0, 2000);
    const rows = await this.db
      .insert(notifications)
      .values(recipients.map((r) => ({
        userId: r.id,
        type: input.type,
        title,
        body,
        url,
        data: input.data ?? {},
        dedupeKey: input.dedupeKey ?? null,
      })))
      .onConflictDoNothing()
      .returning({ id: notifications.id, userId: notifications.userId });

    const byUser = new Map(recipients.map((r) => [r.id, r]));
    await mapLimit(rows, DELIVERY_CONCURRENCY, async (row) => {
      const r = byUser.get(row.userId);
      if (r) await this.deliver(row.id, r, { ...input, title, body, url });
    });
    return new Map(rows.map((r) => [r.userId, r.id]));
  }

  private async deliver(notificationId: string, r: Recipient, input: NotifyInput & { url: string | null }): Promise<void> {
    const channels = resolveChannels(r.channels, input.channels);
    const tasks: Promise<{ channel: NotificationChannel } & DeliveryOutcome>[] = [
      Promise.resolve({ channel: 'IN_APP' as const, status: 'SENT' as const }),
    ];
    if (channels.has('PUSH')) {
      tasks.push(
        this.push
          .sendToUser(
            r.id,
            { title: input.title, body: input.body, url: input.url ?? '/app/notifications', tag: input.dedupeKey ?? notificationId, type: input.type, id: notificationId },
            { ttlSeconds: input.pushTtlSeconds, urgency: input.pushUrgency },
          )
          .catch((e): DeliveryOutcome => ({ status: 'FAILED', error: errorMessage(e) }))
          .then((o) => ({ channel: 'PUSH' as const, ...o })),
      );
    }
    if (channels.has('EMAIL')) tasks.push(this.deliverEmail(r, input).then((o) => ({ channel: 'EMAIL' as const, ...o })));

    const outcomes = await Promise.all(tasks);
    try {
      await this.db.insert(notificationDeliveries).values(outcomes.map((o) => ({
        notificationId,
        channel: o.channel,
        status: o.status,
        error: o.error ?? null,
      })));
    } catch (e) {
      this.logger.warn(`could not record deliveries of ${notificationId}: ${errorMessage(e)}`);
    }
  }

  /** Email goes to registered users with a confirmed address only (the welcome email promises exactly that). */
  private async deliverEmail(r: Recipient, input: NotifyInput & { url: string | null }): Promise<DeliveryOutcome> {
    if (r.isGuest || !r.email) return { status: 'SKIPPED', error: 'NO_EMAIL' };
    if (!r.emailVerifiedAt) return { status: 'SKIPPED', error: 'EMAIL_UNVERIFIED' };
    try {
      const unsubscribe = unsubscribeUrl(r.id);
      const mail = notificationEmail({
        locale: ARABIC_RE.test(input.title + input.body) ? 'ar' : 'fr',
        type: input.type,
        title: input.title,
        body: input.body,
        ctaUrl: absoluteLink(input.url),
        unsubscribeUrl: unsubscribe,
        settingsUrl: absoluteLink('/app/settings') as string,
      });
      await this.mail.send(r.email, mail.subject, mail.html, mail.text, {
        headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      return { status: 'SENT' };
    } catch (e) {
      return { status: 'FAILED', error: errorMessage(e) };
    }
  }
}

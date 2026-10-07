import { Injectable } from '@nestjs/common';
import type { NotificationChannel, NotificationType } from '@ctn/shared';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  url?: string | null;
  data?: Record<string, unknown>;
  /** Idempotency: the same (userId, dedupeKey) is never notified twice. */
  dedupeKey?: string;
  /** Defaults to the user's profile alert_channels (IN_APP is always delivered). */
  channels?: NotificationChannel[];
}

/**
 * CONTRACT (owned by the notifications module):
 * - notify(userId, input) → creates the in-app notification row, then delivers via web push and/or email per channels,
 *   recording notification_deliveries. Returns the notification id, or null when deduplicated.
 * - notifyMany(userIds, input) → same for many users (batched).
 */
@Injectable()
export class NotificationsService {
  async notify(_userId: string, _input: NotifyInput): Promise<string | null> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async notifyMany(_userIds: string[], _input: NotifyInput): Promise<number> {
    throw new Error('NOT_IMPLEMENTED');
  }
}

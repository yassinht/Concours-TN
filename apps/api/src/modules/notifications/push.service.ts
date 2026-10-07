import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import webpush from 'web-push';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { pushSubscriptions } from '../../db/schema';
import { errorMessage } from './notifications.util';

export interface PushPayload {
  title: string;
  body: string;
  /** Same-site path or absolute URL opened when the notification is clicked (see apps/web/public/sw.js). */
  url: string | null;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
  type?: string;
  id?: string;
}

export interface PushOptions {
  ttlSeconds?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

export interface DeliveryOutcome {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  error?: string | null;
}

/** A browser keeps a handful of subscriptions per user (phone, laptop…); older ones beyond this are dropped. */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Push services of the browsers we support. The server POSTs to whatever endpoint a client registers, so an open
 * endpoint would let anyone make the API call internal URLs (SSRF). Extra hosts: PUSH_ENDPOINT_HOSTS=host1,host2.
 */
const PUSH_HOST_SUFFIXES = ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  const extra = (process.env.PUSH_ENDPOINT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...PUSH_HOST_SUFFIXES, ...extra].some((s) => host === s || host.endsWith(`.${s}`));
}

function clip(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger('PushService');

  constructor(@InjectDb() private readonly db: Database) {}

  /** VAPID credentials, or null when web push is not configured (deliveries are then recorded as SKIPPED). */
  vapid(): { publicKey: string; privateKey: string; subject: string } | null {
    const e = env();
    if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return null;
    return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT };
  }

  publicKey(): string | null {
    return this.vapid()?.publicKey ?? null;
  }

  /** Upsert by endpoint: a browser that signs into another account moves its subscription to that account. */
  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string | null): Promise<void> {
    if (!isAllowedPushEndpoint(sub.endpoint)) throw new BadRequestException('INVALID_PUSH_ENDPOINT');
    const ua = userAgent ? userAgent.slice(0, 300) : null;
    await this.db
      .insert(pushSubscriptions)
      .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua, createdAt: new Date() },
      });
    const keep = await this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt))
      .limit(MAX_SUBSCRIPTIONS_PER_USER);
    if (keep.length === MAX_SUBSCRIPTIONS_PER_USER) {
      await this.db.delete(pushSubscriptions).where(and(
        eq(pushSubscriptions.userId, userId),
        notInArray(pushSubscriptions.id, keep.map((k) => k.id)),
      ));
    }
  }

  async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
    const rows = await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning({ id: pushSubscriptions.id });
    return rows.length > 0;
  }

  /** Sends to every device of the user. SENT when at least one device accepted; gone subscriptions (404/410) are deleted. */
  async sendToUser(userId: string, payload: PushPayload, opts: PushOptions = {}): Promise<DeliveryOutcome> {
    const vapid = this.vapid();
    if (!vapid) return { status: 'SKIPPED', error: 'VAPID_NOT_CONFIGURED' };
    const subs = await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    if (!subs.length) return { status: 'SKIPPED', error: 'NO_SUBSCRIPTION' };

    const body = JSON.stringify({ ...payload, title: clip(payload.title, 120), body: clip(payload.body, 400) });
    const gone: string[] = [];
    const errors: string[] = [];
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            vapidDetails: vapid,
            TTL: opts.ttlSeconds ?? 86_400,
            urgency: opts.urgency ?? 'normal',
            timeout: 10_000,
          });
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(s.id);
          else errors.push(status ? `HTTP_${status}` : errorMessage(e));
        }
      }),
    );
    if (gone.length) {
      await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
      this.logger.debug(`removed ${gone.length} expired push subscription(s) of ${userId}`);
    }
    if (sent > 0) return { status: 'SENT', error: errors.length ? errors.join('; ').slice(0, 500) : null };
    if (!errors.length) return { status: 'SKIPPED', error: 'SUBSCRIPTIONS_EXPIRED' };
    return { status: 'FAILED', error: errors.join('; ').slice(0, 500) };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { AlertsService } from '../notifications/alerts.service';
import { waitAtMost } from './auth.util';

/**
 * Runs "which open concours match this user's profile?" (AlertsService.matchUser) right after the events that can change
 * the answer: registration, sign-in with a merged guest, profile edits, following/enrolling in a family.
 * It never fails the caller's request and waits at most `timeoutMs`, so the next page already shows the new matches in
 * the common case while a slow run simply finishes in the background.
 */
@Injectable()
export class AlertsTrigger {
  private readonly logger = new Logger('AlertsTrigger');

  constructor(private readonly alerts: AlertsService) {}

  async run(userId: string, reason: string, timeoutMs = 3000): Promise<void> {
    const job = Promise.resolve()
      .then(() => this.alerts.matchUser(userId))
      .then(() => undefined)
      .catch((e: unknown) => {
        this.logger.warn(`matchUser(${userId}) after ${reason} failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    await waitAtMost(job, timeoutMs);
  }
}

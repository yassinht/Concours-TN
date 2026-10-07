import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gte, isNotNull, lt, lte } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { tunisToday } from '../../common/dates';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { competitions } from '../../db/schema';
import { CatalogService } from './catalog.service';

/**
 * Keeps edition statuses true to their announced dates, so every module (alert matching, deadline reminders, admin)
 * reads the same reality as the public catalog:
 * - OPEN with a registration deadline in the past → CLOSED
 * - ANNOUNCED whose registration window has started → OPEN
 * Runs daily just after midnight (Africa/Tunis) and once at boot; every change is audited.
 */
@Injectable()
export class EditionStatusJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(EditionStatusJob.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  onApplicationBootstrap(): void {
    if (!env().CRON_ENABLED || env().NODE_ENV === 'test') return;
    this.run().catch((e) => this.logger.error(`edition status sync failed: ${(e as Error).message}`));
  }

  @Cron('7 0 * * *', { name: 'catalog-edition-status', timeZone: 'Africa/Tunis' })
  async daily(): Promise<void> {
    if (!env().CRON_ENABLED) return;
    await this.run();
  }

  async run(today = tunisToday()): Promise<{ opened: string[]; closed: string[] }> {
    const now = new Date();
    const closed = await this.db
      .update(competitions)
      .set({ status: 'CLOSED', updatedAt: now })
      .where(and(eq(competitions.status, 'OPEN'), isNotNull(competitions.registrationDeadline), lt(competitions.registrationDeadline, today)))
      .returning({ id: competitions.id });
    const opened = await this.db
      .update(competitions)
      .set({ status: 'OPEN', updatedAt: now })
      .where(and(
        eq(competitions.status, 'ANNOUNCED'),
        lte(competitions.registrationOpen, today),
        gte(competitions.registrationDeadline, today),
      ))
      .returning({ id: competitions.id });
    for (const r of closed) await this.audit.log(null, 'edition.auto_close', 'edition', r.id, { from: 'OPEN', to: 'CLOSED', today });
    for (const r of opened) await this.audit.log(null, 'edition.auto_open', 'edition', r.id, { from: 'ANNOUNCED', to: 'OPEN', today });
    if (closed.length || opened.length) {
      this.catalog.invalidate();
      this.logger.log(`edition statuses synced: ${opened.length} opened, ${closed.length} closed`);
    }
    return { opened: opened.map((r) => r.id), closed: closed.map((r) => r.id) };
  }
}

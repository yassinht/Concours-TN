import { Injectable } from '@nestjs/common';
import { InjectDb } from '../db/db.module';
import type { Database } from '../db/client';
import { auditLogs, contentReviews } from '../db/schema';

@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Database) {}

  async log(actorId: string | null, action: string, entityType: string, entityId: string | null, diff?: unknown) {
    await this.db.insert(auditLogs).values({ actorId, action, entityType, entityId, diff: diff as object });
  }

  async review(entityType: string, entityId: string, fromStatus: string | null, toStatus: string, reviewerId: string | null, comment?: string) {
    await this.db.insert(contentReviews).values({ entityType, entityId, fromStatus, toStatus, reviewerId, comment });
  }
}

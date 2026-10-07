import { Injectable } from '@nestjs/common';
import type { ReadinessDTO } from '@ctn/shared';

/**
 * CONTRACT (owned by the learning module):
 * - forFamily(userId, familyId) → ReadinessDTO computed with @ctn/shared computeReadiness from the user's mastery rows on the
 *   family's syllabus, domain weights from the primary position's blueprint (fallback: equal weights), and the user's last
 *   MOCK attempt scores for that family. Upserts today's readiness_snapshots row and returns history (last 30 snapshots).
 */
@Injectable()
export class ReadinessService {
  async forFamily(_userId: string, _familyId: string): Promise<ReadinessDTO> {
    throw new Error('NOT_IMPLEMENTED');
  }
}

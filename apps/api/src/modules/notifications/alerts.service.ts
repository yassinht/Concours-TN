import { Injectable } from '@nestjs/common';

/**
 * CONTRACT (owned by the notifications module) — "notify people when a concours matches their profile":
 * - matchCompetition(competitionId) → for every user with alerts enabled (and matching alert_fields, or following the family),
 *   run checkEligibility (@ctn/shared) against each relevant position; for ELIGIBLE/PARTIAL results insert alert_matches and
 *   send a CONCOURS_MATCH notification (dedupeKey `match:<competitionId>:<positionId>`). Sets competitions.alerts_sent_at.
 *   Returns { matchedUsers, notified }.
 * - matchUser(userId) → run all OPEN/ANNOUNCED competitions against one user (after profile update / registration).
 */
@Injectable()
export class AlertsService {
  async matchCompetition(_competitionId: string): Promise<{ matchedUsers: number; notified: number }> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async matchUser(_userId: string): Promise<{ matched: number }> {
    throw new Error('NOT_IMPLEMENTED');
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { ContentStatus, EditionStatus } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { competitions } from '../../db/schema';
import { AlertsService } from '../notifications/alerts.service';
import { formatDay, sameValue } from './admin.util';

/** The edition fields that decide who gets alerted and what they are told. */
export interface EditionSnapshot {
  id: string;
  familyId: string;
  status: EditionStatus;
  contentStatus: ContentStatus;
  needsVerification: boolean;
  registrationOpen: string | null;
  registrationDeadline: string | null;
  examDate: string | null;
  positionsCount: number | null;
  positionSlugs: string[];
  alertsSentAt: Date | null;
}

export interface EditionAlertOutcome {
  /** AlertsService.matchCompetition counts when profile matching ran. */
  alerts: { matchedUsers: number; notified: number } | null;
  /** CONCOURS_UPDATE notifications sent to followers / enrolled / matched users. */
  updateNotified: number;
  updateSummary: { ar: string; fr: string } | null;
}

const ANNOUNCEABLE: EditionStatus[] = ['OPEN', 'ANNOUNCED'];

/** Users can be alerted about an edition only once a human published it and registration is (about to be) open. */
export function isAnnounceable(e: Pick<EditionSnapshot, 'status' | 'contentStatus' | 'registrationDeadline'>, today = tunisToday()): boolean {
  return e.contentStatus === 'PUBLISHED' && ANNOUNCEABLE.includes(e.status) && (!e.registrationDeadline || e.registrationDeadline >= today);
}

/** Why an edition cannot be announced (null when it can). */
export function notAnnounceableReason(e: Pick<EditionSnapshot, 'status' | 'contentStatus' | 'registrationDeadline'>, today = tunisToday()): string | null {
  if (e.contentStatus !== 'PUBLISHED') return 'NOT_PUBLISHED';
  if (!ANNOUNCEABLE.includes(e.status)) return 'STATUS_NOT_OPEN_OR_ANNOUNCED';
  if (e.registrationDeadline && e.registrationDeadline < today) return 'DEADLINE_PASSED';
  return null;
}

/**
 * Profile matching must run when an edition becomes announceable (status OPEN/ANNOUNCED, published), and again when
 * something that changes who matches moves (targeted positions, verification, registration status). AlertsService
 * dedupes per user and edition, so a re-run only reaches users who were not alerted yet.
 */
export function shouldMatch(before: EditionSnapshot | null, after: EditionSnapshot): boolean {
  if (!isAnnounceable(after)) return false;
  if (!before || !isAnnounceable(before)) return true;
  return before.status !== after.status
    || !sameValue([...before.positionSlugs].sort(), [...after.positionSlugs].sort())
    || (before.needsVerification && !after.needsVerification)
    || before.registrationDeadline !== after.registrationDeadline;
}

/**
 * Bilingual summary of what changed for people already following the edition (dates moved, registration opened,
 * results out, data confirmed). Null when nothing worth a notification changed.
 */
export function updateSummary(before: EditionSnapshot, after: EditionSnapshot): { ar: string; fr: string } | null {
  const ar: string[] = [];
  const fr: string[] = [];
  if (before.status !== after.status) {
    if (after.status === 'OPEN') {
      ar.push('التسجيل مفتوح الآن.');
      fr.push('Les inscriptions sont ouvertes.');
    } else if (after.status === 'RESULTS') {
      ar.push('تم الإعلان عن النتائج.');
      fr.push('Les résultats ont été publiés.');
    }
  }
  if (after.registrationOpen && before.registrationOpen !== after.registrationOpen) {
    ar.push(`تاريخ فتح التسجيل: ${formatDay(after.registrationOpen)}`);
    fr.push(`Ouverture des inscriptions : ${formatDay(after.registrationOpen)}`);
  }
  if (after.registrationDeadline && before.registrationDeadline !== after.registrationDeadline) {
    ar.push(`آخر أجل للتسجيل: ${formatDay(after.registrationDeadline)}`);
    fr.push(`Date limite d’inscription : ${formatDay(after.registrationDeadline)}`);
  }
  if (after.examDate && before.examDate !== after.examDate) {
    ar.push(`تاريخ الاختبار: ${formatDay(after.examDate)}`);
    fr.push(`Date de l’examen : ${formatDay(after.examDate)}`);
  }
  if (after.positionsCount != null && before.positionsCount !== after.positionsCount) {
    ar.push(`عدد الخطط المفتوحة: ${after.positionsCount}`);
    fr.push(`Nombre de postes : ${after.positionsCount}`);
  }
  if (before.needsVerification && !after.needsVerification) {
    ar.push('تم تأكيد هذه المعطيات من مصدر رسمي.');
    fr.push('Ces informations ont été confirmées par une source officielle.');
  }
  return ar.length ? { ar: ar.join('\n'), fr: fr.join('\n') } : null;
}

@Injectable()
export class EditionAlertsService {
  private readonly logger = new Logger('EditionAlerts');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly alerts: AlertsService,
  ) {}

  async snapshot(id: string): Promise<EditionSnapshot | null> {
    const [c] = await this.db
      .select({
        id: competitions.id, familyId: competitions.familyId, status: competitions.status, contentStatus: competitions.contentStatus,
        needsVerification: competitions.needsVerification, registrationOpen: competitions.registrationOpen,
        registrationDeadline: competitions.registrationDeadline, examDate: competitions.examDate,
        positionsCount: competitions.positionsCount, positionSlugs: competitions.positionSlugs, alertsSentAt: competitions.alertsSentAt,
      })
      .from(competitions)
      .where(eq(competitions.id, id))
      .limit(1);
    return c ? { ...c, positionSlugs: c.positionSlugs ?? [] } : null;
  }

  /**
   * Called after a human saved an edition. Runs profile matching when needed (awaited, counts returned) and, when
   * `notifyUpdates`, sends a CONCOURS_UPDATE to the people already following an edition they were told about.
   */
  async afterChange(before: EditionSnapshot | null, after: EditionSnapshot, opts: { notifyUpdates?: boolean } = {}): Promise<EditionAlertOutcome> {
    const out: EditionAlertOutcome = { alerts: null, updateNotified: 0, updateSummary: null };
    if (shouldMatch(before, after)) out.alerts = await this.matchNow(after.id);

    // An update only makes sense for an edition users may already know about, and never for a hidden draft.
    if (before && opts.notifyUpdates !== false && after.contentStatus === 'PUBLISHED' && before.contentStatus === 'PUBLISHED') {
      const summary = updateSummary(before, after);
      // The first match notification already carries the dates: no separate "update" for an edition announced just now.
      const justAnnounced = out.alerts !== null && !before.alertsSentAt && !isAnnounceable(before);
      if (summary && !justAnnounced) {
        out.updateSummary = summary;
        out.updateNotified = await this.sendUpdate(after.id, summary);
      }
    }
    return out;
  }

  async matchNow(id: string): Promise<{ matchedUsers: number; notified: number }> {
    return this.alerts.matchCompetition(id);
  }

  async sendUpdate(id: string, summary: { ar: string; fr: string }, key?: string): Promise<number> {
    return this.alerts.notifyCompetitionUpdate(id, summary, key);
  }

  /**
   * Eligibility rules of a family changed or were verified: refresh matches of its announceable editions in the
   * background (users newly eligible get alerted; dedupe keeps everyone else quiet).
   */
  rematchFamily(familyId: string): void {
    const today = tunisToday();
    void (async () => {
      const rows = await this.db
        .select({ id: competitions.id, status: competitions.status, contentStatus: competitions.contentStatus, registrationDeadline: competitions.registrationDeadline })
        .from(competitions)
        .where(and(eq(competitions.familyId, familyId), inArray(competitions.status, ANNOUNCEABLE), eq(competitions.contentStatus, 'PUBLISHED')));
      for (const r of rows) {
        if (isAnnounceable(r, today)) await this.alerts.matchCompetition(r.id);
      }
    })().catch((e: unknown) => this.logger.warn(`re-matching family ${familyId} failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}

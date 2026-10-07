import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Confidence, ContentStatus, EditionStatus, Field } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { alertMatches, competitionFacts, competitionFamilies, competitions, positions, sources } from '../../db/schema';
import { effectiveStatus } from '../catalog/catalog.util';
import { iso } from './admin.util';
import { lastReviews, sourceRefCols, toSourceRef, type AdminSourceRef, type LastReview } from './content-loaders';
import { notAnnounceableReason } from './edition-alerts.service';

export interface AdminEditionDTO {
  entity: 'edition';
  id: string; familySlug: string; familyName_ar: string; familyName_fr: string; field: Field;
  year: number; sessionLabel: string | null; status: EditionStatus; effectiveStatus: EditionStatus; contentStatus: ContentStatus;
  registrationOpen: string | null; registrationDeadline: string | null; examDate: string | null;
  positionsCount: number | null; candidatesCount: number | null; positionSlugs: string[]; announcementUrl: string | null;
  source: AdminSourceRef | null; confidence: Confidence; needsVerification: boolean;
  alerts: { sentAt: string | null; matchedUsers: number; notifiedUsers: number; announceable: boolean; blockedBy: string | null };
  lastReview: LastReview | null;
  createdAt: string; updatedAt: string;
}

export interface AdminFactDTO {
  entity: 'fact';
  id: string; familySlug: string; familyName_ar: string; familyName_fr: string; positionSlug: string | null;
  key: string; display_ar: string; display_fr: string; details_ar: string | null; details_fr: string | null; value: unknown;
  source: AdminSourceRef | null; sourcePage: number | null; sourceQuote: string | null;
  confidence: Confidence; needsVerification: boolean; lastVerifiedAt: string | null; status: ContentStatus;
  lastReview: LastReview | null;
}

/** Editions matching `where`, newest first, with family, source and alert reach. */
export async function loadEditions(db: Database, where: SQL | undefined, opts: { limit?: number; offset?: number } = {}): Promise<AdminEditionDTO[]> {
  const rows = await db
    .select({
      c: competitions,
      familySlug: competitionFamilies.slug, familyNameAr: competitionFamilies.nameAr, familyNameFr: competitionFamilies.nameFr, field: competitionFamilies.field,
      src: sourceRefCols,
    })
    .from(competitions)
    .innerJoin(competitionFamilies, eq(competitionFamilies.id, competitions.familyId))
    .leftJoin(sources, eq(sources.id, competitions.sourceId))
    .where(where)
    .orderBy(sql`${competitions.year} desc`, sql`${competitions.registrationDeadline} desc nulls last`, competitions.id)
    .limit(opts.limit ?? 500)
    .offset(opts.offset ?? 0);
  return mapEditions(db, rows);
}

export async function loadEditionsByIds(db: Database, ids: string[]): Promise<AdminEditionDTO[]> {
  if (!ids.length) return [];
  const list = await loadEditions(db, inArray(competitions.id, ids));
  const byId = new Map(list.map((e) => [e.id, e]));
  return ids.map((id) => byId.get(id)).filter((x): x is AdminEditionDTO => !!x);
}

type EditionRow = {
  c: typeof competitions.$inferSelect;
  familySlug: string; familyNameAr: string; familyNameFr: string; field: Field;
  src: Parameters<typeof toSourceRef>[0];
};

async function mapEditions(db: Database, rows: EditionRow[]): Promise<AdminEditionDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.c.id);
  const [reach, reviews] = await Promise.all([
    db
      .select({
        competitionId: alertMatches.competitionId,
        matched: sql<number>`count(distinct ${alertMatches.userId})::int`,
        notified: sql<number>`count(distinct ${alertMatches.userId}) filter (where ${alertMatches.notificationId} is not null)::int`,
      })
      .from(alertMatches)
      .where(inArray(alertMatches.competitionId, ids))
      .groupBy(alertMatches.competitionId),
    lastReviews(db, 'edition', ids),
  ]);
  const reachBy = new Map(reach.map((r) => [r.competitionId, r]));
  const today = tunisToday();
  return rows.map(({ c, src, ...f }) => {
    const r = reachBy.get(c.id);
    const blockedBy = notAnnounceableReason(c, today);
    return {
      entity: 'edition',
      id: c.id, familySlug: f.familySlug, familyName_ar: f.familyNameAr, familyName_fr: f.familyNameFr, field: f.field,
      year: c.year, sessionLabel: c.sessionLabel, status: c.status, effectiveStatus: effectiveStatus(c, today), contentStatus: c.contentStatus,
      registrationOpen: c.registrationOpen, registrationDeadline: c.registrationDeadline, examDate: c.examDate,
      positionsCount: c.positionsCount, candidatesCount: c.candidatesCount, positionSlugs: c.positionSlugs ?? [], announcementUrl: c.announcementUrl,
      source: toSourceRef(src), confidence: c.confidence, needsVerification: c.needsVerification,
      alerts: { sentAt: iso(c.alertsSentAt), matchedUsers: Number(r?.matched ?? 0), notifiedUsers: Number(r?.notified ?? 0), announceable: !blockedBy, blockedBy },
      lastReview: reviews.get(c.id) ?? null,
      createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
    };
  });
}

/** competition_facts matching `where` (family / position / source joined). */
export async function loadFacts(db: Database, where: SQL | undefined, limit = 500): Promise<AdminFactDTO[]> {
  const rows = await db
    .select({
      f: competitionFacts,
      familySlug: competitionFamilies.slug, familyNameAr: competitionFamilies.nameAr, familyNameFr: competitionFamilies.nameFr,
      positionSlug: positions.slug,
      src: sourceRefCols,
    })
    .from(competitionFacts)
    .innerJoin(competitionFamilies, eq(competitionFamilies.id, competitionFacts.familyId))
    .leftJoin(positions, eq(positions.id, competitionFacts.positionId))
    .leftJoin(sources, eq(sources.id, competitionFacts.sourceId))
    .where(where)
    .orderBy(competitionFamilies.slug, competitionFacts.key, competitionFacts.orderIndex, competitionFacts.id)
    .limit(limit);
  const reviews = await lastReviews(db, 'fact', rows.map((r) => r.f.id));
  return rows.map(({ f, src, ...x }) => ({
    entity: 'fact',
    id: f.id, familySlug: x.familySlug, familyName_ar: x.familyNameAr, familyName_fr: x.familyNameFr, positionSlug: x.positionSlug ?? null,
    key: f.key, display_ar: f.displayAr, display_fr: f.displayFr, details_ar: f.detailsAr, details_fr: f.detailsFr, value: f.value,
    source: toSourceRef(src), sourcePage: f.sourcePage, sourceQuote: f.sourceQuote,
    confidence: f.confidence, needsVerification: f.needsVerification, lastVerifiedAt: iso(f.lastVerifiedAt), status: f.status,
    lastReview: reviews.get(f.id) ?? null,
  }));
}

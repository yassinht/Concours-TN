import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { FactDTO } from '@ctn/shared';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import { competitionFacts, competitionFamilies, physicalLogs, positions, sources, userDocumentChecks } from '../../db/schema';
import { UUID_RE } from '../auth/auth.util';

export type ChecklistItem = FactDTO & { checked: boolean };
export interface ChecklistGroup {
  /** null = documents required for every position of the family. */
  positionSlug: string | null;
  positionTitle_ar: string | null;
  positionTitle_fr: string | null;
  items: ChecklistItem[];
}

export interface PhysicalLogDTO {
  id: string;
  testCode: string;
  value: number;
  unit: string;
  notes: string | null;
  loggedAt: string;
}

export interface PhysicalLogBody {
  testCode: string;
  value: number;
  unit: string;
  notes?: string;
  loggedAt?: string;
}

const REQUIRED_DOCUMENT = 'REQUIRED_DOCUMENT';
const isRequiredDocument = or(eq(competitionFacts.key, REQUIRED_DOCUMENT), like(competitionFacts.key, `${REQUIRED_DOCUMENT}:%`));
const TEST_CODE_RE = /^[A-Z0-9_]{2,40}$/;
const MAX_LOGS_PER_USER = 5000;

function badRequest(path: string, message: string) {
  return new BadRequestException({ message: 'VALIDATION_FAILED', issues: [{ path: [path], message }] });
}

function toLogDTO(r: typeof physicalLogs.$inferSelect): PhysicalLogDTO {
  return { id: r.id, testCode: r.testCode, value: r.value, unit: r.unit, notes: r.notes, loggedAt: r.loggedAt.toISOString() };
}

/** Candidate tools: required-documents checklist and physical-test training log. */
@Injectable()
export class CandidateToolsService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────── Documents checklist ─────────────

  async checklist(userId: string, familySlug: string): Promise<ChecklistGroup[]> {
    const [family] = await this.db
      .select({ id: competitionFamilies.id })
      .from(competitionFamilies)
      .where(and(eq(competitionFamilies.slug, familySlug), eq(competitionFamilies.status, 'PUBLISHED')))
      .limit(1);
    if (!family) throw new NotFoundException('NOT_FOUND');

    const rows = await this.db
      .select({
        fact: competitionFacts,
        positionSlug: positions.slug,
        positionTitleAr: positions.titleAr,
        positionTitleFr: positions.titleFr,
        positionOrder: positions.orderIndex,
        source: { id: sources.id, title: sources.title, url: sources.url, sourceType: sources.sourceType, publicationDate: sources.publicationDate },
      })
      .from(competitionFacts)
      .leftJoin(positions, eq(positions.id, competitionFacts.positionId))
      .leftJoin(sources, eq(sources.id, competitionFacts.sourceId))
      .where(
        and(
          eq(competitionFacts.familyId, family.id),
          isRequiredDocument,
          eq(competitionFacts.status, 'PUBLISHED'),
          or(isNull(competitionFacts.positionId), eq(positions.status, 'PUBLISHED')),
        ),
      )
      .orderBy(sql`${positions.orderIndex} asc nulls first`, asc(positions.slug), asc(competitionFacts.orderIndex), asc(competitionFacts.displayFr));

    const factIds = rows.map((r) => r.fact.id);
    const checked = new Set(
      factIds.length
        ? (
            await this.db
              .select({ factId: userDocumentChecks.factId })
              .from(userDocumentChecks)
              .where(and(eq(userDocumentChecks.userId, userId), inArray(userDocumentChecks.factId, factIds)))
          ).map((c) => c.factId)
        : [],
    );

    const groups = new Map<string, ChecklistGroup>();
    for (const r of rows) {
      const key = r.positionSlug ?? '';
      let g = groups.get(key);
      if (!g) {
        g = { positionSlug: r.positionSlug, positionTitle_ar: r.positionTitleAr, positionTitle_fr: r.positionTitleFr, items: [] };
        groups.set(key, g);
      }
      const f = r.fact;
      g.items.push({
        id: f.id,
        key: f.key,
        display_ar: f.displayAr,
        display_fr: f.displayFr,
        details_ar: f.detailsAr,
        details_fr: f.detailsFr,
        source: r.source ?? null,
        confidence: f.confidence,
        needsVerification: f.needsVerification,
        sourceQuote: f.sourceQuote,
        lastVerifiedAt: f.lastVerifiedAt ? f.lastVerifiedAt.toISOString() : null,
        checked: checked.has(f.id),
      });
    }
    return [...groups.values()];
  }

  async setChecked(userId: string, factId: string, isChecked: boolean): Promise<{ ok: true }> {
    if (!UUID_RE.test(factId)) throw new NotFoundException('NOT_FOUND');
    const [fact] = await this.db
      .select({ id: competitionFacts.id })
      .from(competitionFacts)
      .where(and(eq(competitionFacts.id, factId), isRequiredDocument))
      .limit(1);
    if (!fact) throw new NotFoundException('NOT_FOUND');
    if (isChecked) {
      await this.db.insert(userDocumentChecks).values({ userId, factId }).onConflictDoNothing();
    } else {
      await this.db.delete(userDocumentChecks).where(and(eq(userDocumentChecks.userId, userId), eq(userDocumentChecks.factId, factId)));
    }
    return { ok: true };
  }

  // ───────────── Physical training log ─────────────

  async listLogs(userId: string, testCode?: string, limit = 200): Promise<PhysicalLogDTO[]> {
    const code = testCode?.trim().toUpperCase();
    const rows = await this.db
      .select()
      .from(physicalLogs)
      .where(and(eq(physicalLogs.userId, userId), code ? eq(physicalLogs.testCode, code) : undefined))
      .orderBy(desc(physicalLogs.loggedAt))
      .limit(Math.min(Math.max(1, limit), 1000));
    return rows.map(toLogDTO);
  }

  async addLog(userId: string, body: PhysicalLogBody): Promise<PhysicalLogDTO> {
    const testCode = body.testCode.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!TEST_CODE_RE.test(testCode)) throw badRequest('testCode', 'use letters, digits and _ (e.g. RUN_1000M)');
    if (!Number.isFinite(body.value) || Math.abs(body.value) > 1_000_000) throw badRequest('value', 'out of range');
    const unit = body.unit.trim();
    if (!unit) throw badRequest('unit', 'required');

    let loggedAt = new Date();
    if (body.loggedAt) {
      loggedAt = new Date(body.loggedAt);
      if (Number.isNaN(loggedAt.getTime())) throw badRequest('loggedAt', 'invalid date');
      if (loggedAt.getTime() > Date.now() + 86_400_000) throw badRequest('loggedAt', 'in the future');
      if (loggedAt.getUTCFullYear() < 2000) throw badRequest('loggedAt', 'too old');
    }

    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(physicalLogs).where(eq(physicalLogs.userId, userId));
    if (n >= MAX_LOGS_PER_USER) throw new BadRequestException('LIMIT_REACHED');

    const [row] = await this.db
      .insert(physicalLogs)
      .values({ userId, testCode, value: body.value, unit, notes: body.notes?.trim() || null, loggedAt })
      .returning();
    return toLogDTO(row);
  }

  async deleteLog(userId: string, id: string): Promise<{ ok: true }> {
    if (!UUID_RE.test(id)) throw new NotFoundException('NOT_FOUND');
    const deleted = await this.db
      .delete(physicalLogs)
      .where(and(eq(physicalLogs.id, id), eq(physicalLogs.userId, userId)))
      .returning({ id: physicalLogs.id });
    if (!deleted.length) throw new NotFoundException('NOT_FOUND');
    return { ok: true };
  }
}

import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { FactVerifyInput, SourceUpsertInput, type Confidence, type ContentStatus } from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  blueprints, competitionFacts, competitionFamilies, competitions, examSubjects, phases, positions, questions, sources, syllabusNodes,
} from '../../db/schema';
import { CatalogService } from '../catalog/catalog.service';
import {
  assertUuid, badRequest, conflict, diffFields, isoDate, likeAny, notFound, paging, type BlueprintCreateInput, type BlueprintPatchInput,
  type BlueprintsQuery, type FactKind, type FactsQuery, type SourcesQuery,
} from './admin.util';
import { sourceRefCols, toSourceRef, type AdminSourceRef } from './content-loaders';
import { EditionAlertsService, type EditionAlertOutcome } from './edition-alerts.service';
import { assertCatalogTransition, catalogPath, hops } from './review.workflow';

export type FactVerifyBody = z.infer<typeof FactVerifyInput>;
export type SourceBody = z.infer<typeof SourceUpsertInput>;
export const SourcePatch = SourceUpsertInput.partial();
export type SourcePatch = z.infer<typeof SourcePatch>;

/** One sourced claim to verify, whatever table it lives in. */
export interface FactItem {
  kind: FactKind;
  id: string;
  familySlug: string; familyName_ar: string; familyName_fr: string;
  positionSlug: string | null; positionTitle_ar: string | null; positionTitle_fr: string | null;
  label_ar: string; label_fr: string;
  value: unknown;
  source: AdminSourceRef | null; sourceQuote: string | null; sourcePage: number | null;
  confidence: Confidence; needsVerification: boolean; lastVerifiedAt: string | null; status: ContentStatus | null;
}

const KIND_ORDER: Record<FactKind, number> = { edition: 0, eligibility: 1, phase: 2, subject: 3, fact: 4 };
const famCols = { familySlug: competitionFamilies.slug, familyNameAr: competitionFamilies.nameAr, familyNameFr: competitionFamilies.nameFr };

/** Verification of concours facts against sources, the sources themselves, and mock-exam blueprints. */
@Injectable()
export class AdminFactsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly editionAlerts: EditionAlertsService,
  ) {}

  // ───────────── Facts to verify (all kinds) ─────────────

  async facts(q: FactsQuery): Promise<{ items: FactItem[]; total: number; counts: Record<FactKind, number> }> {
    const nv = q.needsVerification === 'all' ? undefined : q.needsVerification === 'true';
    const limit = q.limit ?? 300;
    const kinds: FactKind[] = q.kind ? [q.kind] : ['edition', 'eligibility', 'phase', 'subject', 'fact'];
    const results = await Promise.all(kinds.map((k) => this.factsOfKind(k, nv, q.familySlug, limit)));
    const counts = { fact: 0, phase: 0, subject: 0, eligibility: 0, edition: 0 } as Record<FactKind, number>;
    kinds.forEach((k, i) => (counts[k] = results[i].total));
    const items = results
      .flatMap((r) => r.items)
      .sort((a, b) => a.familySlug.localeCompare(b.familySlug) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.positionSlug ?? '').localeCompare(b.positionSlug ?? ''))
      .slice(0, limit);
    return { items, total: Object.values(counts).reduce((s, n) => s + n, 0), counts };
  }

  async fact(kind: FactKind, id: string): Promise<FactItem> {
    assertUuid(id);
    const { items } = await this.factsOfKind(kind, undefined, undefined, 1, id);
    if (!items[0]) throw notFound();
    return items[0];
  }

  private familyFilter(col: SQL | typeof positions.familyId | typeof competitions.familyId | typeof competitionFacts.familyId, slug?: string): SQL | undefined {
    return slug ? sql`${col} in (select id from ${competitionFamilies} where ${competitionFamilies.slug} = ${slug})` : undefined;
  }

  private async factsOfKind(kind: FactKind, nv: boolean | undefined, familySlug: string | undefined, limit: number, id?: string): Promise<{ items: FactItem[]; total: number }> {
    const countOf = async (table: typeof positions | typeof phases | typeof examSubjects | typeof competitionFacts | typeof competitions, where: SQL | undefined, join?: 'position') => {
      const base = this.db.select({ n: sql<number>`count(*)::int` }).from(table);
      const [r] = join ? await base.innerJoin(positions, eq(positions.id, (table as typeof phases).positionId)).where(where) : await base.where(where);
      return Number(r?.n ?? 0);
    };

    switch (kind) {
      case 'eligibility': {
        const where = and(
          id ? eq(positions.id, id) : ne(positions.status, 'ARCHIVED'),
          nv !== undefined ? eq(positions.eligibilityNeedsVerification, nv) : undefined,
          this.familyFilter(positions.familyId, familySlug),
        );
        const [rows, total] = await Promise.all([
          this.db.select({ p: positions, ...famCols, src: sourceRefCols }).from(positions)
            .innerJoin(competitionFamilies, eq(competitionFamilies.id, positions.familyId))
            .leftJoin(sources, eq(sources.id, positions.eligibilitySourceId))
            .where(where).orderBy(asc(competitionFamilies.slug), asc(positions.orderIndex)).limit(limit),
          countOf(positions, where),
        ]);
        return {
          total,
          items: rows.map((r) => ({
            kind, id: r.p.id, familySlug: r.familySlug, familyName_ar: r.familyNameAr, familyName_fr: r.familyNameFr,
            positionSlug: r.p.slug, positionTitle_ar: r.p.titleAr, positionTitle_fr: r.p.titleFr,
            label_ar: `شروط المشاركة: ${r.p.titleAr}`, label_fr: `Conditions de participation : ${r.p.titleFr}`,
            value: { diplomaLevel: r.p.diplomaLevel, rules: r.p.eligibility },
            source: toSourceRef(r.src), sourceQuote: r.p.eligibilityQuote, sourcePage: null,
            confidence: r.p.eligibilityConfidence, needsVerification: r.p.eligibilityNeedsVerification,
            lastVerifiedAt: r.src?.lastVerifiedAt?.toISOString() ?? null, status: r.p.status,
          })),
        };
      }
      case 'phase':
      case 'subject': {
        const t = kind === 'phase' ? phases : examSubjects;
        const where = and(
          id ? eq(t.id, id) : ne(positions.status, 'ARCHIVED'),
          nv !== undefined ? eq(t.needsVerification, nv) : undefined,
          this.familyFilter(positions.familyId, familySlug),
        );
        const [rows, total] = await Promise.all([
          this.db.select({ x: t, pSlug: positions.slug, pAr: positions.titleAr, pFr: positions.titleFr, ...famCols, src: sourceRefCols }).from(t)
            .innerJoin(positions, eq(positions.id, t.positionId))
            .innerJoin(competitionFamilies, eq(competitionFamilies.id, positions.familyId))
            .leftJoin(sources, eq(sources.id, t.sourceId))
            .where(where).orderBy(asc(competitionFamilies.slug), asc(positions.orderIndex), asc(t.id)).limit(limit),
          countOf(t, where, 'position'),
        ]);
        return {
          total,
          items: rows.map((r) => {
            const value = kind === 'phase'
              ? (() => { const x = r.x as typeof phases.$inferSelect; return { order: x.orderIndex, kind: x.kind, isEliminatory: x.isEliminatory, durationMinutes: x.durationMinutes, description_ar: x.descriptionAr, description_fr: x.descriptionFr }; })()
              : (() => { const x = r.x as typeof examSubjects.$inferSelect; return { phaseOrder: x.phaseOrder, domain: x.domain, specialtyKey: x.specialtyKey, coefficient: x.coefficient, durationMinutes: x.durationMinutes, questionCount: x.questionCount }; })();
            return {
              kind, id: r.x.id, familySlug: r.familySlug, familyName_ar: r.familyNameAr, familyName_fr: r.familyNameFr,
              positionSlug: r.pSlug, positionTitle_ar: r.pAr, positionTitle_fr: r.pFr,
              label_ar: r.x.nameAr, label_fr: r.x.nameFr, value,
              source: toSourceRef(r.src), sourceQuote: r.x.sourceQuote, sourcePage: null,
              confidence: r.x.confidence, needsVerification: r.x.needsVerification,
              lastVerifiedAt: r.src?.lastVerifiedAt?.toISOString() ?? null, status: null,
            };
          }),
        };
      }
      case 'fact': {
        const where = and(
          id ? eq(competitionFacts.id, id) : ne(competitionFacts.status, 'ARCHIVED'),
          nv !== undefined ? eq(competitionFacts.needsVerification, nv) : undefined,
          this.familyFilter(competitionFacts.familyId, familySlug),
        );
        const [rows, total] = await Promise.all([
          this.db.select({ f: competitionFacts, pSlug: positions.slug, pAr: positions.titleAr, pFr: positions.titleFr, ...famCols, src: sourceRefCols })
            .from(competitionFacts)
            .innerJoin(competitionFamilies, eq(competitionFamilies.id, competitionFacts.familyId))
            .leftJoin(positions, eq(positions.id, competitionFacts.positionId))
            .leftJoin(sources, eq(sources.id, competitionFacts.sourceId))
            .where(where).orderBy(asc(competitionFamilies.slug), asc(competitionFacts.key), asc(competitionFacts.orderIndex)).limit(limit),
          countOf(competitionFacts, where),
        ]);
        return {
          total,
          items: rows.map((r) => ({
            kind, id: r.f.id, familySlug: r.familySlug, familyName_ar: r.familyNameAr, familyName_fr: r.familyNameFr,
            positionSlug: r.pSlug ?? null, positionTitle_ar: r.pAr ?? null, positionTitle_fr: r.pFr ?? null,
            label_ar: r.f.displayAr, label_fr: r.f.displayFr,
            value: { key: r.f.key, details_ar: r.f.detailsAr, details_fr: r.f.detailsFr, value: r.f.value },
            source: toSourceRef(r.src), sourceQuote: r.f.sourceQuote, sourcePage: r.f.sourcePage,
            confidence: r.f.confidence, needsVerification: r.f.needsVerification, lastVerifiedAt: r.f.lastVerifiedAt?.toISOString() ?? null, status: r.f.status,
          })),
        };
      }
      case 'edition': {
        const where = and(
          id ? eq(competitions.id, id) : ne(competitions.contentStatus, 'ARCHIVED'),
          nv !== undefined ? eq(competitions.needsVerification, nv) : undefined,
          this.familyFilter(competitions.familyId, familySlug),
        );
        const [rows, total] = await Promise.all([
          this.db.select({ c: competitions, ...famCols, src: sourceRefCols }).from(competitions)
            .innerJoin(competitionFamilies, eq(competitionFamilies.id, competitions.familyId))
            .leftJoin(sources, eq(sources.id, competitions.sourceId))
            .where(where).orderBy(asc(competitionFamilies.slug), desc(competitions.year)).limit(limit),
          countOf(competitions, where),
        ]);
        return {
          total,
          items: rows.map((r) => ({
            kind, id: r.c.id, familySlug: r.familySlug, familyName_ar: r.familyNameAr, familyName_fr: r.familyNameFr,
            positionSlug: null, positionTitle_ar: null, positionTitle_fr: null,
            label_ar: `دورة ${r.c.year}${r.c.sessionLabel ? ` — ${r.c.sessionLabel}` : ''}`, label_fr: `Session ${r.c.year}${r.c.sessionLabel ? ` — ${r.c.sessionLabel}` : ''}`,
            value: {
              year: r.c.year, sessionLabel: r.c.sessionLabel, status: r.c.status, registrationOpen: r.c.registrationOpen,
              registrationDeadline: r.c.registrationDeadline, examDate: r.c.examDate, positionsCount: r.c.positionsCount, announcementUrl: r.c.announcementUrl,
            },
            source: toSourceRef(r.src), sourceQuote: null, sourcePage: null,
            confidence: r.c.confidence, needsVerification: r.c.needsVerification, lastVerifiedAt: r.src?.lastVerifiedAt?.toISOString() ?? null, status: r.c.contentStatus,
          })),
        };
      }
    }
  }

  /**
   * PATCH /admin/facts/:kind/:id — records the verification of one claim. Marking it verified requires a source (the claim
   * is then shown as sourced instead of "À vérifier / للتحقق"); the source's last_verified_at is refreshed.
   */
  async verify(kind: FactKind, id: string, input: FactVerifyBody, actorId: string): Promise<FactItem & { ignored: string[]; notifications?: EditionAlertOutcome }> {
    assertUuid(id);
    const current = await this.fact(kind, id);
    const sourceId = input.sourceId !== undefined ? input.sourceId : current.source?.id ?? null;
    if (input.sourceId) {
      const [src] = await this.db.select({ id: sources.id }).from(sources).where(eq(sources.id, input.sourceId)).limit(1);
      if (!src) throw badRequest('UNKNOWN_SOURCE');
    }
    if (!input.needsVerification && !sourceId) throw badRequest('SOURCE_REQUIRED');

    const ignored: string[] = [];
    const quote = input.sourceQuote !== undefined ? input.sourceQuote?.trim() || null : undefined;
    const now = new Date();
    const verifiedNow = !input.needsVerification;
    let familyIdForRematch: string | null = null;
    const editionBefore = kind === 'edition' ? await this.editionAlerts.snapshot(id) : null;

    switch (kind) {
      case 'eligibility': {
        if (input.sourcePage !== undefined) ignored.push('sourcePage');
        const [row] = await this.db.update(positions).set({
          eligibilityNeedsVerification: input.needsVerification,
          ...(input.confidence ? { eligibilityConfidence: input.confidence } : {}),
          ...(input.sourceId !== undefined ? { eligibilitySourceId: input.sourceId } : {}),
          ...(quote !== undefined ? { eligibilityQuote: quote } : {}),
        }).where(eq(positions.id, id)).returning({ familyId: positions.familyId });
        familyIdForRematch = row?.familyId ?? null;
        break;
      }
      case 'phase':
      case 'subject': {
        if (input.sourcePage !== undefined) ignored.push('sourcePage');
        const t = kind === 'phase' ? phases : examSubjects;
        await this.db.update(t).set({
          needsVerification: input.needsVerification,
          ...(input.confidence ? { confidence: input.confidence } : {}),
          ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
          ...(quote !== undefined ? { sourceQuote: quote } : {}),
        }).where(eq(t.id, id));
        break;
      }
      case 'fact':
        await this.db.update(competitionFacts).set({
          needsVerification: input.needsVerification,
          ...(verifiedNow ? { lastVerifiedAt: now } : {}),
          ...(input.confidence ? { confidence: input.confidence } : {}),
          ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
          ...(quote !== undefined ? { sourceQuote: quote } : {}),
          ...(input.sourcePage !== undefined ? { sourcePage: input.sourcePage } : {}),
        }).where(eq(competitionFacts.id, id));
        break;
      case 'edition':
        if (input.sourceQuote !== undefined) ignored.push('sourceQuote');
        if (input.sourcePage !== undefined) ignored.push('sourcePage');
        await this.db.update(competitions).set({
          needsVerification: input.needsVerification,
          updatedAt: now,
          ...(input.confidence ? { confidence: input.confidence } : {}),
          ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
        }).where(eq(competitions.id, id));
        break;
    }

    if (verifiedNow && sourceId) await this.db.update(sources).set({ lastVerifiedAt: now }).where(eq(sources.id, sourceId));
    if (current.needsVerification !== input.needsVerification) {
      await this.audit.review(kind, id, current.needsVerification ? 'UNVERIFIED' : 'VERIFIED', input.needsVerification ? 'UNVERIFIED' : 'VERIFIED', actorId);
    }
    await this.audit.log(actorId, 'fact.verify', kind, id, {
      needsVerification: { from: current.needsVerification, to: input.needsVerification },
      ...(input.confidence ? { confidence: { from: current.confidence, to: input.confidence } } : {}),
      ...(input.sourceId !== undefined ? { sourceId: { from: current.source?.id ?? null, to: input.sourceId } } : {}),
      ...(quote !== undefined ? { sourceQuote: 'changed' } : {}),
    });
    this.catalog.invalidate();

    let notifications: EditionAlertOutcome | undefined;
    if (kind === 'edition' && editionBefore) {
      const after = await this.editionAlerts.snapshot(id);
      if (after) notifications = await this.editionAlerts.afterChange(editionBefore, after, { notifyUpdates: true });
    }
    if (familyIdForRematch && current.needsVerification !== input.needsVerification) this.editionAlerts.rematchFamily(familyIdForRematch);
    return { ...(await this.fact(kind, id)), ignored, ...(notifications ? { notifications } : {}) };
  }

  // ───────────── Sources ─────────────

  async sources(q: SourcesQuery) {
    const { page, pageSize, offset } = paging(q.page, q.pageSize, 50, 200);
    const pattern = likeAny(q.q);
    const where = and(
      q.sourceType ? eq(sources.sourceType, q.sourceType) : undefined,
      pattern ? or(ilike(sources.title, pattern), ilike(sources.url, pattern), ilike(sources.publisher, pattern)) : undefined,
    );
    const usage = sql<number>`(
      (select count(*) from ${competitions} where ${competitions.sourceId} = ${sources.id})
      + (select count(*) from ${positions} where ${positions.eligibilitySourceId} = ${sources.id})
      + (select count(*) from ${phases} where ${phases.sourceId} = ${sources.id})
      + (select count(*) from ${examSubjects} where ${examSubjects.sourceId} = ${sources.id})
      + (select count(*) from ${competitionFacts} where ${competitionFacts.sourceId} = ${sources.id})
      + (select count(*) from ${questions} where ${questions.sourceId} = ${sources.id})
      + (select count(*) from ${syllabusNodes} where ${syllabusNodes.sourceId} = ${sources.id})
    )::int`;
    const [rows, [{ total }]] = await Promise.all([
      this.db.select({ s: sources, usage }).from(sources).where(where).orderBy(desc(sources.createdAt), asc(sources.id)).limit(pageSize).offset(offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(sources).where(where),
    ]);
    return { items: rows.map((r) => ({ ...this.sourceDto(r.s), usage: Number(r.usage) })), total: Number(total), page, pageSize };
  }

  async createSource(input: SourceBody, actorId: string) {
    this.checkSourceDates(input);
    const url = input.url?.trim() || null;
    if (url) {
      const [dupe] = await this.db.select({ id: sources.id }).from(sources).where(eq(sources.url, url)).limit(1);
      if (dupe) throw conflict('SOURCE_EXISTS', { id: dupe.id });
    }
    const [row] = await this.db
      .insert(sources)
      .values({
        title: input.title.trim(), url, publisher: input.publisher?.trim() || null, sourceType: input.sourceType,
        publicationDate: input.publicationDate ?? null, confidence: input.confidence, notes: input.notes ?? null, retrievedAt: new Date(),
      })
      .returning();
    await this.audit.log(actorId, 'source.create', 'source', row.id, { title: row.title, url, sourceType: row.sourceType });
    return this.sourceDto(row);
  }

  async updateSource(id: string, input: SourcePatch, actorId: string) {
    assertUuid(id);
    this.checkSourceDates(input);
    const [cur] = await this.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!cur) throw notFound();
    const url = input.url !== undefined ? input.url?.trim() || null : undefined;
    if (url && url !== cur.url) {
      const [dupe] = await this.db.select({ id: sources.id }).from(sources).where(and(eq(sources.url, url), ne(sources.id, id))).limit(1);
      if (dupe) throw conflict('SOURCE_EXISTS', { id: dupe.id });
    }
    const set = {
      title: input.title?.trim(), url, publisher: input.publisher !== undefined ? input.publisher?.trim() || null : undefined,
      sourceType: input.sourceType, publicationDate: input.publicationDate, confidence: input.confidence, notes: input.notes,
    };
    const diff = diffFields(cur as unknown as Record<string, unknown>, set);
    if (!Object.keys(diff).length) return this.sourceDto(cur);
    const [row] = await this.db.update(sources).set(set).where(eq(sources.id, id)).returning();
    await this.audit.log(actorId, 'source.update', 'source', id, diff);
    this.catalog.invalidate();
    return this.sourceDto(row);
  }

  /** The editor re-checked the source (page still online, text unchanged). */
  async verifySource(id: string, actorId: string) {
    assertUuid(id);
    const [row] = await this.db.update(sources).set({ lastVerifiedAt: new Date() }).where(eq(sources.id, id)).returning();
    if (!row) throw notFound();
    await this.audit.log(actorId, 'source.verify', 'source', id);
    this.catalog.invalidate();
    return this.sourceDto(row);
  }

  private checkSourceDates(input: { publicationDate?: string | null }) {
    if (input.publicationDate && !isoDate.safeParse(input.publicationDate).success) {
      throw badRequest('VALIDATION_FAILED', { issues: [{ path: ['publicationDate'], message: 'YYYY-MM-DD' }] });
    }
  }

  private sourceDto(s: typeof sources.$inferSelect) {
    return {
      id: s.id, title: s.title, url: s.url, publisher: s.publisher, sourceType: s.sourceType, publicationDate: s.publicationDate,
      confidence: s.confidence, notes: s.notes, retrievedAt: s.retrievedAt?.toISOString() ?? null, lastVerifiedAt: s.lastVerifiedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    };
  }

  // ───────────── Blueprints ─────────────

  async blueprints(q: BlueprintsQuery) {
    const rows = await this.db
      .select({ b: blueprints, positionSlug: positions.slug, positionTitleAr: positions.titleAr, positionTitleFr: positions.titleFr, familySlug: competitionFamilies.slug })
      .from(blueprints)
      .innerJoin(positions, eq(positions.id, blueprints.positionId))
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, positions.familyId))
      .where(and(
        q.familySlug ? eq(competitionFamilies.slug, q.familySlug) : undefined,
        q.positionSlug ? eq(positions.slug, q.positionSlug) : undefined,
      ))
      .orderBy(asc(competitionFamilies.slug), asc(positions.orderIndex), asc(blueprints.title));
    return rows.map((r) => this.blueprintDto(r.b, r));
  }

  async blueprint(id: string) {
    assertUuid(id);
    const [r] = await this.db
      .select({ b: blueprints, positionSlug: positions.slug, positionTitleAr: positions.titleAr, positionTitleFr: positions.titleFr, familySlug: competitionFamilies.slug })
      .from(blueprints)
      .innerJoin(positions, eq(positions.id, blueprints.positionId))
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, positions.familyId))
      .where(eq(blueprints.id, id))
      .limit(1);
    if (!r) throw notFound();
    return this.blueprintDto(r.b, r);
  }

  async createBlueprint(input: BlueprintCreateInput, actorId: string, opts: { replace?: boolean } = {}) {
    const positionId = await this.resolvePosition(input);
    validateSections(input.sections, input.totalMinutes);
    const status = input.status ?? 'PUBLISHED';
    const visible: ContentStatus[] = ['AI_REVIEWED', 'HUMAN_REVIEWED', 'PUBLISHED'];
    const existing = visible.includes(status)
      ? await this.db.select({ id: blueprints.id, status: blueprints.status }).from(blueprints).where(and(eq(blueprints.positionId, positionId), inArray(blueprints.status, visible)))
      : [];
    // Mocks use the position's single visible blueprint: a second one would make the simulated exam ambiguous.
    if (existing.length && !opts.replace) throw conflict('BLUEPRINT_EXISTS', { id: existing[0].id });

    const [row] = await this.db
      .insert(blueprints)
      .values({ positionId, title: input.title.trim(), totalMinutes: input.totalMinutes, fidelity: input.fidelity, sections: normalizeSections(input.sections), status })
      .returning({ id: blueprints.id });
    for (const old of existing) {
      await this.db.update(blueprints).set({ status: 'ARCHIVED' }).where(eq(blueprints.id, old.id));
      await this.audit.review('blueprint', old.id, old.status, 'ARCHIVED', actorId, `replaced by ${row.id}`);
    }
    await this.audit.review('blueprint', row.id, null, status, actorId, 'created');
    await this.audit.log(actorId, 'blueprint.create', 'blueprint', row.id, { positionId, totalMinutes: input.totalMinutes, sections: input.sections.length, replaced: existing.map((e) => e.id) });
    this.catalog.invalidate();
    return this.blueprint(row.id);
  }

  async updateBlueprint(id: string, input: BlueprintPatchInput, actorId: string) {
    assertUuid(id);
    const [cur] = await this.db.select().from(blueprints).where(eq(blueprints.id, id)).limit(1);
    if (!cur) throw notFound();
    if (input.status) assertCatalogTransition(cur.status, input.status);
    const sections: Section[] = input.sections ?? (cur.sections as Section[]);
    const totalMinutes = input.totalMinutes ?? cur.totalMinutes;
    if (input.sections || input.totalMinutes) validateSections(sections, totalMinutes);
    const set = {
      title: input.title?.trim(), totalMinutes: input.totalMinutes, fidelity: input.fidelity,
      sections: input.sections ? normalizeSections(input.sections) : undefined, status: input.status,
    };
    const diff = diffFields(cur as unknown as Record<string, unknown>, set);
    if (!Object.keys(diff).length) return this.blueprint(id);
    await this.db.update(blueprints).set(set).where(eq(blueprints.id, id));
    if (input.status && input.status !== cur.status) {
      for (const [f, t] of hops(cur.status, catalogPath(cur.status, input.status))) await this.audit.review('blueprint', id, f, t, actorId);
    }
    await this.audit.log(actorId, 'blueprint.update', 'blueprint', id, diff);
    this.catalog.invalidate();
    return this.blueprint(id);
  }

  private async resolvePosition(input: BlueprintCreateInput): Promise<string> {
    if (input.positionId) {
      const [p] = await this.db.select({ id: positions.id }).from(positions).where(eq(positions.id, input.positionId)).limit(1);
      if (!p) throw badRequest('UNKNOWN_POSITION');
      return p.id;
    }
    const [p] = await this.db
      .select({ id: positions.id })
      .from(positions)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, positions.familyId))
      .where(and(eq(competitionFamilies.slug, input.familySlug!), eq(positions.slug, input.positionSlug!)))
      .limit(1);
    if (!p) throw badRequest('UNKNOWN_POSITION');
    return p.id;
  }

  private blueprintDto(b: typeof blueprints.$inferSelect, r: { positionSlug: string; positionTitleAr: string; positionTitleFr: string; familySlug: string }) {
    const sections = (b.sections ?? []) as { domain: string; specialtyKey: string | null; count: number; minutes: number }[];
    return {
      id: b.id, title: b.title, totalMinutes: b.totalMinutes, fidelity: b.fidelity, status: b.status, sections,
      questionCount: sections.reduce((s, x) => s + (x.count ?? 0), 0),
      familySlug: r.familySlug, positionId: b.positionId, positionSlug: r.positionSlug, positionTitle_ar: r.positionTitleAr, positionTitle_fr: r.positionTitleFr,
    };
  }
}

type Section = { domain: string; specialtyKey?: string | null; count: number; minutes: number };

/** A blueprint must describe a sittable exam: sections fit in the total time, no domain listed twice, a sane size. */
export function validateSections(sections: Section[], totalMinutes: number): void {
  const issues: { path: string[]; message: string }[] = [];
  const seen = new Set<string>();
  sections.forEach((s, i) => {
    const key = `${s.domain}|${s.specialtyKey ?? ''}`;
    if (seen.has(key)) issues.push({ path: ['sections', String(i)], message: 'duplicate domain/specialtyKey' });
    seen.add(key);
    if (s.domain === 'SPECIALTY' && !s.specialtyKey) issues.push({ path: ['sections', String(i), 'specialtyKey'], message: 'required for SPECIALTY' });
  });
  const minutes = sections.reduce((t, s) => t + s.minutes, 0);
  if (minutes > totalMinutes) issues.push({ path: ['sections'], message: `sections last ${minutes} min > totalMinutes ${totalMinutes}` });
  const count = sections.reduce((t, s) => t + s.count, 0);
  if (count > 300) issues.push({ path: ['sections'], message: 'at most 300 questions' });
  if (issues.length) throw badRequest('INVALID_BLUEPRINT', { issues });
}

function normalizeSections(sections: Section[]) {
  return sections.map((s) => ({ domain: s.domain, specialtyKey: s.specialtyKey?.trim() || null, count: s.count, minutes: s.minutes }));
}

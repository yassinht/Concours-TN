import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EditionUpsertInput, type ContentStatus, type EligibilityRules } from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  blueprints, competitionFacts, competitionFamilies, competitions, enrollments, examSubjects, follows, organizations, pastExams, phases,
  positions, questionFamilies, sources,
} from '../../db/schema';
import { CatalogService } from '../catalog/catalog.service';
import {
  assertUuid, badRequest, conflict, diffFields, isoDate, notFound, paging, slugSchema, type EditionsQuery, type FamilyCreateInput,
  type FamilyPatchInput, type PositionCreateInput, type PositionPatchInput,
} from './admin.util';
import { loadEditions, loadEditionsByIds, loadFacts, type AdminEditionDTO } from './catalog-loaders';
import { sourceRefCols, toSourceRef } from './content-loaders';
import { EditionAlertsService, notAnnounceableReason, type EditionAlertOutcome } from './edition-alerts.service';
import { assertCatalogTransition, catalogPath, hops } from './review.workflow';

export type EditionInput = z.infer<typeof EditionUpsertInput>;
export const EditionPatch = EditionUpsertInput.partial();
export type EditionPatch = z.infer<typeof EditionPatch>;

export interface FamilyListItem {
  slug: string; field: string; name_ar: string; name_fr: string; status: ContentStatus; popularity: number; frequency: string;
  organization: { slug: string; name_ar: string; name_fr: string };
  counts: { positions: number; editions: number; openEditions: number; followers: number; enrolled: number; linkedQuestions: number; factsToVerify: number };
  updatedAt: string;
}

/** Concours structure (families, positions & eligibility, editions). Every change is audited; edition changes drive alerts. */
@Injectable()
export class AdminCatalogService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly editionAlerts: EditionAlertsService,
  ) {}

  // ───────────── Families ─────────────

  async families(): Promise<FamilyListItem[]> {
    const f = competitionFamilies;
    const rows = await this.db
      .select({
        f,
        orgSlug: organizations.slug, orgNameAr: organizations.nameAr, orgNameFr: organizations.nameFr,
        positions: sql<number>`(select count(*)::int from ${positions} where ${positions.familyId} = ${f.id} and ${positions.status} <> 'ARCHIVED')`,
        editions: sql<number>`(select count(*)::int from ${competitions} where ${competitions.familyId} = ${f.id} and ${competitions.contentStatus} <> 'ARCHIVED')`,
        openEditions: sql<number>`(select count(*)::int from ${competitions} where ${competitions.familyId} = ${f.id} and ${competitions.status} in ('OPEN','ANNOUNCED') and ${competitions.contentStatus} <> 'ARCHIVED')`,
        followers: sql<number>`(select count(*)::int from ${follows} where ${follows.familyId} = ${f.id})`,
        enrolled: sql<number>`(select count(*)::int from ${enrollments} where ${enrollments.familyId} = ${f.id})`,
        linkedQuestions: sql<number>`(select count(*)::int from ${questionFamilies} where ${questionFamilies.familyId} = ${f.id})`,
        factsToVerify: sql<number>`(
          (select count(*) from ${positions} where ${positions.familyId} = ${f.id} and ${positions.eligibilityNeedsVerification} and ${positions.status} <> 'ARCHIVED')
          + (select count(*) from ${phases} join ${positions} on ${positions.id} = ${phases.positionId} where ${positions.familyId} = ${f.id} and ${phases.needsVerification} and ${positions.status} <> 'ARCHIVED')
          + (select count(*) from ${examSubjects} join ${positions} on ${positions.id} = ${examSubjects.positionId} where ${positions.familyId} = ${f.id} and ${examSubjects.needsVerification} and ${positions.status} <> 'ARCHIVED')
          + (select count(*) from ${competitionFacts} where ${competitionFacts.familyId} = ${f.id} and ${competitionFacts.needsVerification} and ${competitionFacts.status} <> 'ARCHIVED')
          + (select count(*) from ${competitions} where ${competitions.familyId} = ${f.id} and ${competitions.needsVerification} and ${competitions.contentStatus} <> 'ARCHIVED')
        )::int`,
      })
      .from(f)
      .innerJoin(organizations, eq(organizations.id, f.organizationId))
      .orderBy(asc(f.field), asc(f.slug));
    return rows.map((r) => ({
      slug: r.f.slug, field: r.f.field, name_ar: r.f.nameAr, name_fr: r.f.nameFr, status: r.f.status, popularity: r.f.popularity, frequency: r.f.frequency,
      organization: { slug: r.orgSlug, name_ar: r.orgNameAr, name_fr: r.orgNameFr },
      counts: {
        positions: Number(r.positions), editions: Number(r.editions), openEditions: Number(r.openEditions), followers: Number(r.followers),
        enrolled: Number(r.enrolled), linkedQuestions: Number(r.linkedQuestions), factsToVerify: Number(r.factsToVerify),
      },
      updatedAt: r.f.updatedAt.toISOString(),
    }));
  }

  /** Everything an editor needs to maintain one family: positions (eligibility, phases, subjects, blueprints), editions, facts, sources. */
  async family(slug: string) {
    const fam = await this.familyBySlug(slug);
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, fam.organizationId)).limit(1);
    const posRows = await this.db
      .select({ p: positions, src: sourceRefCols })
      .from(positions)
      .leftJoin(sources, eq(sources.id, positions.eligibilitySourceId))
      .where(eq(positions.familyId, fam.id))
      .orderBy(asc(positions.orderIndex), asc(positions.slug));
    const posIds = posRows.map((r) => r.p.id);
    const [phaseRows, subjectRows, bpRows, editions, facts, past] = await Promise.all([
      posIds.length ? this.db.select({ x: phases, src: sourceRefCols }).from(phases).leftJoin(sources, eq(sources.id, phases.sourceId)).where(inArray(phases.positionId, posIds)).orderBy(asc(phases.orderIndex)) : [],
      posIds.length ? this.db.select({ x: examSubjects, src: sourceRefCols }).from(examSubjects).leftJoin(sources, eq(sources.id, examSubjects.sourceId)).where(inArray(examSubjects.positionId, posIds)).orderBy(asc(examSubjects.phaseOrder), asc(examSubjects.nameFr)) : [],
      posIds.length ? this.db.select().from(blueprints).where(inArray(blueprints.positionId, posIds)).orderBy(asc(blueprints.title)) : [],
      loadEditions(this.db, eq(competitions.familyId, fam.id)),
      loadFacts(this.db, eq(competitionFacts.familyId, fam.id)),
      this.db.select().from(pastExams).where(eq(pastExams.familyId, fam.id)).orderBy(sql`${pastExams.year} desc`),
    ]);
    return {
      slug: fam.slug, field: fam.field, status: fam.status,
      name_ar: fam.nameAr, name_fr: fam.nameFr, description_ar: fam.descriptionAr, description_fr: fam.descriptionFr,
      frequency: fam.frequency, popularity: fam.popularity, keywords: fam.keywords, tips_ar: fam.tipsAr, tips_fr: fam.tipsFr, researchNotes: fam.researchNotes,
      organization: org ? { slug: org.slug, name_ar: org.nameAr, name_fr: org.nameFr, ministry_fr: org.ministryFr, website: org.website } : null,
      positions: posRows.map(({ p, src }) => ({
        id: p.id, slug: p.slug, title_ar: p.titleAr, title_fr: p.titleFr, diplomaLevel: p.diplomaLevel, orderIndex: p.orderIndex, status: p.status,
        eligibility: p.eligibility as EligibilityRules,
        eligibilityProvenance: { source: toSourceRef(src), confidence: p.eligibilityConfidence, needsVerification: p.eligibilityNeedsVerification, sourceQuote: p.eligibilityQuote },
        phases: phaseRows.filter((r) => r.x.positionId === p.id).map(({ x, src: s }) => ({
          id: x.id, order: x.orderIndex, kind: x.kind, name_ar: x.nameAr, name_fr: x.nameFr, isEliminatory: x.isEliminatory, durationMinutes: x.durationMinutes,
          description_ar: x.descriptionAr, description_fr: x.descriptionFr, source: toSourceRef(s), confidence: x.confidence, needsVerification: x.needsVerification, sourceQuote: x.sourceQuote,
        })),
        subjects: subjectRows.filter((r) => r.x.positionId === p.id).map(({ x, src: s }) => ({
          id: x.id, phaseOrder: x.phaseOrder, domain: x.domain, specialtyKey: x.specialtyKey, name_ar: x.nameAr, name_fr: x.nameFr, coefficient: x.coefficient,
          durationMinutes: x.durationMinutes, questionCount: x.questionCount, source: toSourceRef(s), confidence: x.confidence, needsVerification: x.needsVerification, sourceQuote: x.sourceQuote,
        })),
        blueprints: bpRows.filter((b) => b.positionId === p.id).map((b) => ({ id: b.id, title: b.title, totalMinutes: b.totalMinutes, fidelity: b.fidelity, sections: b.sections, status: b.status })),
      })),
      editions,
      facts,
      pastExams: past.map((x) => ({ id: x.id, year: x.year, title: x.title, url: x.url, sourceType: x.sourceType, isVerified: x.isVerified })),
      updatedAt: fam.updatedAt.toISOString(),
    };
  }

  async createFamily(slug: string, input: FamilyCreateInput, actorId: string) {
    if (!slugSchema.safeParse(slug).success) throw badRequest('INVALID_SLUG');
    const [taken] = await this.db.select({ id: competitionFamilies.id }).from(competitionFamilies).where(eq(competitionFamilies.slug, slug)).limit(1);
    if (taken) throw conflict('SLUG_TAKEN');
    const organizationId = await this.resolveOrganization(input, actorId);
    // A new family stays hidden until an editor publishes it (it has no positions or editions yet).
    const status = input.status ?? 'DRAFT';
    const [row] = await this.db
      .insert(competitionFamilies)
      .values({
        slug, organizationId, field: input.field, nameAr: input.name_ar.trim(), nameFr: input.name_fr.trim(),
        descriptionAr: input.description_ar ?? '', descriptionFr: input.description_fr ?? '', frequency: input.frequency ?? 'UNKNOWN',
        popularity: input.popularity ?? 3, keywords: input.keywords ?? [], tipsAr: input.tips_ar ?? [], tipsFr: input.tips_fr ?? [],
        researchNotes: input.researchNotes ?? null, status,
      })
      .returning();
    await this.audit.review('family', row.id, null, status, actorId, 'created');
    await this.audit.log(actorId, 'family.create', 'family', row.id, { slug, field: input.field, status });
    this.catalog.invalidate();
    return this.family(slug);
  }

  async updateFamily(slug: string, input: FamilyPatchInput, actorId: string) {
    const fam = await this.familyBySlug(slug);
    const organizationId = input.organizationSlug || input.organization ? await this.resolveOrganization(input, actorId) : undefined;
    if (input.status) assertCatalogTransition(fam.status, input.status);
    const set = {
      field: input.field, organizationId, nameAr: input.name_ar?.trim(), nameFr: input.name_fr?.trim(), descriptionAr: input.description_ar,
      descriptionFr: input.description_fr, frequency: input.frequency, popularity: input.popularity, keywords: input.keywords,
      tipsAr: input.tips_ar, tipsFr: input.tips_fr, researchNotes: input.researchNotes, status: input.status,
    };
    const diff = diffFields(fam as unknown as Record<string, unknown>, set);
    if (!Object.keys(diff).length) return this.family(slug);
    await this.db.update(competitionFamilies).set({ ...set, updatedAt: new Date() }).where(eq(competitionFamilies.id, fam.id));
    if (input.status && input.status !== fam.status) {
      for (const [f, t] of hops(fam.status, catalogPath(fam.status, input.status))) await this.audit.review('family', fam.id, f, t, actorId);
    }
    await this.audit.log(actorId, 'family.update', 'family', fam.id, diff);
    this.catalog.invalidate();
    return this.family(slug);
  }

  private async resolveOrganization(input: Pick<FamilyCreateInput, 'organizationSlug' | 'organization'>, actorId: string): Promise<string> {
    const slug = input.organizationSlug ?? input.organization?.slug;
    if (!slug) throw badRequest('ORGANIZATION_REQUIRED');
    const [existing] = await this.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (existing) return existing.id;
    if (!input.organization) throw badRequest('UNKNOWN_ORGANIZATION', { organizationSlug: slug });
    const o = input.organization;
    const [row] = await this.db
      .insert(organizations)
      .values({ slug: o.slug, nameAr: o.name_ar.trim(), nameFr: o.name_fr.trim(), ministryFr: o.ministry_fr ?? null, website: o.website ?? null })
      .returning({ id: organizations.id });
    await this.audit.log(actorId, 'organization.create', 'organization', row.id, { slug: o.slug });
    return row.id;
  }

  private async familyBySlug(slug: string) {
    const [fam] = await this.db.select().from(competitionFamilies).where(eq(competitionFamilies.slug, slug)).limit(1);
    if (!fam) throw notFound();
    return fam;
  }

  // ───────────── Positions ─────────────

  async createPosition(familySlug: string, positionSlug: string, input: PositionCreateInput, actorId: string) {
    if (!slugSchema.safeParse(positionSlug).success) throw badRequest('INVALID_SLUG');
    const fam = await this.familyBySlug(familySlug);
    const [taken] = await this.db.select({ id: positions.id }).from(positions).where(and(eq(positions.familyId, fam.id), eq(positions.slug, positionSlug))).limit(1);
    if (taken) throw conflict('SLUG_TAKEN');
    const needsVerification = input.eligibilityNeedsVerification ?? true;
    await this.assertSource(input.eligibilitySourceId, !needsVerification);
    const status = input.status ?? 'PUBLISHED';
    const [row] = await this.db
      .insert(positions)
      .values({
        familyId: fam.id, slug: positionSlug, titleAr: input.title_ar.trim(), titleFr: input.title_fr.trim(), diplomaLevel: input.diplomaLevel,
        eligibility: cleanRules(input.eligibility ?? {}), eligibilitySourceId: input.eligibilitySourceId ?? null,
        eligibilityConfidence: input.eligibilityConfidence ?? 'LOW', eligibilityNeedsVerification: needsVerification,
        eligibilityQuote: input.eligibilityQuote ?? null, orderIndex: input.orderIndex ?? 0, status,
      })
      .returning();
    await this.audit.review('position', row.id, null, status, actorId, 'created');
    if (!needsVerification) {
      await this.audit.review('eligibility', row.id, 'UNVERIFIED', 'VERIFIED', actorId);
      await this.touchSource(input.eligibilitySourceId);
    }
    await this.audit.log(actorId, 'position.create', 'position', row.id, { familySlug, positionSlug, status });
    this.catalog.invalidate();
    this.editionAlerts.rematchFamily(fam.id);
    return this.position(fam.id, positionSlug);
  }

  async updatePosition(familySlug: string, positionSlug: string, input: PositionPatchInput, actorId: string) {
    const fam = await this.familyBySlug(familySlug);
    const [p] = await this.db.select().from(positions).where(and(eq(positions.familyId, fam.id), eq(positions.slug, positionSlug))).limit(1);
    if (!p) throw notFound();
    if (input.status) assertCatalogTransition(p.status, input.status);
    const sourceId = input.eligibilitySourceId !== undefined ? input.eligibilitySourceId : p.eligibilitySourceId;
    const needsVerification = input.eligibilityNeedsVerification ?? p.eligibilityNeedsVerification;
    if (input.eligibilitySourceId !== undefined || (p.eligibilityNeedsVerification && !needsVerification)) await this.assertSource(sourceId, !needsVerification);

    const set = {
      titleAr: input.title_ar?.trim(), titleFr: input.title_fr?.trim(), diplomaLevel: input.diplomaLevel,
      eligibility: input.eligibility ? cleanRules(input.eligibility) : undefined, eligibilitySourceId: input.eligibilitySourceId,
      eligibilityConfidence: input.eligibilityConfidence, eligibilityNeedsVerification: input.eligibilityNeedsVerification,
      eligibilityQuote: input.eligibilityQuote, orderIndex: input.orderIndex, status: input.status,
    };
    const diff = diffFields(p as unknown as Record<string, unknown>, set);
    if (!Object.keys(diff).length) return this.position(fam.id, positionSlug);
    await this.db.update(positions).set(set).where(eq(positions.id, p.id));

    if (input.status && input.status !== p.status) {
      for (const [f, t] of hops(p.status, catalogPath(p.status, input.status))) await this.audit.review('position', p.id, f, t, actorId);
    }
    if (p.eligibilityNeedsVerification !== needsVerification) {
      await this.audit.review('eligibility', p.id, p.eligibilityNeedsVerification ? 'UNVERIFIED' : 'VERIFIED', needsVerification ? 'UNVERIFIED' : 'VERIFIED', actorId);
      if (!needsVerification) await this.touchSource(sourceId);
    }
    await this.audit.log(actorId, 'position.update', 'position', p.id, diff);
    this.catalog.invalidate();
    // Who is eligible may have changed: refresh matches of the family's open editions (new matches get alerted).
    if (diff.eligibility || diff.eligibilityNeedsVerification || diff.status || diff.diplomaLevel) this.editionAlerts.rematchFamily(fam.id);
    return this.position(fam.id, positionSlug);
  }

  private async position(familyId: string, slug: string) {
    const [r] = await this.db
      .select({ p: positions, src: sourceRefCols })
      .from(positions)
      .leftJoin(sources, eq(sources.id, positions.eligibilitySourceId))
      .where(and(eq(positions.familyId, familyId), eq(positions.slug, slug)))
      .limit(1);
    if (!r) throw notFound();
    const { p, src } = r;
    return {
      id: p.id, slug: p.slug, title_ar: p.titleAr, title_fr: p.titleFr, diplomaLevel: p.diplomaLevel, orderIndex: p.orderIndex, status: p.status,
      eligibility: p.eligibility as EligibilityRules,
      eligibilityProvenance: { source: toSourceRef(src), confidence: p.eligibilityConfidence, needsVerification: p.eligibilityNeedsVerification, sourceQuote: p.eligibilityQuote },
    };
  }

  // ───────────── Editions ─────────────

  async editions(q: EditionsQuery): Promise<{ items: AdminEditionDTO[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize, offset } = paging(q.page, q.pageSize, 50, 200);
    const where = and(
      q.familySlug ? sql`${competitions.familyId} in (select id from ${competitionFamilies} where ${competitionFamilies.slug} = ${q.familySlug})` : undefined,
      q.status ? eq(competitions.status, q.status) : undefined,
      q.year ? eq(competitions.year, q.year) : undefined,
      q.needsVerification !== undefined ? eq(competitions.needsVerification, q.needsVerification) : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      loadEditions(this.db, where, { limit: pageSize, offset }),
      this.db.select({ total: sql<number>`count(*)::int` }).from(competitions).where(where),
    ]);
    return { items, total: Number(total), page, pageSize };
  }

  async edition(id: string): Promise<AdminEditionDTO> {
    assertUuid(id);
    const [e] = await loadEditionsByIds(this.db, [id]);
    if (!e) throw notFound();
    return e;
  }

  async createEdition(input: EditionInput, actorId: string): Promise<AdminEditionDTO & { notifications: EditionAlertOutcome }> {
    const fam = await this.familyBySlug(input.familySlug);
    await this.validateEdition(fam.id, input, null);
    // Entered by a human editor: published right away (flagged "to verify" until checked against its source).
    const [row] = await this.db
      .insert(competitions)
      .values({
        familyId: fam.id, year: input.year, sessionLabel: input.sessionLabel?.trim() || null, status: input.status,
        registrationOpen: input.registrationOpen ?? null, registrationDeadline: input.registrationDeadline ?? null, examDate: input.examDate ?? null,
        positionsCount: input.positionsCount ?? null, positionSlugs: [...new Set(input.positionSlugs)], announcementUrl: input.announcementUrl ?? null,
        sourceId: input.sourceId ?? null, confidence: input.confidence, needsVerification: input.needsVerification, contentStatus: 'PUBLISHED',
      })
      .returning({ id: competitions.id });
    await this.audit.review('edition', row.id, null, 'PUBLISHED', actorId, 'created by editor');
    if (!input.needsVerification) {
      await this.audit.review('edition', row.id, 'UNVERIFIED', 'VERIFIED', actorId);
      await this.touchSource(input.sourceId);
    }
    await this.audit.log(actorId, 'edition.create', 'edition', row.id, { familySlug: input.familySlug, year: input.year, status: input.status });
    this.catalog.invalidate();

    const after = await this.editionAlerts.snapshot(row.id);
    const notifications = after ? await this.editionAlerts.afterChange(null, after) : { alerts: null, updateNotified: 0, updateSummary: null };
    if (notifications.alerts) await this.audit.log(actorId, 'edition.alerts', 'edition', row.id, notifications.alerts);
    return { ...(await this.edition(row.id)), notifications };
  }

  async updateEdition(id: string, patch: EditionPatch, actorId: string, opts: { notify?: boolean } = {}): Promise<AdminEditionDTO & { notifications: EditionAlertOutcome; changed: boolean }> {
    assertUuid(id);
    const [cur] = await this.db.select().from(competitions).where(eq(competitions.id, id)).limit(1);
    if (!cur) throw notFound();
    const before = (await this.editionAlerts.snapshot(id))!;
    const fam = patch.familySlug ? await this.familyBySlug(patch.familySlug) : { id: cur.familyId };

    const merged: EditionInput = {
      familySlug: patch.familySlug ?? '', year: patch.year ?? cur.year, sessionLabel: patch.sessionLabel !== undefined ? patch.sessionLabel : cur.sessionLabel,
      status: patch.status ?? cur.status,
      registrationOpen: patch.registrationOpen !== undefined ? patch.registrationOpen : cur.registrationOpen,
      registrationDeadline: patch.registrationDeadline !== undefined ? patch.registrationDeadline : cur.registrationDeadline,
      examDate: patch.examDate !== undefined ? patch.examDate : cur.examDate,
      positionsCount: patch.positionsCount !== undefined ? patch.positionsCount : cur.positionsCount,
      positionSlugs: patch.positionSlugs ?? cur.positionSlugs ?? [],
      announcementUrl: patch.announcementUrl !== undefined ? patch.announcementUrl : cur.announcementUrl,
      sourceId: patch.sourceId !== undefined ? patch.sourceId : cur.sourceId,
      confidence: patch.confidence ?? cur.confidence,
      needsVerification: patch.needsVerification ?? cur.needsVerification,
    };
    await this.validateEdition(fam.id, merged, id, {
      source: patch.sourceId !== undefined || (cur.needsVerification && !merged.needsVerification),
      identity: patch.familySlug !== undefined || patch.year !== undefined || patch.sessionLabel !== undefined,
      positions: patch.positionSlugs !== undefined || patch.familySlug !== undefined,
      dates: patch.registrationOpen !== undefined || patch.registrationDeadline !== undefined || patch.examDate !== undefined,
    });

    const set = {
      familyId: fam.id, year: merged.year, sessionLabel: merged.sessionLabel?.trim() || null, status: merged.status,
      registrationOpen: merged.registrationOpen ?? null, registrationDeadline: merged.registrationDeadline ?? null, examDate: merged.examDate ?? null,
      positionsCount: merged.positionsCount ?? null, positionSlugs: [...new Set(merged.positionSlugs)], announcementUrl: merged.announcementUrl ?? null,
      sourceId: merged.sourceId ?? null, confidence: merged.confidence, needsVerification: merged.needsVerification,
    };
    const diff = diffFields(cur as unknown as Record<string, unknown>, set);
    if (!Object.keys(diff).length) {
      return { ...(await this.edition(id)), notifications: { alerts: null, updateNotified: 0, updateSummary: null }, changed: false };
    }
    await this.db.update(competitions).set({ ...set, updatedAt: new Date() }).where(eq(competitions.id, id));

    if (diff.status) await this.audit.review('edition', id, cur.status, merged.status, actorId);
    if (diff.needsVerification) {
      await this.audit.review('edition', id, cur.needsVerification ? 'UNVERIFIED' : 'VERIFIED', merged.needsVerification ? 'UNVERIFIED' : 'VERIFIED', actorId);
      if (!merged.needsVerification) await this.touchSource(merged.sourceId);
    }
    await this.audit.log(actorId, 'edition.update', 'edition', id, diff);
    this.catalog.invalidate();

    const after = (await this.editionAlerts.snapshot(id))!;
    const notifications = await this.editionAlerts.afterChange(before, after, { notifyUpdates: opts.notify !== false });
    if (notifications.alerts || notifications.updateNotified) await this.audit.log(actorId, 'edition.alerts', 'edition', id, notifications);
    return { ...(await this.edition(id)), notifications, changed: true };
  }

  /** POST /admin/editions/:id/notify — runs profile matching now and returns its counts. */
  async notifyEdition(id: string, actorId: string): Promise<{ matchedUsers: number; notified: number }> {
    assertUuid(id);
    const snap = await this.editionAlerts.snapshot(id);
    if (!snap) throw notFound();
    const reason = notAnnounceableReason(snap);
    if (reason) throw conflict('EDITION_NOT_ANNOUNCEABLE', { reason });
    const counts = await this.editionAlerts.matchNow(id);
    await this.audit.log(actorId, 'edition.notify', 'edition', id, counts);
    return counts;
  }

  /** Free-text update ("concours postponed", "results online") to followers, enrolled and matched users. */
  async editionUpdateNotice(id: string, summary: { ar: string; fr: string }, actorId: string): Promise<{ sent: number }> {
    assertUuid(id);
    const snap = await this.editionAlerts.snapshot(id);
    if (!snap) throw notFound();
    if (snap.contentStatus !== 'PUBLISHED') throw conflict('EDITION_NOT_ANNOUNCEABLE', { reason: 'NOT_PUBLISHED' });
    const sent = await this.editionAlerts.sendUpdate(id, summary);
    await this.audit.log(actorId, 'edition.update_notice', 'edition', id, { ...summary, sent });
    return { sent };
  }

  /**
   * `checks` limits the database checks to what an update actually touches, so editing one field of a legacy row never
   * fails on data nobody changed.
   */
  private async validateEdition(familyId: string, e: EditionInput, exceptId: string | null, checks = { source: true, identity: true, positions: true, dates: true }): Promise<void> {
    const issues: { path: string[]; message: string }[] = [];
    for (const k of ['registrationOpen', 'registrationDeadline', 'examDate'] as const) {
      if (e[k] != null && !isoDate.safeParse(e[k]).success) issues.push({ path: [k], message: 'YYYY-MM-DD' });
    }
    if (issues.length) throw badRequest('VALIDATION_FAILED', { issues });
    if (checks.dates && e.registrationOpen && e.registrationDeadline && e.registrationOpen > e.registrationDeadline) throw badRequest('DATES_ORDER', { field: 'registrationDeadline' });
    if (checks.dates && e.registrationDeadline && e.examDate && e.examDate < e.registrationDeadline) throw badRequest('DATES_ORDER', { field: 'examDate' });

    const slugs = checks.positions ? [...new Set(e.positionSlugs)] : [];
    if (slugs.length) {
      const found = await this.db.select({ slug: positions.slug }).from(positions).where(and(eq(positions.familyId, familyId), inArray(positions.slug, slugs)));
      const unknown = slugs.filter((s) => !found.some((f) => f.slug === s));
      if (unknown.length) throw badRequest('UNKNOWN_POSITION', { positionSlugs: unknown });
    }
    if (checks.source) await this.assertSource(e.sourceId ?? null, !e.needsVerification);
    if (!checks.identity) return;

    const label = e.sessionLabel?.trim() || null;
    const [dupe] = await this.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(and(
        eq(competitions.familyId, familyId), eq(competitions.year, e.year), ne(competitions.contentStatus, 'ARCHIVED'),
        label ? eq(competitions.sessionLabel, label) : sql`${competitions.sessionLabel} is null`,
        exceptId ? ne(competitions.id, exceptId) : undefined,
      ))
      .limit(1);
    if (dupe) throw conflict('EDITION_EXISTS', { id: dupe.id });
  }

  // ───────────── Helpers ─────────────

  /** A referenced source must exist; marking something verified requires one ("verified" = checked against a source). */
  private async assertSource(sourceId: string | null | undefined, requiredForVerification: boolean): Promise<void> {
    if (!sourceId) {
      if (requiredForVerification) throw badRequest('SOURCE_REQUIRED');
      return;
    }
    const [src] = await this.db.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!src) throw badRequest('UNKNOWN_SOURCE');
  }

  private async touchSource(sourceId: string | null | undefined): Promise<void> {
    if (sourceId) await this.db.update(sources).set({ lastVerifiedAt: new Date() }).where(eq(sources.id, sourceId));
  }
}

/** Drops empty values so the stored rules only carry real constraints (an empty list would read as "nobody qualifies"). */
export function cleanRules(r: Partial<EligibilityRules>): EligibilityRules {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (k === 'needs_verification') continue; // the column is the source of truth
    out[k] = Array.isArray(v) ? [...new Set(v.map((x) => (typeof x === 'string' ? x.trim() : x)))] : v;
  }
  return out as EligibilityRules;
}


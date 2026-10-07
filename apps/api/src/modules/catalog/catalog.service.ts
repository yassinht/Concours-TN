import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  DOMAINS, checkEligibility, type BlueprintDTO, type CandidateProfile, type EditionDTO, type EditionStatus, type EligibilityResult, type EligibilityRules,
  type FactDTO, type FamilyDetailDTO, type FamilySummaryDTO, type Field, type PhaseDTO, type PositionDTO, type Provenance, type SubjectDTO,
} from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  blueprints, competitionFacts, competitionFamilies, competitions, examSubjects, organizations, pastExams, phases, positions, sources,
  userProfiles,
} from '../../db/schema';
import {
  DOMAIN_ORDER, VISIBLE_STATUSES, effectiveStatus, foldSql, inList, likePattern, nextDateOf, pickNextEdition, provenance,
  servableQuestionStatuses, type ProfileLike, type SourceRow,
} from './catalog.util';
import { SyllabusService } from './syllabus.service';

const CACHE_TTL_MS = 60_000;

const sourceCols = {
  id: sources.id, title: sources.title, url: sources.url, sourceType: sources.sourceType, publicationDate: sources.publicationDate,
  lastVerifiedAt: sources.lastVerifiedAt,
};

export interface EligibilityRow { positionSlug: string; title_ar: string; title_fr: string; result: EligibilityResult; provenance: Provenance }

export interface EligibilityScanItem {
  familySlug: string; name_ar: string; name_fr: string; field: Field; popularity: number;
  nextEdition: EditionDTO | null;
  best: EligibilityResult['status'];
  positions: { positionSlug: string; title_ar: string; title_fr: string; result: EligibilityResult; provenance: Provenance }[];
}

const STATUS_RANK: Record<EligibilityResult['status'], number> = { ELIGIBLE: 0, PARTIAL: 1, NOT_ELIGIBLE: 2 };

@Injectable()
export class CatalogService {
  private summaryCache: { key: string; at: number; data: FamilySummaryDTO[] } | null = null;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly syllabus: SyllabusService,
  ) {}

  /** Drops the cached family summaries (call after admin edits for immediate visibility). */
  invalidate(): void {
    this.summaryCache = null;
  }

  // ───────────── Editions ─────────────

  /** Loads editions (visible content only) with family info and source, mapped to EditionDTO with today's effective status. */
  private async loadEditions(where?: SQL): Promise<EditionDTO[]> {
    const rows = await this.db
      .select({
        e: competitions,
        familySlug: competitionFamilies.slug, familyNameAr: competitionFamilies.nameAr, familyNameFr: competitionFamilies.nameFr,
        field: competitionFamilies.field, src: sourceCols,
      })
      .from(competitions)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, competitions.familyId))
      .leftJoin(sources, eq(sources.id, competitions.sourceId))
      .where(and(
        inArray(competitions.contentStatus, VISIBLE_STATUSES),
        inArray(competitionFamilies.status, VISIBLE_STATUSES),
        where,
      ))
      .orderBy(desc(competitions.year), desc(competitions.registrationDeadline));
    const today = tunisToday();
    return rows.map(({ e, src, ...f }) => ({
      ...provenance(src?.id ? (src as SourceRow) : null, e.confidence, e.needsVerification),
      id: e.id, familySlug: f.familySlug, familyName_ar: f.familyNameAr, familyName_fr: f.familyNameFr, field: f.field,
      year: e.year, sessionLabel: e.sessionLabel, status: effectiveStatus(e, today),
      registrationOpen: e.registrationOpen, registrationDeadline: e.registrationDeadline, examDate: e.examDate,
      positionsCount: e.positionsCount, candidatesCount: e.candidatesCount, positionSlugs: e.positionSlugs,
      announcementUrl: e.announcementUrl ?? src?.url ?? null,
    }));
  }

  /**
   * Calendar. Default window: editions open today plus anything dated within the next 12 months.
   * `statuses` filter applies to today's effective status.
   */
  async editions(opts: { statuses?: EditionStatus[]; from?: string; to?: string; familySlug?: string; field?: Field }): Promise<EditionDTO[]> {
    const today = tunisToday();
    const from = opts.from ?? today;
    const to = opts.to ?? addMonths(today, 12);
    const filters = [
      opts.familySlug ? eq(competitionFamilies.slug, opts.familySlug) : undefined,
      opts.field ? eq(competitionFamilies.field, opts.field) : undefined,
    ];
    const all = await this.loadEditions(and(...filters));
    const inWindow = (e: EditionDTO) => [e.registrationOpen, e.registrationDeadline, e.examDate].some((d) => d && d >= from && d <= to);
    const defaultWindow = !opts.from && !opts.to;
    return all
      .filter((e) => inWindow(e) || (defaultWindow && e.status === 'OPEN'))
      .filter((e) => !opts.statuses?.length || opts.statuses.includes(e.status))
      .sort((a, b) => sortKey(a, today).localeCompare(sortKey(b, today)));
  }

  // ───────────── Families ─────────────

  private async summaries(): Promise<FamilySummaryDTO[]> {
    const today = tunisToday();
    const key = `${today}|${servableQuestionStatuses().join(',')}`;
    if (this.summaryCache && this.summaryCache.key === key && Date.now() - this.summaryCache.at < CACHE_TTL_MS) return this.summaryCache.data;

    const fams = await this.db
      .select({ f: competitionFamilies, o: organizations })
      .from(competitionFamilies)
      .innerJoin(organizations, eq(organizations.id, competitionFamilies.organizationId))
      .where(inArray(competitionFamilies.status, VISIBLE_STATUSES));
    const [editions, posCounts, qCounts] = await Promise.all([
      this.loadEditions(),
      this.db
        .select({ familyId: positions.familyId, n: sql<number>`count(*)::int` })
        .from(positions)
        .where(inArray(positions.status, VISIBLE_STATUSES))
        .groupBy(positions.familyId),
      this.syllabus.questionCountsByFamily(),
    ]);
    const posBy = new Map(posCounts.map((p) => [p.familyId, p.n]));
    const edBy = new Map<string, EditionDTO[]>();
    for (const e of editions) (edBy.get(e.familySlug) ?? edBy.set(e.familySlug, []).get(e.familySlug)!).push(e);

    const data = fams
      .map(({ f, o }): FamilySummaryDTO => ({
        slug: f.slug, field: f.field, name_ar: f.nameAr, name_fr: f.nameFr, description_ar: f.descriptionAr, description_fr: f.descriptionFr,
        organization: { slug: o.slug, name_ar: o.nameAr, name_fr: o.nameFr, ministry_fr: o.ministryFr, website: o.website },
        popularity: f.popularity, keywords: f.keywords,
        nextEdition: pickNextEdition(edBy.get(f.slug) ?? [], today),
        positionsCount: posBy.get(f.id) ?? 0,
        questionCount: qCounts.get(f.id) ?? 0,
      }))
      .sort((a, b) => {
        const ao = a.nextEdition?.status === 'OPEN' ? 0 : 1;
        const bo = b.nextEdition?.status === 'OPEN' ? 0 : 1;
        return ao - bo || b.popularity - a.popularity || a.name_fr.localeCompare(b.name_fr, 'fr');
      });
    this.summaryCache = { key, at: Date.now(), data };
    return data;
  }

  /** Family slugs matching a free-text query (names, keywords, organization, position titles), accent/hamza-insensitive. */
  private async matchingFamilySlugs(q: string): Promise<Set<string> | null> {
    const pattern = likePattern(q);
    if (!pattern) return null;
    const rows = await this.db
      .select({ slug: competitionFamilies.slug })
      .from(competitionFamilies)
      .innerJoin(organizations, eq(organizations.id, competitionFamilies.organizationId))
      .where(or(
        sql`${foldSql(competitionFamilies.nameAr)} ilike ${pattern}`,
        sql`${foldSql(competitionFamilies.nameFr)} ilike ${pattern}`,
        sql`${foldSql(sql`array_to_string(${competitionFamilies.keywords}, ' ')`)} ilike ${pattern}`,
        sql`${foldSql(organizations.nameAr)} ilike ${pattern}`,
        sql`${foldSql(organizations.nameFr)} ilike ${pattern}`,
        sql`${foldSql(sql`coalesce(${organizations.ministryFr}, '')`)} ilike ${pattern}`,
        sql`${competitionFamilies.slug} ilike ${pattern}`,
        sql`exists (select 1 from ${positions} p where p.family_id = ${competitionFamilies.id}
              and (${foldSql(sql`p.title_ar`)} ilike ${pattern} or ${foldSql(sql`p.title_fr`)} ilike ${pattern}))`,
      ));
    return new Set(rows.map((r) => r.slug));
  }

  async families(opts: { field?: Field; q?: string }): Promise<FamilySummaryDTO[]> {
    const all = await this.summaries();
    const matches = opts.q ? await this.matchingFamilySlugs(opts.q) : null;
    if (opts.q && !matches) return []; // query too short to be meaningful
    return all.filter((f) => (!opts.field || f.field === opts.field) && (!matches || matches.has(f.slug)));
  }

  private async familyRow(slug: string) {
    const [row] = await this.db
      .select({ f: competitionFamilies, o: organizations })
      .from(competitionFamilies)
      .innerJoin(organizations, eq(organizations.id, competitionFamilies.organizationId))
      .where(and(eq(competitionFamilies.slug, slug), inArray(competitionFamilies.status, VISIBLE_STATUSES)))
      .limit(1);
    if (!row) throw new NotFoundException('NOT_FOUND');
    return row;
  }

  async familyDetail(slug: string, userId: string | null): Promise<FamilyDetailDTO> {
    const { f, o } = await this.familyRow(slug);
    const today = tunisToday();
    const [editions, posRows, exams, tree, qCounts] = await Promise.all([
      this.loadEditions(eq(competitions.familyId, f.id)),
      this.db.select().from(positions).where(and(eq(positions.familyId, f.id), inArray(positions.status, VISIBLE_STATUSES))).orderBy(asc(positions.orderIndex), asc(positions.slug)),
      this.db.select().from(pastExams).where(eq(pastExams.familyId, f.id)).orderBy(desc(pastExams.year), asc(pastExams.title)),
      this.syllabus.familyTree(f.id, userId),
      this.syllabus.questionCountsByFamily([f.id]),
    ]);
    const posIds = posRows.map((p) => p.id);
    const [phaseRows, subjectRows, factRows, bpRows] = posIds.length
      ? await Promise.all([
        this.db.select().from(phases).where(inArray(phases.positionId, posIds)).orderBy(asc(phases.orderIndex)),
        this.db.select().from(examSubjects).where(inArray(examSubjects.positionId, posIds)),
        this.db.select().from(competitionFacts)
          .where(and(inArray(competitionFacts.positionId, posIds), inArray(competitionFacts.status, VISIBLE_STATUSES)))
          .orderBy(asc(competitionFacts.key), asc(competitionFacts.orderIndex)),
        this.db.select().from(blueprints).where(and(inArray(blueprints.positionId, posIds), inArray(blueprints.status, VISIBLE_STATUSES))).orderBy(asc(blueprints.id)),
      ])
      : [[], [], [], []];

    const referenced = new Set<string>(
      [...posRows.map((p) => p.eligibilitySourceId), ...phaseRows.map((p) => p.sourceId), ...subjectRows.map((s) => s.sourceId), ...factRows.map((x) => x.sourceId)]
        .filter((x): x is string => !!x),
    );
    for (const e of editions) if (e.source) referenced.add(e.source.id);
    const seedPrefix = `${f.slug.replace(/[\\%_]/g, (m) => `\\${m}`)}:%`;
    const srcRows = await this.db
      .select({ ...sourceCols, publisher: sources.publisher, confidence: sources.confidence, notes: sources.notes })
      .from(sources)
      .where(or(sql`${sources.seedKey} like ${seedPrefix}`, referenced.size ? inArray(sources.id, [...referenced]) : undefined));
    const srcById = new Map<string, SourceRow>(srcRows.map((s) => [s.id, s]));
    const src = (id: string | null) => (id ? srcById.get(id) ?? null : null);

    const positionsDto: PositionDTO[] = posRows.map((p) => {
      const facts = factRows.filter((x) => x.positionId === p.id);
      const bp = bpRows.find((b) => b.positionId === p.id);
      const rules = { ...(p.eligibility as EligibilityRules), needs_verification: p.eligibilityNeedsVerification };
      return {
        slug: p.slug, title_ar: p.titleAr, title_fr: p.titleFr, diplomaLevel: p.diplomaLevel,
        eligibility: { ...rules, ...provenance(src(p.eligibilitySourceId), p.eligibilityConfidence, p.eligibilityNeedsVerification, p.eligibilityQuote) },
        phases: phaseRows.filter((x) => x.positionId === p.id).map((x): PhaseDTO => ({
          ...provenance(src(x.sourceId), x.confidence, x.needsVerification, x.sourceQuote),
          order: x.orderIndex, kind: x.kind, name_ar: x.nameAr, name_fr: x.nameFr, isEliminatory: x.isEliminatory,
          durationMinutes: x.durationMinutes, description_ar: x.descriptionAr, description_fr: x.descriptionFr,
        })),
        subjects: subjectRows
          .filter((x) => x.positionId === p.id)
          .sort((a, b) => a.phaseOrder - b.phaseOrder || (DOMAIN_ORDER.get(a.domain) ?? 0) - (DOMAIN_ORDER.get(b.domain) ?? 0) || a.nameFr.localeCompare(b.nameFr))
          .map((x): SubjectDTO => ({
            ...provenance(src(x.sourceId), x.confidence, x.needsVerification, x.sourceQuote),
            phaseOrder: x.phaseOrder, domain: x.domain, specialtyKey: x.specialtyKey, name_ar: x.nameAr, name_fr: x.nameFr,
            coefficient: x.coefficient, durationMinutes: x.durationMinutes, questionCount: x.questionCount,
          })),
        physicalTests: facts.filter((x) => x.key === 'PHYSICAL_TEST').map((x) => toFact(x, src(x.sourceId))),
        requiredDocuments: facts.filter((x) => x.key === 'REQUIRED_DOCUMENT').map((x) => toFact(x, src(x.sourceId))),
        blueprint: bp
          ? { id: bp.id, title: bp.title, totalMinutes: bp.totalMinutes, fidelity: bp.fidelity === 'OFFICIAL_FORMAT' ? 'OFFICIAL_FORMAT' : 'APPROXIMATED', sections: normalizeSections(bp.sections) }
          : null,
      };
    });

    return {
      slug: f.slug, field: f.field, name_ar: f.nameAr, name_fr: f.nameFr, description_ar: f.descriptionAr, description_fr: f.descriptionFr,
      organization: { slug: o.slug, name_ar: o.nameAr, name_fr: o.nameFr, ministry_fr: o.ministryFr, website: o.website },
      popularity: f.popularity, keywords: f.keywords,
      nextEdition: pickNextEdition(editions, today),
      positionsCount: posRows.length,
      questionCount: qCounts.get(f.id) ?? 0,
      sources: srcRows
        .sort((a, b) => sourceRank(a.sourceType) - sourceRank(b.sourceType) || (b.publicationDate ?? '').localeCompare(a.publicationDate ?? '') || a.title.localeCompare(b.title))
        .map((s) => ({
          id: s.id, title: s.title, url: s.url, sourceType: s.sourceType, publicationDate: s.publicationDate, publisher: s.publisher,
          confidence: s.confidence, notes: s.notes, lastVerifiedAt: s.lastVerifiedAt ? s.lastVerifiedAt.toISOString() : null,
        })),
      editions,
      positions: positionsDto,
      syllabus: tree,
      pastExams: exams.map((x) => ({ year: x.year, title: x.title, url: x.url, sourceType: x.sourceType, isVerified: x.isVerified })),
      tips_ar: f.tipsAr, tips_fr: f.tipsFr,
      frequency: f.frequency, researchNotes: f.researchNotes,
    };
  }

  // ───────────── Eligibility ─────────────

  /** Saved profile of a session user (null when none). */
  async savedProfile(userId: string | null): Promise<ProfileLike | null> {
    if (!userId) return null;
    const [p] = await this.db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    return p ?? null;
  }

  /** Age reference date: the next edition's registration deadline when still ahead, else today. */
  private refDate(next: EditionDTO | null, today: string): string {
    return next?.registrationDeadline && next.registrationDeadline >= today ? next.registrationDeadline : today;
  }

  private async positionsWithProvenance(familyIds: string[]) {
    if (!familyIds.length) return [];
    const rows = await this.db
      .select({ p: positions, src: sourceCols })
      .from(positions)
      .leftJoin(sources, eq(sources.id, positions.eligibilitySourceId))
      .where(and(inArray(positions.familyId, familyIds), inArray(positions.status, VISIBLE_STATUSES)))
      .orderBy(asc(positions.orderIndex), asc(positions.slug));
    return rows.map(({ p, src }) => ({
      p,
      rules: { ...(p.eligibility as EligibilityRules), needs_verification: p.eligibilityNeedsVerification },
      provenance: provenance(src?.id ? (src as SourceRow) : null, p.eligibilityConfidence, p.eligibilityNeedsVerification, p.eligibilityQuote),
    }));
  }

  async eligibility(familySlug: string, positionSlug: string | undefined, profile: CandidateProfile): Promise<EligibilityRow[]> {
    const { f } = await this.familyRow(familySlug);
    const today = tunisToday();
    const ref = this.refDate(pickNextEdition(await this.loadEditions(eq(competitions.familyId, f.id)), today), today);
    const rows = (await this.positionsWithProvenance([f.id])).filter((r) => !positionSlug || r.p.slug === positionSlug);
    if (positionSlug && !rows.length) throw new NotFoundException('NOT_FOUND');
    return rows.map((r) => ({
      positionSlug: r.p.slug, title_ar: r.p.titleAr, title_fr: r.p.titleFr,
      result: checkEligibility(r.rules, profile, ref),
      provenance: r.provenance,
    }));
  }

  /**
   * "Which concours can I apply to?" — runs the profile against every family (optionally one field / upcoming only).
   * Same deterministic matcher as the alert engine, so it previews the alerts a user will receive.
   */
  async eligibilityScan(profile: CandidateProfile, opts: { field?: Field; upcomingOnly?: boolean }): Promise<EligibilityScanItem[]> {
    const today = tunisToday();
    const fams = (await this.summaries()).filter((f) => !opts.field || f.field === opts.field);
    const idRows = fams.length
      ? await this.db.select({ id: competitionFamilies.id, slug: competitionFamilies.slug }).from(competitionFamilies).where(inArray(competitionFamilies.slug, fams.map((f) => f.slug)))
      : [];
    const slugById = new Map(idRows.map((r) => [r.id, r.slug]));
    const byFamily = new Map<string, Awaited<ReturnType<CatalogService['positionsWithProvenance']>>>();
    for (const r of await this.positionsWithProvenance(idRows.map((r) => r.id))) {
      const slug = slugById.get(r.p.familyId)!;
      (byFamily.get(slug) ?? byFamily.set(slug, []).get(slug)!).push(r);
    }
    const isUpcoming = (e: EditionDTO | null) => !!e && (e.status === 'OPEN' || ((e.status === 'ANNOUNCED' || e.status === 'EXPECTED') && !!nextDateOf(e, today)));
    const items: EligibilityScanItem[] = [];
    for (const f of fams) {
      const rows = byFamily.get(f.slug) ?? [];
      if (!rows.length || (opts.upcomingOnly && !isUpcoming(f.nextEdition))) continue;
      const ref = this.refDate(f.nextEdition, today);
      const targeted = f.nextEdition?.positionSlugs.length ? new Set(f.nextEdition.positionSlugs) : null;
      const results = rows
        .filter((r) => !opts.upcomingOnly || !targeted || targeted.has(r.p.slug))
        .map((r) => ({ positionSlug: r.p.slug, title_ar: r.p.titleAr, title_fr: r.p.titleFr, result: checkEligibility(r.rules, profile, ref), provenance: r.provenance }));
      if (!results.length) continue;
      const best = results.map((r) => r.result.status).sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])[0];
      items.push({ familySlug: f.slug, name_ar: f.name_ar, name_fr: f.name_fr, field: f.field, popularity: f.popularity, nextEdition: f.nextEdition, best, positions: results });
    }
    return items.sort((a, b) =>
      STATUS_RANK[a.best] - STATUS_RANK[b.best]
      || (a.nextEdition?.status === 'OPEN' ? 0 : 1) - (b.nextEdition?.status === 'OPEN' ? 0 : 1)
      || (isUpcoming(a.nextEdition) ? 0 : 1) - (isUpcoming(b.nextEdition) ? 0 : 1)
      || b.popularity - a.popularity);
  }

  // ───────────── Search & stats ─────────────

  async search(q: string | undefined): Promise<{ families: FamilySummaryDTO[]; topics: { key: string; title_ar: string; title_fr: string; domain: (typeof DOMAINS)[number] }[] }> {
    const pattern = likePattern(q);
    if (!pattern) return { families: [], topics: [] };
    const [families, topics] = await Promise.all([this.families({ q }), this.syllabus.searchTopics(pattern)]);
    return { families, topics };
  }

  async stats(): Promise<{ families: number; questions: number; sources: number; officialFacts: number }> {
    const statuses = inList(servableQuestionStatuses());
    const visible = inList(VISIBLE_STATUSES);
    const res = await this.db.execute<{ families: number; questions: number; sources: number; official_facts: number }>(sql`
      select
        (select count(*)::int from competition_families where status in ${visible}) as families,
        (select count(*)::int from questions q where q.status in ${statuses} and (q.valid_until is null or q.valid_until >= ${tunisToday()})) as questions,
        (select count(*)::int from sources) as sources,
        (
          (select count(*) from competitions c join sources s on s.id = c.source_id
            where not c.needs_verification and s.source_type = 'OFFICIAL' and c.content_status in ${visible})
          + (select count(*) from phases x join sources s on s.id = x.source_id where not x.needs_verification and s.source_type = 'OFFICIAL')
          + (select count(*) from exam_subjects x join sources s on s.id = x.source_id where not x.needs_verification and s.source_type = 'OFFICIAL')
          + (select count(*) from competition_facts x join sources s on s.id = x.source_id
              where not x.needs_verification and s.source_type = 'OFFICIAL' and x.status in ${visible})
          + (select count(*) from positions x join sources s on s.id = x.eligibility_source_id
              where not x.eligibility_needs_verification and s.source_type = 'OFFICIAL' and x.status in ${visible})
        )::int as official_facts`);
    const r = res.rows[0];
    return { families: Number(r.families), questions: Number(r.questions), sources: Number(r.sources), officialFacts: Number(r.official_facts) };
  }
}

// ───────────── helpers ─────────────

function toFact(x: typeof competitionFacts.$inferSelect, s: SourceRow | null): FactDTO {
  return {
    ...provenance(s, x.confidence, x.needsVerification, x.sourceQuote, x.lastVerifiedAt),
    id: x.id, key: x.key, display_ar: x.displayAr, display_fr: x.displayFr, details_ar: x.detailsAr, details_fr: x.detailsFr,
  };
}

function normalizeSections(raw: unknown): BlueprintDTO['sections'] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null && (DOMAINS as readonly string[]).includes(String((s as Record<string, unknown>).domain)))
    .map((s) => ({
      domain: s.domain as (typeof DOMAINS)[number],
      specialtyKey: (s.specialtyKey ?? s.specialty_key ?? null) as string | null,
      count: Number(s.count) || 0,
      minutes: Number(s.minutes) || 0,
    }));
}

function sourceRank(t: string): number {
  return t === 'OFFICIAL' ? 0 : t === 'SECONDARY' ? 1 : t === 'COMMUNITY' ? 2 : 3;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Calendar order: open editions by deadline, then upcoming by next date, then past ones (most recent first). */
function sortKey(e: EditionDTO, today: string): string {
  if (e.status === 'OPEN') return `0|${e.registrationDeadline ?? '9999-12-31'}`;
  const next = nextDateOf(e, today);
  if (next) return `1|${next}`;
  const last = [e.registrationOpen, e.registrationDeadline, e.examDate].filter(Boolean).sort().at(-1) ?? `${e.year}-01-01`;
  return `2|${invertDate(last)}`;
}

function invertDate(iso: string): string {
  return iso.replace(/\d/g, (d) => String(9 - Number(d)));
}

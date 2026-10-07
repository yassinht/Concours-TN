import path from 'node:path';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  CONFIDENCES, DIPLOMA_LEVELS, DOMAINS, EDITION_STATUSES, FIELDS, PHASE_KINDS, SOURCE_TYPES,
  type Confidence, type DiplomaLevel, type Domain, type EditionStatus, type Field, type PhaseKind, type SourceType,
} from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import {
  blueprints, competitionFacts, competitionFamilies, competitions, examSubjects, familySyllabus, organizations, pastExams,
  phases, positions, syllabusNodes,
} from '../schema';
import { mapEligibility } from './eligibility';
import { errorMessage, type SeedLog } from './log';
import {
  InvalidItem, arr, bilingual, bool, intIn, isHttpUrl, isObj, isoDate, num, oneOf, oneOfOrNull, reqStr, str, strArr,
} from './normalize';
import { sourceResolver, upsertFileSources, type SourceRef } from './sources';
import type { SyllabusSeeder } from './syllabus';
import type { Db } from './types';

/** The 7 general-skill domains (everything but SPECIALTY). */
export const GENERAL_DOMAINS: Domain[] = DOMAINS.filter((d) => d !== 'SPECIALTY');

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const FREQUENCIES = ['ANNUAL', 'BIENNIAL', 'IRREGULAR', 'UNKNOWN'] as const;

type Resolve = (key: unknown) => SourceRef | null;
type Warn = (m: string) => void;

interface Prov {
  sourceId: string | null;
  confidence: Confidence;
  needsVerification: boolean;
  sourceQuote: string | null;
}

function provenance(o: Record<string, unknown>, resolve: Resolve, warn: Warn, dflt: Confidence = 'LOW'): Prov {
  return {
    sourceId: resolve(o.source_key)?.id ?? null,
    confidence: oneOf<Confidence>(o.confidence, CONFIDENCES, dflt, warn, 'confidence'),
    needsVerification: bool(o.needs_verification, true),
    sourceQuote: str(o.source_quote),
  };
}

/** Collected while seeding positions; drives family_syllabus links and weights. */
interface FamilyUsage {
  domains: Set<Domain>;
  specialtyKeys: Set<string>;
  domainCounts: Map<Domain, number>;
  specialtyCounts: Map<string, number>;
  /** SPECIALTY blueprint sections without a specialty_key (attributed to the family's own syllabus). */
  ownSpecialtyCount: number;
}

export async function seedCompetitionFile(db: Db, file: string, data: unknown, syl: SyllabusSeeder, log: SeedLog): Promise<boolean> {
  const ctx = `competitions/${path.basename(file)}`;
  const warn = log.scoped(ctx);
  if (!isObj(data) || !isObj(data.family)) {
    warn('missing "family" object — file skipped');
    log.inc('skipped.families');
    return false;
  }
  let fam: ReturnType<typeof normalizeFamily>;
  try {
    fam = normalizeFamily(data, warn);
  } catch (e) {
    warn(`family skipped (${errorMessage(e)})`);
    log.inc('skipped.families');
    return false;
  }
  const expected = path.basename(file, '.json');
  if (expected !== fam.slug) warn(`file name "${expected}" differs from family slug "${fam.slug}"`);

  await db.transaction(async (tx) => {
    const orgId = await upsertOrganization(tx, fam.org);
    const familyId = await upsertFamily(tx, fam, orgId);
    log.inc('upserted.families');

    const sourceMap = await upsertFileSources(tx, fam.slug, data.sources, log, ctx);
    const resolve = sourceResolver(sourceMap, log, ctx);

    await seedEditions(tx, familyId, data.editions, resolve, log, ctx);

    const usage: FamilyUsage = { domains: new Set(), specialtyKeys: new Set(), domainCounts: new Map(), specialtyCounts: new Map(), ownSpecialtyCount: 0 };
    for (const [index, rawPos] of arr(data.positions).entries()) {
      try {
        await tx.transaction((sp) => seedPosition(sp, familyId, fam, rawPos, index, resolve, usage, log, ctx));
        log.inc('upserted.positions');
      } catch (e) {
        warn(`position #${index + 1} skipped (${errorMessage(e)})`);
        log.inc('skipped.positions');
      }
    }

    await syl.upsertMany(tx, arr(data.specialty_syllabus), {
      familyId, defaultDomain: 'SPECIALTY', defaultScope: 'SUGGESTED', sourceIdOf: (k) => resolve(k)?.id ?? null, ctx,
    });

    await seedPastExams(tx, familyId, data.past_exams, log, ctx);
    await linkFamilySyllabus(tx, familyId, usage, syl, log, ctx);
  });
  return true;
}

function normalizeFamily(data: Record<string, unknown>, warn: Warn) {
  const f = data.family as Record<string, unknown>;
  const slug = reqStr(f.slug, 'family.slug');
  if (!SLUG_RE.test(slug)) throw new InvalidItem(`invalid family slug "${slug}"`);
  const field = oneOfOrNull<Field>(f.field, FIELDS, warn, 'family.field');
  if (!field) throw new InvalidItem('missing or invalid family.field');
  const name = bilingual(f.name_ar, f.name_fr, 'family.name');
  const o = isObj(f.organization) ? f.organization : {};
  const orgName = bilingual(o.name_ar ?? name.ar, o.name_fr ?? name.fr, 'organization.name');
  let orgSlug = str(o.slug)?.toLowerCase() ?? null;
  if (!orgSlug || !SLUG_RE.test(orgSlug)) {
    if (orgSlug) warn(`invalid organization slug "${orgSlug}", using "${slug}-org"`);
    orgSlug = `${slug}-org`;
  }
  const website = str(o.website);
  return {
    slug,
    field,
    nameAr: name.ar,
    nameFr: name.fr,
    descriptionAr: str(f.description_ar) ?? '',
    descriptionFr: str(f.description_fr) ?? '',
    frequency: oneOf(f.frequency, FREQUENCIES, 'UNKNOWN', warn, 'family.frequency'),
    popularity: intIn(f.popularity, 1, 5, warn, 'family.popularity') ?? 3,
    keywords: [...new Set(strArr(f.keywords))],
    tipsAr: strArr(data.tips_ar),
    tipsFr: strArr(data.tips_fr),
    researchNotes: str(data.research_notes),
    org: { slug: orgSlug, nameAr: orgName.ar, nameFr: orgName.fr, ministryFr: str(o.ministry_fr), website: isHttpUrl(website) ? website : null },
  };
}

type FamilyInput = ReturnType<typeof normalizeFamily>;

async function upsertOrganization(db: Db, o: FamilyInput['org']): Promise<string> {
  const values = { nameAr: o.nameAr, nameFr: o.nameFr, ministryFr: o.ministryFr, website: o.website };
  const [row] = await db
    .insert(organizations)
    .values({ slug: o.slug, ...values })
    .onConflictDoUpdate({ target: organizations.slug, set: values })
    .returning({ id: organizations.id });
  return row.id;
}

async function upsertFamily(db: Db, f: FamilyInput, organizationId: string): Promise<string> {
  const values = {
    organizationId, field: f.field, nameAr: f.nameAr, nameFr: f.nameFr, descriptionAr: f.descriptionAr, descriptionFr: f.descriptionFr,
    frequency: f.frequency, popularity: f.popularity, keywords: f.keywords, tipsAr: f.tipsAr, tipsFr: f.tipsFr, researchNotes: f.researchNotes,
  };
  // status is admin-managed (an archived family stays archived on re-seed).
  const [row] = await db
    .insert(competitionFamilies)
    .values({ slug: f.slug, ...values })
    .onConflictDoUpdate({ target: competitionFamilies.slug, set: { ...values, updatedAt: new Date() } })
    .returning({ id: competitionFamilies.id });
  return row.id;
}

// ───────────── Editions ─────────────

export interface EditionInput {
  year: number;
  sessionLabel: string | null;
  status: EditionStatus;
  registrationOpen: string | null;
  registrationDeadline: string | null;
  examDate: string | null;
  positionsCount: number | null;
  candidatesCount: number | null;
  positionSlugs?: string[];
  announcementUrl: string | null;
  sourceId: string | null;
  confidence: Confidence;
  needsVerification: boolean;
}

/** Upsert by (family, year, coalesce(session_label,'')). alerts_sent_at and content_status are never touched. */
export async function upsertEdition(db: Db, familyId: string, e: EditionInput): Promise<{ id: string; created: boolean }> {
  const values = {
    status: e.status, registrationOpen: e.registrationOpen, registrationDeadline: e.registrationDeadline, examDate: e.examDate,
    positionsCount: e.positionsCount, candidatesCount: e.candidatesCount, announcementUrl: e.announcementUrl, sourceId: e.sourceId,
    confidence: e.confidence, needsVerification: e.needsVerification,
    ...(e.positionSlugs ? { positionSlugs: e.positionSlugs } : {}),
  };
  const [existing] = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(and(eq(competitions.familyId, familyId), eq(competitions.year, e.year), sql`coalesce(${competitions.sessionLabel}, '') = ${e.sessionLabel ?? ''}`))
    .limit(1);
  if (existing) {
    await db.update(competitions).set({ ...values, updatedAt: new Date() }).where(eq(competitions.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [row] = await db.insert(competitions).values({ familyId, year: e.year, sessionLabel: e.sessionLabel, ...values }).returning({ id: competitions.id });
  return { id: row.id, created: true };
}

async function seedEditions(db: Db, familyId: string, rawEditions: unknown, resolve: Resolve, log: SeedLog, ctx: string) {
  const warn = log.scoped(ctx);
  const today = tunisToday();
  for (const [i, raw] of arr(rawEditions).entries()) {
    try {
      if (!isObj(raw)) throw new InvalidItem('edition is not an object');
      const year = intIn(raw.year, 1990, 2100, warn, 'edition.year');
      if (year == null) throw new InvalidItem('missing or invalid year');
      let status = oneOf<EditionStatus>(raw.status, EDITION_STATUSES, 'EXPECTED', warn, 'edition.status');
      const registrationDeadline = isoDate(raw.registration_deadline, warn, 'registration_deadline');
      if (status === 'OPEN' && registrationDeadline && registrationDeadline < today) {
        log.info(`${ctx}: edition ${year} marked OPEN but deadline ${registrationDeadline} passed → CLOSED`);
        status = 'CLOSED';
      }
      const source = resolve(raw.source_key);
      const prov = provenance(raw, resolve, warn, 'LOW');
      const r = await upsertEdition(db, familyId, {
        year,
        sessionLabel: str(raw.session_label),
        status,
        registrationOpen: isoDate(raw.registration_open, warn, 'registration_open'),
        registrationDeadline,
        examDate: isoDate(raw.exam_date, warn, 'exam_date'),
        positionsCount: intIn(raw.positions_count, 0, 1_000_000, warn, 'positions_count'),
        candidatesCount: intIn(raw.candidates_count, 0, 10_000_000, warn, 'candidates_count'),
        positionSlugs: strArr(raw.position_slugs),
        announcementUrl: isHttpUrl(str(raw.announcement_url)) ? str(raw.announcement_url) : source?.url ?? null,
        sourceId: prov.sourceId,
        confidence: prov.confidence,
        needsVerification: prov.needsVerification,
      });
      log.inc(r.created ? 'created.editions' : 'updated.editions');
    } catch (e) {
      if (!(e instanceof InvalidItem)) throw e;
      warn(`edition #${i + 1} skipped (${errorMessage(e)})`);
      log.inc('skipped.editions');
    }
  }
}

// ───────────── Positions ─────────────

async function seedPosition(
  db: Db, familyId: string, fam: FamilyInput, raw: unknown, index: number, resolve: Resolve, usage: FamilyUsage, log: SeedLog, ctx: string,
): Promise<void> {
  if (!isObj(raw)) throw new InvalidItem('position is not an object');
  const slug = reqStr(raw.slug, 'slug').toLowerCase();
  if (!SLUG_RE.test(slug)) throw new InvalidItem(`invalid position slug "${slug}"`);
  const pctx = `${ctx} [${slug}]`;
  const warn = log.scoped(pctx);
  const title = bilingual(raw.title_ar, raw.title_fr, 'title');
  const diplomaLevel = oneOf<DiplomaLevel>(raw.diploma_level, DIPLOMA_LEVELS, 'BAC', warn, 'diploma_level');
  const elig = isObj(raw.eligibility) ? raw.eligibility : {};
  const rules = mapEligibility(elig, diplomaLevel, warn);
  const eligProv = provenance(elig, resolve, warn, 'LOW');

  const values = {
    titleAr: title.ar, titleFr: title.fr, diplomaLevel, eligibility: rules, eligibilitySourceId: eligProv.sourceId,
    eligibilityConfidence: eligProv.confidence, eligibilityNeedsVerification: eligProv.needsVerification, eligibilityQuote: eligProv.sourceQuote,
    orderIndex: index,
  };
  const [pos] = await db
    .insert(positions)
    .values({ familyId, slug, ...values })
    .onConflictDoUpdate({ target: [positions.familyId, positions.slug], set: values })
    .returning({ id: positions.id });

  await replacePhases(db, pos.id, raw.phases, resolve, log, pctx);
  await replaceSubjects(db, pos.id, raw.subjects, resolve, usage, log, pctx);
  await replaceFacts(db, familyId, pos.id, 'PHYSICAL_TEST', arr(raw.physical_tests), resolve, log, pctx);
  await replaceFacts(db, familyId, pos.id, 'REQUIRED_DOCUMENT', arr(raw.required_documents), resolve, log, pctx);
  await replaceBlueprint(db, pos.id, `${fam.nameFr} — ${title.fr}`, raw.blueprint, usage, log, pctx);
}

async function replacePhases(db: Db, positionId: string, rawPhases: unknown, resolve: Resolve, log: SeedLog, ctx: string) {
  const warn = log.scoped(ctx);
  const rows: (typeof phases.$inferInsert)[] = [];
  for (const [i, raw] of arr(rawPhases).entries()) {
    try {
      if (!isObj(raw)) throw new InvalidItem('phase is not an object');
      const kind = oneOfOrNull<PhaseKind>(raw.kind, PHASE_KINDS, warn, 'phase.kind');
      if (!kind) throw new InvalidItem('missing or invalid kind');
      const name = bilingual(raw.name_ar, raw.name_fr, 'name');
      const prov = provenance(raw, resolve, warn);
      rows.push({
        positionId, orderIndex: intIn(raw.order, 0, 50, warn, 'phase.order') ?? i + 1, kind, nameAr: name.ar, nameFr: name.fr,
        isEliminatory: bool(raw.is_eliminatory, true), durationMinutes: intIn(raw.duration_minutes, 1, 100_000, warn, 'phase.duration_minutes'),
        descriptionAr: str(raw.description_ar), descriptionFr: str(raw.description_fr), ...prov,
      });
    } catch (e) {
      warn(`phase #${i + 1} skipped (${errorMessage(e)})`);
      log.inc('skipped.phases');
    }
  }
  await db.delete(phases).where(eq(phases.positionId, positionId));
  if (rows.length) await db.insert(phases).values(rows);
  log.inc('upserted.phases', rows.length);
}

async function replaceSubjects(db: Db, positionId: string, rawSubjects: unknown, resolve: Resolve, usage: FamilyUsage, log: SeedLog, ctx: string) {
  const warn = log.scoped(ctx);
  const rows: (typeof examSubjects.$inferInsert)[] = [];
  for (const [i, raw] of arr(rawSubjects).entries()) {
    try {
      if (!isObj(raw)) throw new InvalidItem('subject is not an object');
      const domain = oneOfOrNull<Domain>(raw.domain, DOMAINS, warn, 'subject.domain');
      if (!domain) throw new InvalidItem('missing or invalid domain');
      const name = bilingual(raw.name_ar, raw.name_fr, 'name');
      const specialtyKey = str(raw.specialty_key);
      if (domain !== 'SPECIALTY') usage.domains.add(domain);
      if (specialtyKey) usage.specialtyKeys.add(specialtyKey);
      rows.push({
        positionId, phaseOrder: intIn(raw.phase_order, 0, 50, warn, 'subject.phase_order') ?? 1, domain, specialtyKey, nameAr: name.ar, nameFr: name.fr,
        coefficient: num(raw.coefficient, warn, 'subject.coefficient'), durationMinutes: intIn(raw.duration_minutes, 1, 100_000, warn, 'subject.duration_minutes'),
        questionCount: intIn(raw.question_count, 0, 10_000, warn, 'subject.question_count'), ...provenance(raw, resolve, warn),
      });
    } catch (e) {
      warn(`subject #${i + 1} skipped (${errorMessage(e)})`);
      log.inc('skipped.subjects');
    }
  }
  await db.delete(examSubjects).where(eq(examSubjects.positionId, positionId));
  if (rows.length) await db.insert(examSubjects).values(rows);
  log.inc('upserted.subjects', rows.length);
}

/**
 * Replaces the facts of one key for a position, updating rows in place (by order) so fact ids stay stable
 * across re-seeds — users' document checklists (user_document_checks) reference them.
 */
async function replaceFacts(
  db: Db, familyId: string, positionId: string, key: 'PHYSICAL_TEST' | 'REQUIRED_DOCUMENT', items: unknown[], resolve: Resolve, log: SeedLog, ctx: string,
) {
  const warn = log.scoped(ctx);
  const rows: Omit<typeof competitionFacts.$inferInsert, 'familyId' | 'positionId' | 'key' | 'orderIndex'>[] = [];
  for (const [i, raw] of items.entries()) {
    try {
      if (!isObj(raw)) throw new InvalidItem('fact is not an object');
      const prov = provenance(raw, resolve, warn);
      if (key === 'PHYSICAL_TEST') {
        const name = bilingual(raw.name_ar, raw.name_fr, 'name');
        const code = str(raw.code ?? raw.test_code);
        rows.push({
          displayAr: name.ar, displayFr: name.fr, detailsAr: str(raw.details_ar), detailsFr: str(raw.details_fr),
          value: code ? { code } : null, ...prov,
        });
      } else {
        const text = bilingual(raw.text_ar, raw.text_fr, 'text');
        rows.push({ displayAr: text.ar, displayFr: text.fr, detailsAr: str(raw.details_ar), detailsFr: str(raw.details_fr), value: null, ...prov });
      }
    } catch (e) {
      warn(`${key.toLowerCase()} #${i + 1} skipped (${errorMessage(e)})`);
      log.inc('skipped.facts');
    }
  }
  const existing = await db
    .select({ id: competitionFacts.id })
    .from(competitionFacts)
    .where(and(eq(competitionFacts.positionId, positionId), eq(competitionFacts.key, key)))
    .orderBy(asc(competitionFacts.orderIndex), asc(competitionFacts.id));
  for (const [i, r] of rows.entries()) {
    const values = { ...r, familyId, positionId, key, orderIndex: i };
    if (existing[i]) await db.update(competitionFacts).set(values).where(eq(competitionFacts.id, existing[i].id));
    else await db.insert(competitionFacts).values(values);
  }
  const surplus = existing.slice(rows.length).map((r) => r.id);
  if (surplus.length) await db.delete(competitionFacts).where(inArray(competitionFacts.id, surplus));
  log.inc('upserted.facts', rows.length);
}

async function replaceBlueprint(db: Db, positionId: string, title: string, raw: unknown, usage: FamilyUsage, log: SeedLog, ctx: string) {
  if (raw == null) return;
  const warn = log.scoped(ctx);
  if (!isObj(raw)) {
    warn('blueprint is not an object — ignored');
    return;
  }
  const sections: { domain: Domain; specialtyKey: string | null; count: number; minutes: number }[] = [];
  const pending: { domain: Domain; specialtyKey: string | null; count: number; minutes: number | null }[] = [];
  for (const [i, s] of arr(raw.sections).entries()) {
    if (!isObj(s)) continue;
    const domain = oneOfOrNull<Domain>(s.domain, DOMAINS, warn, 'blueprint.domain');
    const count = intIn(s.count, 1, 500, warn, 'blueprint.count');
    if (!domain || count == null) {
      warn(`blueprint section #${i + 1} skipped (domain/count invalid)`);
      continue;
    }
    pending.push({ domain, specialtyKey: str(s.specialty_key), count, minutes: intIn(s.minutes, 0, 1_000, warn, 'blueprint.minutes') });
  }
  if (!pending.length) {
    warn('blueprint has no valid section — ignored');
    return;
  }
  const knownMinutes = pending.reduce((a, s) => a + (s.minutes ?? 0), 0);
  let totalMinutes = intIn(raw.total_minutes, 1, 1_000, warn, 'blueprint.total_minutes') ?? (knownMinutes || pending.length * 10);
  const missing = pending.filter((s) => s.minutes == null);
  const missingCount = missing.reduce((a, s) => a + s.count, 0);
  const spare = Math.max(0, totalMinutes - knownMinutes);
  for (const s of pending) {
    // Sections without minutes share the remaining time in proportion to their question counts (≥ 1 min each).
    const minutes = s.minutes ?? Math.max(1, Math.round((spare || missingCount) * (s.count / Math.max(1, missingCount))));
    sections.push({ domain: s.domain, specialtyKey: s.specialtyKey, count: s.count, minutes });
    if (s.domain !== 'SPECIALTY') {
      usage.domains.add(s.domain);
      usage.domainCounts.set(s.domain, (usage.domainCounts.get(s.domain) ?? 0) + s.count);
    } else if (s.specialtyKey) {
      usage.specialtyKeys.add(s.specialtyKey);
      usage.specialtyCounts.set(s.specialtyKey, (usage.specialtyCounts.get(s.specialtyKey) ?? 0) + s.count);
    } else usage.ownSpecialtyCount += s.count;
  }
  totalMinutes = Math.max(totalMinutes, 1);
  const fidelity = oneOf(raw.fidelity, ['OFFICIAL_FORMAT', 'APPROXIMATED'] as const, 'APPROXIMATED', warn, 'blueprint.fidelity');

  // One blueprint per position, updated in place so attempts keep their blueprint_id.
  const existing = await db.select({ id: blueprints.id }).from(blueprints).where(eq(blueprints.positionId, positionId)).orderBy(asc(blueprints.id));
  const values = { title, totalMinutes, fidelity, sections };
  if (existing[0]) {
    await db.update(blueprints).set(values).where(eq(blueprints.id, existing[0].id));
    const extra = existing.slice(1).map((b) => b.id);
    if (extra.length) await db.delete(blueprints).where(inArray(blueprints.id, extra));
  } else {
    await db.insert(blueprints).values({ positionId, ...values });
  }
  log.inc('upserted.blueprints');
}

// ───────────── Past exams ─────────────

async function seedPastExams(db: Db, familyId: string, rawExams: unknown, log: SeedLog, ctx: string) {
  const warn = log.scoped(ctx);
  const items: { year: number; title: string; url: string | null; sourceType: SourceType; isVerified: boolean }[] = [];
  for (const [i, raw] of arr(rawExams).entries()) {
    try {
      if (!isObj(raw)) throw new InvalidItem('past exam is not an object');
      const year = intIn(raw.year, 1950, 2100, warn, 'past_exam.year');
      if (year == null) throw new InvalidItem('missing year');
      const url = str(raw.url);
      items.push({
        year, title: reqStr(raw.title, 'title'), url: isHttpUrl(url) ? url : null,
        sourceType: oneOf<SourceType>(raw.source_type, SOURCE_TYPES, 'COMMUNITY', warn, 'past_exam.source_type'),
        isVerified: bool(raw.is_verified, false),
      });
    } catch (e) {
      warn(`past exam #${i + 1} skipped (${errorMessage(e)})`);
      log.inc('skipped.pastExams');
    }
  }
  // Replace per family, keeping rows linked to an uploaded document (admin work) and stable ids for unchanged rows.
  const existing = await db.select().from(pastExams).where(eq(pastExams.familyId, familyId));
  const keyOf = (y: number, t: string) => `${y}|${t}`;
  const byKey = new Map(existing.map((r) => [keyOf(r.year, r.title), r]));
  const kept = new Set<string>();
  for (const it of items) {
    const prev = byKey.get(keyOf(it.year, it.title));
    if (prev) {
      kept.add(prev.id);
      await db.update(pastExams).set({ url: it.url, sourceType: it.sourceType, isVerified: it.isVerified }).where(eq(pastExams.id, prev.id));
    } else {
      await db.insert(pastExams).values({ familyId, ...it });
    }
  }
  const stale = existing.filter((r) => !kept.has(r.id) && !r.documentId).map((r) => r.id);
  if (stale.length) await db.delete(pastExams).where(inArray(pastExams.id, stale));
  log.inc('upserted.pastExams', items.length);
}

// ───────────── family_syllabus ─────────────

async function linkFamilySyllabus(db: Db, familyId: string, usage: FamilyUsage, syl: SyllabusSeeder, log: SeedLog, ctx: string) {
  const domains = usage.domains.size ? [...usage.domains] : GENERAL_DOMAINS;
  const total = [...usage.domainCounts.values(), ...usage.specialtyCounts.values()].reduce((a, b) => a + b, 0) + usage.ownSpecialtyCount;
  // Weight = share of blueprint questions; nodes the blueprints do not cover keep a small non-zero weight.
  const weightOf = (count: number) => (total > 0 ? Math.round(Math.max(count / total, 0.02) * 10_000) / 10_000 : 1);
  const links = new Map<string, number>();

  const subjects = await db
    .select({ id: syllabusNodes.id, domain: syllabusNodes.domain })
    .from(syllabusNodes)
    .where(and(isNull(syllabusNodes.familyId), isNull(syllabusNodes.parentId), eq(syllabusNodes.level, 'SUBJECT'), inArray(syllabusNodes.domain, domains)));
  for (const s of subjects) links.set(s.id, weightOf(usage.domainCounts.get(s.domain) ?? 0));
  const missingDomains = domains.filter((d) => !subjects.some((s) => s.domain === d));
  if (missingDomains.length) log.warn(ctx, `no common SUBJECT node for domain(s) ${missingDomains.join(', ')}`);

  for (const key of usage.specialtyKeys) {
    const id = syl.idOf(key);
    if (!id) {
      log.warn(ctx, `specialty_key "${key}" has no syllabus node (not linked)`);
      continue;
    }
    links.set(id, weightOf(usage.specialtyCounts.get(key) ?? 0));
  }

  const ownRoots = await db
    .select({ id: syllabusNodes.id, parentId: syllabusNodes.parentId })
    .from(syllabusNodes)
    .where(eq(syllabusNodes.familyId, familyId));
  const ownIds = new Set(ownRoots.map((r) => r.id));
  for (const r of ownRoots) {
    if ((!r.parentId || !ownIds.has(r.parentId)) && !links.has(r.id)) links.set(r.id, weightOf(usage.ownSpecialtyCount));
  }

  await db.delete(familySyllabus).where(eq(familySyllabus.familyId, familyId));
  if (links.size) await db.insert(familySyllabus).values([...links].map(([nodeId, weight]) => ({ familyId, nodeId, weight })));
  log.inc('upserted.familySyllabus', links.size);
}

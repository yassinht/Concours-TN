import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { tunisToday } from '../../common/dates';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { auditLogs, competitionFamilies, competitions, ingestCandidates, sources, users, watchedSources } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentsService } from './documents.service';
import { heuristicExtract, type EditionProposal } from './extraction';
import { FactsExtractionService } from './facts-extraction.service';
import { PageFetcher } from './page-fetcher';
import { extractAnchors, htmlToText, sha256, splitPages } from './text.util';
import { announcementBlocks, guessFamily, type FamilyGuess, type FamilyKeywords } from './watch.util';

const httpUrl = z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'http(s) URL required');
export const WatchInput = z.object({
  url: httpUrl,
  label: z.string().trim().min(2).max(120),
  familySlug: z.string().trim().max(80).nullable().optional(),
  active: z.boolean().optional(),
});
export type WatchInput = z.infer<typeof WatchInput>;
export const WatchPatch = WatchInput.omit({ url: true }).partial();
export type WatchPatch = z.infer<typeof WatchPatch>;
export const DraftInput = z.object({
  /** Defaults to the watcher's family guess. */
  familySlug: z.string().trim().min(1).max(80).optional(),
  /** Also download the announcement (PDF/HTML), store it as a document of the new source and run facts extraction. */
  importDocument: z.boolean().optional(),
});
export type DraftInput = z.infer<typeof DraftInput>;
/** Optional body of POST /admin/watch/check-now: restrict the run to some watchers ("check this page now"). */
export const CheckNowInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional() }).default({});
export type CheckNowInput = z.infer<typeof CheckNowInput>;
export const CANDIDATE_STATUSES = ['NEW', 'DRAFTED', 'IGNORED'] as const;

const CHECK_CONCURRENCY = 4;

export interface WatchedSourceDTO {
  id: string;
  url: string;
  label: string;
  familySlug: string | null;
  active: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  newCandidates: number;
}

export interface DraftImport {
  document: { id: string; ocrStatus: string; pageCount: number | null; duplicate: boolean } | null;
  extractionJobId: string | null;
  error: string | null;
}

export interface DraftResult {
  candidate: CandidateDTO;
  competition: {
    id: string; familySlug: string; year: number; status: string; contentStatus: string; needsVerification: boolean; confidence: string;
    registrationOpen: string | null; registrationDeadline: string | null; examDate: string | null; positionsCount: number | null;
    announcementUrl: string | null; sourceId: string | null;
  };
  import?: DraftImport;
}

export interface CheckResult {
  id: string;
  url: string;
  outcome: 'FIRST_SNAPSHOT' | 'UNCHANGED' | 'CHANGED' | 'ERROR';
  newCandidates: number;
  error?: string;
}

export interface CandidateDTO {
  id: string;
  watchedSourceId: string | null;
  watchedSourceLabel: string | null;
  url: string | null;
  title: string;
  rawText: string | null;
  familySlugGuess: string | null;
  extracted: unknown;
  status: string;
  detectedAt: string;
}

interface CandidateExtraction {
  method: 'HEURISTIC';
  /** Dates / year / number of positions read from the announcement lines — suggestions, never official. */
  editions: EditionProposal[];
  familyGuess: FamilyGuess;
  draft?: { competitionId: string; familySlug: string; at: string; by: string };
}

/**
 * Watches official pages (concours.gov.tn, ministries…) for new concours announcements.
 * Each check fetches the page, reduces it to text and compares its sha256 with the previous one; when it changed, the
 * new lines that look like announcements become `ingest_candidates` (deduplicated by the sha of their text block) with
 * a family guess. An editor then drafts an edition from a candidate (ANNOUNCED, needs_verification, content DRAFT) —
 * users are only alerted once that edition is reviewed and published (AlertsService ignores non-PUBLISHED editions).
 *
 * The previous text of each page is kept as a snapshot file in UPLOAD_DIR/watch/<id>.txt (the table only stores its hash).
 */
@Injectable()
export class WatchService {
  private readonly logger = new Logger('WatchService');
  private running: Promise<CheckResult[]> | null = null;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly fetcher: PageFetcher,
    private readonly documents: DocumentsService,
    private readonly facts: FactsExtractionService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ───────────── Watched sources ─────────────

  async list(): Promise<WatchedSourceDTO[]> {
    const rows = await this.db
      .select({
        w: watchedSources,
        // Outer column written qualified: drizzle renders columns unqualified in single-table selects.
        newCandidates: sql<number>`(select count(*) from ingest_candidates c where c.watched_source_id = "watched_sources"."id" and c.status = 'NEW')::int`,
      })
      .from(watchedSources)
      .orderBy(desc(watchedSources.active), watchedSources.label);
    return rows.map((r) => toWatchDTO(r.w, r.newCandidates));
  }

  /** Creates the watcher, or updates label/family/active when the URL is already watched. */
  async upsert(input: WatchInput, actorId: string): Promise<WatchedSourceDTO> {
    if (input.familySlug) await this.assertFamily(input.familySlug, BadRequestException);
    // Kept as typed (no trailing-slash normalisation) so re-posting a seeded URL updates it instead of duplicating it.
    const url = input.url;
    const [row] = await this.db
      .insert(watchedSources)
      .values({ url, label: input.label, familySlug: input.familySlug ?? null, active: input.active ?? true })
      .onConflictDoUpdate({
        target: watchedSources.url,
        set: { label: input.label, familySlug: input.familySlug ?? null, ...(input.active === undefined ? {} : { active: input.active }) },
      })
      .returning();
    await this.audit.log(actorId, 'watch.upsert', 'watched_source', row.id, { url, label: input.label, familySlug: input.familySlug ?? null });
    return toWatchDTO(row, 0);
  }

  async patch(id: string, input: WatchPatch, actorId: string): Promise<WatchedSourceDTO> {
    if (input.familySlug) await this.assertFamily(input.familySlug, BadRequestException);
    const set: Partial<typeof watchedSources.$inferInsert> = {};
    if (input.label !== undefined) set.label = input.label;
    if (input.familySlug !== undefined) set.familySlug = input.familySlug;
    if (input.active !== undefined) set.active = input.active;
    if (!Object.keys(set).length) throw new BadRequestException('NOTHING_TO_UPDATE');
    const [row] = await this.db.update(watchedSources).set(set).where(eq(watchedSources.id, id)).returning();
    if (!row) throw new NotFoundException('NOT_FOUND');
    await this.audit.log(actorId, 'watch.update', 'watched_source', id, input);
    return toWatchDTO(row, 0);
  }

  // ───────────── Checks ─────────────

  @Cron('17 */6 * * *', { name: 'ingestion-watch', timeZone: 'Africa/Tunis' })
  async scheduledCheck(): Promise<void> {
    if (!env().CRON_ENABLED) return;
    try {
      const results = await this.checkAll();
      const changed = results.filter((r) => r.outcome === 'CHANGED').length;
      this.logger.log(`watch: ${results.length} page(s) checked, ${changed} changed, ${results.reduce((n, r) => n + r.newCandidates, 0)} new candidate(s)`);
    } catch (e) {
      this.logger.error(`watch cron failed: ${(e as Error).message}`);
    }
  }

  /**
   * Checks every active page, or only the given watchers (active or not) when `ids` is set.
   * Concurrent full runs (cron + "check now") share the same run.
   */
  checkAll(actorId: string | null = null, ids?: string[]): Promise<CheckResult[]> {
    if (ids?.length) return this.runAll(actorId, ids);
    if (!this.running) {
      this.running = this.runAll(actorId).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async runAll(actorId: string | null, ids?: string[]): Promise<CheckResult[]> {
    const active = await this.db
      .select()
      .from(watchedSources)
      .where(ids?.length ? inArray(watchedSources.id, ids) : eq(watchedSources.active, true));
    const families = await this.familyKeywords();
    const results: CheckResult[] = [];
    let next = 0;
    const worker = async () => {
      while (next < active.length) {
        const w = active[next++];
        results.push(await this.checkOne(w, families));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, active.length) }, worker));
    const created = results.reduce((n, r) => n + r.newCandidates, 0);
    if (actorId) await this.audit.log(actorId, 'watch.check_now', 'watched_source', null, { checked: results.length, created });
    if (created > 0) await this.notifyStaff(created);
    return results;
  }

  async checkOne(w: typeof watchedSources.$inferSelect, families?: FamilyKeywords[]): Promise<CheckResult> {
    const now = new Date();
    try {
      const page = await this.fetcher.fetchPage(w.url);
      const isHtml = /html|xml/i.test(page.contentType) || /<(html|body|div|p)\b/i.test(page.body.slice(0, 2000));
      const text = isHtml ? htmlToText(page.body) : page.body.replace(/\r\n?/g, '\n').trim();
      const hash = sha256(text);
      if (hash === w.lastSha256) {
        await this.db.update(watchedSources).set({ lastCheckedAt: now, lastError: null }).where(eq(watchedSources.id, w.id));
        return { id: w.id, url: w.url, outcome: 'UNCHANGED', newCandidates: 0 };
      }
      const previous = await this.readSnapshot(w.id);
      const blocks = announcementBlocks(previous, text, isHtml ? extractAnchors(page.body, page.url) : []);
      const fams = families ?? (await this.familyKeywords());
      let created = 0;
      for (const b of blocks) {
        const guess = guessFamily(b.text, fams, w.familySlug);
        const extracted: CandidateExtraction = { method: 'HEURISTIC', editions: heuristicExtract(splitPages(b.text)).editions, familyGuess: guess };
        const inserted = await this.db
          .insert(ingestCandidates)
          .values({ watchedSourceId: w.id, url: b.url ?? page.url, title: b.title, rawText: b.text, sha256: b.sha, familySlugGuess: guess.slug, extracted })
          .onConflictDoNothing({ target: ingestCandidates.sha256 })
          .returning({ id: ingestCandidates.id });
        created += inserted.length;
      }
      await this.writeSnapshot(w.id, text);
      await this.db.update(watchedSources).set({ lastCheckedAt: now, lastSha256: hash, lastError: null }).where(eq(watchedSources.id, w.id));
      return { id: w.id, url: w.url, outcome: previous === null ? 'FIRST_SNAPSHOT' : 'CHANGED', newCandidates: created };
    } catch (e) {
      const error = describeFetchError(e);
      this.logger.warn(`watch ${w.url} failed: ${error}`);
      await this.db.update(watchedSources).set({ lastCheckedAt: now, lastError: error }).where(eq(watchedSources.id, w.id));
      return { id: w.id, url: w.url, outcome: 'ERROR', newCandidates: 0, error };
    }
  }

  // ───────────── Candidates ─────────────

  async listCandidates(status: (typeof CANDIDATE_STATUSES)[number] | undefined, limit: number): Promise<CandidateDTO[]> {
    const rows = await this.db
      .select({ c: ingestCandidates, label: watchedSources.label })
      .from(ingestCandidates)
      .leftJoin(watchedSources, eq(watchedSources.id, ingestCandidates.watchedSourceId))
      .where(status ? eq(ingestCandidates.status, status) : undefined)
      .orderBy(desc(ingestCandidates.detectedAt))
      .limit(limit);
    return rows.map((r) => toCandidateDTO(r.c, r.label));
  }

  /**
   * Creates a draft edition from a candidate: status ANNOUNCED, needs_verification, content DRAFT, confidence LOW,
   * dates pre-filled from the announcement text when found (suggestions for the reviewer), linked to a source row for
   * the announcement URL. The edition is invisible to users and triggers no alert until a reviewer publishes it.
   */
  async draft(id: string, input: DraftInput, actorId: string): Promise<DraftResult> {
    const [current] = await this.db.select({ guess: ingestCandidates.familySlugGuess }).from(ingestCandidates).where(eq(ingestCandidates.id, id)).limit(1);
    if (!current) throw new NotFoundException('NOT_FOUND');
    const slug = input.familySlug ?? current.guess;
    if (!slug) throw new BadRequestException('FAMILY_REQUIRED');
    const family = await this.assertFamily(slug, NotFoundException);
    const result = await this.createDraft(id, family, actorId);
    if (!input.importDocument || !result.competition.announcementUrl) return result;
    return { ...result, import: await this.importAnnouncement(result.competition.announcementUrl, result.competition.sourceId, family.slug, actorId) };
  }

  /**
   * Downloads the announcement linked by a candidate, stores it like an upload (sha256 dedupe, page chunks) under the
   * edition's source, and runs facts extraction on it so the reviewer gets a quoted proposal right away.
   * Failures are reported in the result, never thrown: the draft edition already exists.
   */
  private async importAnnouncement(url: string, sourceId: string | null, familySlug: string, actorId: string): Promise<DraftImport> {
    try {
      const file = await this.fetcher.fetchDocument(url);
      const name = decodeURIComponent(new URL(file.url).pathname.split('/').pop() || '') || 'announcement';
      const { duplicate, document } = await this.documents.upload(
        { originalname: name, mimetype: file.contentType.split(';')[0].trim() || 'application/octet-stream', size: file.buffer.length, buffer: file.buffer },
        sourceId,
        actorId,
      );
      if (document.ocrStatus !== 'TEXT_LAYER') {
        return { document: { id: document.id, ocrStatus: document.ocrStatus, pageCount: document.pageCount, duplicate }, extractionJobId: null, error: 'DOCUMENT_NEEDS_OCR' };
      }
      const job = await this.facts.extract({ documentId: document.id, familySlug }, actorId);
      return { document: { id: document.id, ocrStatus: document.ocrStatus, pageCount: document.pageCount, duplicate }, extractionJobId: job.id, error: null };
    } catch (e) {
      const err = e as Error & { response?: { message?: string } };
      return { document: null, extractionJobId: null, error: (err.response?.message ?? describeFetchError(e)).slice(0, 300) };
    }
  }

  private async createDraft(id: string, family: { id: string; slug: string }, actorId: string): Promise<DraftResult> {
    return this.db.transaction(async (tx) => {
      const [cand] = await tx
        .update(ingestCandidates)
        .set({ status: 'DRAFTED' })
        .where(and(eq(ingestCandidates.id, id), ne(ingestCandidates.status, 'DRAFTED')))
        .returning();
      if (!cand) {
        const [exists] = await tx.select({ id: ingestCandidates.id }).from(ingestCandidates).where(eq(ingestCandidates.id, id)).limit(1);
        throw exists ? new ConflictException('ALREADY_DRAFTED') : new NotFoundException('NOT_FOUND');
      }
      const extracted = (cand.extracted ?? {}) as Partial<CandidateExtraction>;
      const e = extracted.editions?.[0];
      const year = e?.year ?? yearOf(e?.registration_deadline ?? e?.exam_date ?? e?.registration_open) ?? Number(tunisToday().slice(0, 4));

      let sourceId: string | null = null;
      if (cand.url) {
        const [src] = await tx.select({ id: sources.id }).from(sources).where(eq(sources.url, cand.url)).limit(1);
        if (src) sourceId = src.id;
        else {
          const host = safeHost(cand.url);
          const [created] = await tx.insert(sources).values({
            title: cand.title.slice(0, 200),
            url: cand.url,
            publisher: host,
            sourceType: host && /(^|\.)gov\.tn$/.test(host) ? 'OFFICIAL' : 'SECONDARY',
            retrievedAt: cand.detectedAt,
            confidence: 'LOW',
            notes: 'Detected automatically by the official-page watcher. Verify the announcement before publishing.',
          }).returning({ id: sources.id });
          sourceId = created.id;
        }
      }

      const [edition] = await tx.insert(competitions).values({
        familyId: family.id,
        year,
        status: 'ANNOUNCED',
        registrationOpen: e?.registration_open ?? null,
        registrationDeadline: e?.registration_deadline ?? null,
        examDate: e?.exam_date ?? null,
        positionsCount: e?.positions_count ?? null,
        announcementUrl: cand.url,
        sourceId,
        confidence: 'LOW',
        needsVerification: true,
        contentStatus: 'DRAFT',
      }).returning();

      const draftInfo = { competitionId: edition.id, familySlug: family.slug, at: new Date().toISOString(), by: actorId };
      const [updated] = await tx
        .update(ingestCandidates)
        .set({ extracted: { ...extracted, draft: draftInfo } })
        .where(eq(ingestCandidates.id, id))
        .returning();
      await tx.insert(auditLogs).values({ actorId, action: 'ingest.draft', entityType: 'ingest_candidate', entityId: id, diff: draftInfo });
      return {
        candidate: toCandidateDTO(updated, null),
        competition: {
          id: edition.id, familySlug: family.slug, year: edition.year, status: edition.status, contentStatus: edition.contentStatus,
          needsVerification: edition.needsVerification, confidence: edition.confidence, registrationOpen: edition.registrationOpen,
          registrationDeadline: edition.registrationDeadline, examDate: edition.examDate, positionsCount: edition.positionsCount,
          announcementUrl: edition.announcementUrl, sourceId,
        },
      };
    });
  }

  async ignore(id: string, actorId: string): Promise<CandidateDTO> {
    const [row] = await this.db
      .update(ingestCandidates)
      .set({ status: 'IGNORED' })
      .where(and(eq(ingestCandidates.id, id), ne(ingestCandidates.status, 'DRAFTED')))
      .returning();
    if (!row) {
      const [exists] = await this.db.select({ id: ingestCandidates.id }).from(ingestCandidates).where(eq(ingestCandidates.id, id)).limit(1);
      throw exists ? new ConflictException('ALREADY_DRAFTED') : new NotFoundException('NOT_FOUND');
    }
    await this.audit.log(actorId, 'ingest.ignore', 'ingest_candidate', id);
    return toCandidateDTO(row, null);
  }

  // ───────────── Helpers ─────────────

  private async assertFamily(slug: string, Err: typeof BadRequestException | typeof NotFoundException) {
    const [f] = await this.db.select({ id: competitionFamilies.id, slug: competitionFamilies.slug }).from(competitionFamilies).where(eq(competitionFamilies.slug, slug)).limit(1);
    if (!f) throw new Err('FAMILY_NOT_FOUND');
    return f;
  }

  private async familyKeywords(): Promise<FamilyKeywords[]> {
    return this.db
      .select({ slug: competitionFamilies.slug, nameAr: competitionFamilies.nameAr, nameFr: competitionFamilies.nameFr, keywords: competitionFamilies.keywords })
      .from(competitionFamilies);
  }

  /** In-app + push note to editors/admins: new announcements wait for review (that review is what triggers user alerts). */
  private async notifyStaff(created: number): Promise<void> {
    if (!this.notifications) return;
    try {
      const staff = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.role, ['ADMIN', 'EDITOR']), eq(users.isGuest, false), isNull(users.deletedAt)));
      if (!staff.length) return;
      await this.notifications.notifyMany(staff.map((s) => s.id), {
        type: 'SYSTEM',
        title: 'إعلانات مناظرات جديدة للمراجعة · Nouvelles annonces à vérifier',
        body: `${created} إعلان(ات) جديد(ة) رصدها المراقب الآلي. راجعها وانشرها لتنبيه المترشحين المعنيين. · ${created} nouvelle(s) annonce(s) détectée(s) : vérifiez-les et publiez-les pour alerter les candidats concernés.`,
        url: '/admin/ingest',
        data: { kind: 'INGEST_CANDIDATES', count: created },
        dedupeKey: `ingest:${tunisToday()}:${new Date().getUTCHours()}`,
        channels: ['IN_APP', 'PUSH'],
      });
    } catch (e) {
      this.logger.warn(`staff notification failed: ${(e as Error).message}`);
    }
  }

  private snapshotPath(id: string): string {
    return resolve(env().UPLOAD_DIR, 'watch', `${id}.txt`);
  }

  private async readSnapshot(id: string): Promise<string | null> {
    try {
      return await readFile(this.snapshotPath(id), 'utf8');
    } catch {
      return null;
    }
  }

  private async writeSnapshot(id: string, text: string): Promise<void> {
    await mkdir(resolve(env().UPLOAD_DIR, 'watch'), { recursive: true });
    await writeFile(this.snapshotPath(id), text, 'utf8');
  }
}

function toWatchDTO(w: typeof watchedSources.$inferSelect, newCandidates: number): WatchedSourceDTO {
  return {
    id: w.id, url: w.url, label: w.label, familySlug: w.familySlug, active: w.active,
    lastCheckedAt: w.lastCheckedAt?.toISOString() ?? null, lastError: w.lastError, createdAt: w.createdAt.toISOString(),
    newCandidates: Number(newCandidates),
  };
}

function toCandidateDTO(c: typeof ingestCandidates.$inferSelect, label: string | null): CandidateDTO {
  return {
    id: c.id, watchedSourceId: c.watchedSourceId, watchedSourceLabel: label, url: c.url, title: c.title, rawText: c.rawText,
    familySlugGuess: c.familySlugGuess, extracted: c.extracted, status: c.status, detectedAt: c.detectedAt.toISOString(),
  };
}

const yearOf = (iso: string | null | undefined): number | null => (iso ? Number(iso.slice(0, 4)) : null);

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function describeFetchError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'TIMEOUT (15 s)';
  const cause = err?.cause?.code ?? err?.cause?.message;
  return `${err?.message ?? String(e)}${cause ? ` (${cause})` : ''}`.slice(0, 500);
}

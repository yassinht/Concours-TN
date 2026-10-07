import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { CONFIDENCES, DIPLOMA_LEVELS, SOURCE_TYPES, type Confidence, type DiplomaLevel, type EditionStatus, type SourceType } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import { competitionFamilies, competitions, ingestCandidates, positions, sources } from '../schema';
import { upsertEdition } from './competitions';
import { errorMessage, type SeedLog } from './log';
import { InvalidItem, arr, bool, intIn, isHttpUrl, isObj, isoDate, oneOf, oneOfOrNull, str, strArr } from './normalize';
import { upsertSource } from './sources';
import type { Db } from './types';

const CTX = 'competitions/_openings.json';

/**
 * Recent openings found by the research team (press relays of official notices).
 * Items whose family is known become editions (OPEN while registration runs, so alert matching picks them up);
 * the others go to the admin ingestion queue (ingest_candidates) instead of being dropped.
 */
export async function seedOpenings(db: Db, data: unknown, log: SeedLog): Promise<void> {
  if (data == null) return;
  const warn = log.scoped(CTX);
  if (!isObj(data)) {
    warn('not an object — skipped');
    return;
  }
  const today = tunisToday();
  const generatedAt = isoDate(data.generated_at) ?? today;

  const famRows = await db.select({ id: competitionFamilies.id, slug: competitionFamilies.slug }).from(competitionFamilies);
  const families = new Map(famRows.map((f) => [f.slug, f.id]));
  const posRows = await db.select({ familyId: positions.familyId, slug: positions.slug, diplomaLevel: positions.diplomaLevel }).from(positions);

  for (const [i, raw] of arr(data.items).entries()) {
    try {
      if (!isObj(raw)) throw new InvalidItem('item is not an object');
      const titleFr = str(raw.title_fr);
      const titleAr = str(raw.title_ar);
      const title = titleFr ?? titleAr;
      if (!title) throw new InvalidItem('missing title');
      const rawUrl = str(raw.url);
      const url = isHttpUrl(rawUrl) ? rawUrl : null;
      const deadline = isoDate(raw.registration_deadline, warn, 'registration_deadline');
      const examDate = isoDate(raw.exam_date, warn, 'exam_date');
      const slug = str(raw.family_slug_guess);
      const familyId = slug ? families.get(slug) : undefined;
      const digest = createHash('sha256').update(`${url ?? ''}|${title}`).digest('hex');

      if (!familyId) {
        await db
          .insert(ingestCandidates)
          .values({
            url, title, sha256: digest, familySlugGuess: slug,
            rawText: [titleAr, titleFr, str(raw.organization)].filter(Boolean).join('\n'),
            extracted: { ...raw, origin: 'research_openings', generated_at: generatedAt },
          })
          .onConflictDoNothing();
        log.inc('openings.toIngestQueue');
        continue;
      }

      const seedKey = `${slug}:opening:${digest.slice(0, 16)}`;
      // Queued by an earlier run while its family was unknown: now handled by the catalog, so leave the admin queue.
      await db
        .update(ingestCandidates)
        .set({ status: 'DRAFTED' })
        .where(and(eq(ingestCandidates.sha256, digest), eq(ingestCandidates.status, 'NEW')));
      const sessionLabel = titleFr && titleAr ? `${titleAr} / ${titleFr}` : title;
      if (deadline || examDate) {
        // A research file may already describe this session — in the guessed family (same deadline or exam date), or in
        // another family when the guess was wrong (same deadline and exam date): keep that richer, better-sourced record.
        const sameFamily = and(
          eq(competitions.familyId, familyId),
          or(deadline ? eq(competitions.registrationDeadline, deadline) : undefined, examDate ? eq(competitions.examDate, examDate) : undefined),
        );
        const otherFamily = deadline && examDate
          ? and(eq(competitions.registrationDeadline, deadline), eq(competitions.examDate, examDate))
          : undefined;
        const [dup] = await db
          .select({ id: competitions.id })
          .from(competitions)
          .where(and(ne(sql`coalesce(${competitions.sessionLabel}, '')`, sessionLabel), or(sameFamily, otherFamily)))
          .limit(1);
        if (dup) {
          // Self-heal: drop the copy an earlier run created from this opening (only if no alert went out for it).
          await db
            .delete(competitions)
            .where(and(
              eq(competitions.familyId, familyId), eq(competitions.sessionLabel, sessionLabel), isNull(competitions.alertsSentAt),
              inArray(competitions.sourceId, db.select({ id: sources.id }).from(sources).where(eq(sources.seedKey, seedKey))),
            ));
          log.inc('openings.alreadyKnown');
          continue;
        }
      }

      const status: EditionStatus = deadline
        ? deadline >= today ? 'OPEN' : examDate && examDate < today ? 'EXAM_DONE' : 'CLOSED'
        : examDate && examDate >= today ? 'ANNOUNCED' : examDate ? 'EXAM_DONE' : 'CLOSED';
      const year = Number((deadline ?? examDate ?? generatedAt).slice(0, 4));
      const confidence = oneOf<Confidence>(raw.confidence, CONFIDENCES, 'LOW', warn, 'confidence');
      const sourceType = oneOf<SourceType>(raw.source_type, SOURCE_TYPES, 'SECONDARY', warn, 'source_type');
      const source = await upsertSource(db, seedKey, {
        title, url, publisher: str(raw.organization), sourceType, publicationDate: null, retrievedAt: generatedAt, confidence,
        notes: 'Relevé des ouvertures (_openings.json) — à recouper avec l’avis officiel.',
      });

      // Narrow the edition to the family's positions at the announced diploma level(s), when they match.
      const levels = strArr(raw.diploma_levels).map((d) => oneOfOrNull<DiplomaLevel>(d, DIPLOMA_LEVELS)).filter((d): d is DiplomaLevel => !!d);
      const positionSlugs = posRows.filter((p) => p.familyId === familyId && levels.includes(p.diplomaLevel)).map((p) => p.slug);

      const r = await upsertEdition(db, familyId, {
        year,
        sessionLabel,
        status,
        registrationOpen: isoDate(raw.registration_open),
        registrationDeadline: deadline,
        examDate,
        positionsCount: intIn(raw.positions_count, 0, 1_000_000, warn, 'positions_count'),
        candidatesCount: null,
        positionSlugs,
        announcementUrl: url,
        sourceId: source.id,
        confidence,
        needsVerification: bool(raw.needs_verification, true),
      });
      log.inc(r.created ? 'created.editions' : 'updated.editions');
      log.inc(`openings.${status}`);
    } catch (e) {
      warn(`opening #${i + 1} skipped (${errorMessage(e)})`);
      log.inc('skipped.openings');
    }
  }
}

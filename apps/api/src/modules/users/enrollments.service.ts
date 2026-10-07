import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { EnrollmentInput, Field } from '@ctn/shared';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import { competitionFamilies, competitions, enrollments, follows, positions } from '../../db/schema';
import { tunisToday } from '../../common/dates';
import { AlertsTrigger } from '../auth/alerts-trigger.service';
import { isRealIsoDate, UUID_RE, type Tx } from '../auth/auth.util';

export interface EnrollmentDTO {
  id: string;
  familySlug: string;
  familyName_ar: string;
  familyName_fr: string;
  positionSlug: string | null;
  positionTitle_ar: string | null;
  positionTitle_fr: string | null;
  targetExamDate: string | null;
  dailyMinutes: number;
  isPrimary: boolean;
}

/** POST body: same as EnrollmentInput, but an omitted dailyMinutes must not reset an existing enrollment to 30. */
export type EnrollmentUpsert = Omit<EnrollmentInput, 'dailyMinutes'> & { dailyMinutes?: number };

const enrollmentColumns = {
  id: enrollments.id,
  familySlug: competitionFamilies.slug,
  familyName_ar: competitionFamilies.nameAr,
  familyName_fr: competitionFamilies.nameFr,
  positionSlug: positions.slug,
  positionTitle_ar: positions.titleAr,
  positionTitle_fr: positions.titleFr,
  targetExamDate: enrollments.targetExamDate,
  dailyMinutes: enrollments.dailyMinutes,
  isPrimary: enrollments.isPrimary,
};

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly alerts: AlertsTrigger,
  ) {}

  // ───────────── Enrollments ─────────────

  async list(userId: string): Promise<EnrollmentDTO[]> {
    return this.db
      .select(enrollmentColumns)
      .from(enrollments)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, enrollments.familyId))
      .leftJoin(positions, eq(positions.id, enrollments.positionId))
      .where(eq(enrollments.userId, userId))
      .orderBy(desc(enrollments.isPrimary), asc(enrollments.createdAt));
  }

  private async getOne(userId: string, id: string): Promise<EnrollmentDTO> {
    const [row] = await this.db
      .select(enrollmentColumns)
      .from(enrollments)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, enrollments.familyId))
      .leftJoin(positions, eq(positions.id, enrollments.positionId))
      .where(and(eq(enrollments.id, id), eq(enrollments.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('NOT_FOUND');
    return row;
  }

  /**
   * Upsert by (user, family). Also follows the family (deadline reminders + concours alerts) and, for a new enrollment,
   * re-runs alert matching so an already-open edition of that family shows up immediately.
   */
  async upsert(userId: string, input: EnrollmentUpsert): Promise<EnrollmentDTO> {
    const family = await this.publishedFamily(input.familySlug);
    const positionId = await this.resolvePosition(family.id, input.positionSlug);
    if (input.targetExamDate && !isRealIsoDate(input.targetExamDate)) {
      throw new BadRequestException({ message: 'VALIDATION_FAILED', issues: [{ path: ['targetExamDate'], message: 'invalid date' }] });
    }

    const [existing] = await this.db
      .select({ id: enrollments.id, isPrimary: enrollments.isPrimary })
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.familyId, family.id)))
      .limit(1);

    // New enrollment without a date: prefill with the announced exam date (the user can change it).
    const targetExamDate = input.targetExamDate !== undefined ? input.targetExamDate : existing ? undefined : await this.announcedExamDate(family.id);

    const id = await this.db.transaction(async (tx) => {
      const [otherPrimary] = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(eq(enrollments.userId, userId), eq(enrollments.isPrimary, true), ne(enrollments.familyId, family.id)))
        .limit(1);
      const isPrimary = input.isPrimary ?? (existing ? existing.isPrimary : !otherPrimary);
      if (isPrimary) {
        await tx
          .update(enrollments)
          .set({ isPrimary: false })
          .where(and(eq(enrollments.userId, userId), ne(enrollments.familyId, family.id), eq(enrollments.isPrimary, true)));
      }
      const set: Partial<typeof enrollments.$inferInsert> = { isPrimary };
      if (positionId !== undefined) set.positionId = positionId;
      if (targetExamDate !== undefined) set.targetExamDate = targetExamDate;
      if (input.dailyMinutes !== undefined) set.dailyMinutes = input.dailyMinutes;
      const [row] = await tx
        .insert(enrollments)
        .values({
          userId,
          familyId: family.id,
          positionId: positionId ?? null,
          targetExamDate: targetExamDate ?? null,
          dailyMinutes: input.dailyMinutes ?? 30,
          isPrimary,
        })
        .onConflictDoUpdate({ target: [enrollments.userId, enrollments.familyId], set })
        .returning({ id: enrollments.id });
      await tx.insert(follows).values({ userId, familyId: family.id }).onConflictDoNothing();
      await this.ensurePrimary(tx, userId);
      return row.id;
    });

    if (!existing) await this.alerts.run(userId, 'enrollment');
    return this.getOne(userId, id);
  }

  async patch(userId: string, id: string, input: Partial<EnrollmentInput>): Promise<EnrollmentDTO> {
    if (!UUID_RE.test(id)) throw new NotFoundException('NOT_FOUND');
    const current = await this.getOne(userId, id);
    if (input.familySlug !== undefined && input.familySlug !== current.familySlug) {
      throw new BadRequestException({ message: 'VALIDATION_FAILED', issues: [{ path: ['familySlug'], message: 'family cannot be changed' }] });
    }
    return this.upsert(userId, { ...input, familySlug: current.familySlug });
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    if (!UUID_RE.test(id)) throw new NotFoundException('NOT_FOUND');
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(enrollments)
        .where(and(eq(enrollments.id, id), eq(enrollments.userId, userId)))
        .returning({ id: enrollments.id });
      if (!deleted.length) throw new NotFoundException('NOT_FOUND');
      await this.ensurePrimary(tx, userId);
    });
    return { ok: true };
  }

  /** Exactly one primary enrollment whenever the user has any (the most recent one is promoted). */
  private async ensurePrimary(tx: Tx, userId: string) {
    await tx.execute(sql`
      update enrollments set is_primary = true
      where id = (select id from enrollments where user_id = ${userId} order by created_at desc limit 1)
        and not exists (select 1 from enrollments where user_id = ${userId} and is_primary)`);
  }

  /** Earliest upcoming exam date of an officially announced edition (EXPECTED editions are guesses, not used). */
  private async announcedExamDate(familyId: string): Promise<string | null> {
    const [ed] = await this.db
      .select({ examDate: competitions.examDate })
      .from(competitions)
      .where(
        and(
          eq(competitions.familyId, familyId),
          inArray(competitions.status, ['ANNOUNCED', 'OPEN', 'CLOSED']),
          eq(competitions.contentStatus, 'PUBLISHED'),
          gte(competitions.examDate, tunisToday()),
        ),
      )
      .orderBy(asc(competitions.examDate))
      .limit(1);
    return ed?.examDate ?? null;
  }

  // ───────────── Follows ─────────────

  async listFollows(userId: string): Promise<{ familySlug: string; familyName_ar: string; familyName_fr: string; field: Field; followedAt: Date }[]> {
    return this.db
      .select({
        familySlug: competitionFamilies.slug,
        familyName_ar: competitionFamilies.nameAr,
        familyName_fr: competitionFamilies.nameFr,
        field: competitionFamilies.field,
        followedAt: follows.createdAt,
      })
      .from(follows)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, follows.familyId))
      .where(eq(follows.userId, userId))
      .orderBy(desc(follows.createdAt));
  }

  async follow(userId: string, familySlug: string): Promise<{ ok: true }> {
    const family = await this.publishedFamily(familySlug);
    const inserted = await this.db
      .insert(follows)
      .values({ userId, familyId: family.id })
      .onConflictDoNothing()
      .returning({ familyId: follows.familyId });
    // Following a family opts into its alerts: surface an already-open matching edition right away.
    if (inserted.length) await this.alerts.run(userId, 'follow');
    return { ok: true };
  }

  async unfollow(userId: string, familySlug: string): Promise<{ ok: true }> {
    const [family] = await this.db
      .select({ id: competitionFamilies.id })
      .from(competitionFamilies)
      .where(eq(competitionFamilies.slug, familySlug))
      .limit(1);
    if (!family) throw new NotFoundException('NOT_FOUND');
    await this.db.delete(follows).where(and(eq(follows.userId, userId), eq(follows.familyId, family.id)));
    return { ok: true };
  }

  // ───────────── Lookups ─────────────

  private async publishedFamily(slug: string): Promise<{ id: string }> {
    const [f] = await this.db
      .select({ id: competitionFamilies.id })
      .from(competitionFamilies)
      .where(and(eq(competitionFamilies.slug, slug), eq(competitionFamilies.status, 'PUBLISHED')))
      .limit(1);
    if (!f) throw new NotFoundException('NOT_FOUND');
    return f;
  }

  /** undefined = leave unchanged, null = clear, otherwise the id of that position within the family. */
  private async resolvePosition(familyId: string, positionSlug: string | null | undefined): Promise<string | null | undefined> {
    if (positionSlug === undefined || positionSlug === null) return positionSlug;
    const [p] = await this.db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.familyId, familyId), eq(positions.slug, positionSlug), eq(positions.status, 'PUBLISHED')))
      .limit(1);
    if (!p) throw new NotFoundException('NOT_FOUND');
    return p.id;
  }
}

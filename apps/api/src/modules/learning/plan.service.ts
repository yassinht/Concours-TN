import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  START_RATING, XP, buildDailyPlan, shrunkMastery, type Domain, type Locale, type PlanItem, type PlanTopic, type TodayPlanDTO,
} from '@ctn/shared';
import { daysBetween, tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { attempts, competitionFamilies, enrollments, mastery, studyPlanDays, users } from '../../db/schema';
import { VISIBLE_STATUSES, inList, servableQuestionStatuses } from '../catalog/catalog.util';
import { GamificationService } from '../gamification/gamification.service';
import { CurriculumService, planWeights, type FamilyRef } from './curriculum.service';

const DEFAULT_DAILY_MINUTES = 30;
const DAY_MS = 86_400_000;

/** Item as persisted in study_plan_days.items (a PlanItem plus bilingual titles and the family it was built for). */
export interface StoredPlanItem extends PlanItem {
  title_ar: string;
  title_fr: string;
  topicKey?: string;
  familyId: string | null;
}

export type PlanItemDTO = Omit<StoredPlanItem, 'familyId'> & { done: boolean };

interface EnrollmentRef {
  id: string;
  familyId: string;
  positionId: string | null;
  targetExamDate: string | null;
  dailyMinutes: number;
}

interface Target {
  family: FamilyRef | null;
  enrollment: EnrollmentRef | null;
}

interface PlanRow {
  enrollmentId: string | null;
  items: StoredPlanItem[];
  completed: number[];
}

const enrollmentColumns = {
  id: enrollments.id,
  familyId: enrollments.familyId,
  positionId: enrollments.positionId,
  targetExamDate: enrollments.targetExamDate,
  dailyMinutes: enrollments.dailyMinutes,
};

const FIXED_TITLES: Record<'MOCK' | 'MISTAKES' | 'REVIEW', { ar: string; fr: string }> = {
  MOCK: { ar: 'امتحان تجريبي كامل', fr: 'Examen blanc complet' },
  MISTAKES: { ar: 'مراجعة أخطائي', fr: 'Revoir mes erreurs' },
  REVIEW: { ar: 'مراجعة متباعدة', fr: 'Révision espacée' },
};

/** Defensive read of the `completed` jsonb column (array of item indices). */
export function asIndexList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is number => Number.isInteger(x) && x >= 0))].sort((a, b) => a - b);
}

function asItems(v: unknown): StoredPlanItem[] {
  return Array.isArray(v) ? (v as StoredPlanItem[]).filter((i) => i && typeof i === 'object' && typeof i.kind === 'string') : [];
}

/** 0 = Sunday, for a YYYY-MM-DD date (calendar date, no time zone involved). */
export function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

/**
 * Items completed by today's activity, so users don't have to tick them by hand:
 * PRACTICE → enough answers today on that topic (outside review sessions); MISTAKES then REVIEW → answers in REVIEW sessions
 * (consumed in plan order); MOCK → a mock submitted today. LESSON items are ticked manually.
 */
export function detectDone(
  items: Pick<PlanItem, 'kind' | 'topicId' | 'questions'>[],
  activity: { byTopic: Map<string, number>; reviewAnswers: number; mockSubmitted: boolean },
): Set<number> {
  const done = new Set<number>();
  let reviewPool = activity.reviewAnswers;
  items.forEach((item, i) => {
    const need = Math.max(1, item.questions ?? 1);
    switch (item.kind) {
      case 'PRACTICE':
        if (item.topicId && (activity.byTopic.get(item.topicId) ?? 0) >= need) done.add(i);
        break;
      case 'MISTAKES':
      case 'REVIEW':
        if (reviewPool >= need) done.add(i);
        reviewPool = Math.max(0, reviewPool - need);
        break;
      case 'MOCK':
        if (activity.mockSubmitted) done.add(i);
        break;
      default:
        break;
    }
  });
  return done;
}

@Injectable()
export class PlanService {
  private readonly logger = new Logger('StudyPlan');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly curriculum: CurriculumService,
    private readonly gamification: GamificationService,
  ) {}

  /**
   * Today's plan (Africa/Tunis day), generated once and stored. It is rebuilt when it targets another family/enrollment
   * than requested, or is empty — but never once an item is done, so progress is not lost by browsing another family.
   */
  async today(userId: string, familySlug?: string): Promise<TodayPlanDTO> {
    const today = tunisToday();
    const target = await this.resolveTarget(userId, familySlug);
    const stored = await this.load(userId, today);
    if (stored && !this.needsRebuild(stored, target)) {
      const ctx = this.sameTarget(stored, target) ? target : await this.contextOf(userId, stored);
      return this.present(userId, today, stored, ctx.family, ctx.enrollment);
    }
    const items = await this.generate(userId, target, today);
    const saved = await this.save(userId, today, target.enrollment?.id ?? null, items, !!stored);
    if (this.sameTarget(saved, target) || !saved.items.length) return this.present(userId, today, saved, target.family, target.enrollment);
    // Lost a race against a request that already made progress on another plan: show that one.
    const ctx = await this.contextOf(userId, saved);
    return this.present(userId, today, saved, ctx.family, ctx.enrollment);
  }

  /** Marks item `index` of today's plan done (idempotent); awards DAILY_GOAL XP once when the whole plan is done. */
  async markDone(userId: string, index: number): Promise<TodayPlanDTO> {
    const today = tunisToday();
    let row = await this.load(userId, today);
    let ctx: Target;
    if (!row) {
      ctx = await this.resolveTarget(userId);
      row = await this.save(userId, today, ctx.enrollment?.id ?? null, await this.generate(userId, ctx, today), false);
    } else {
      ctx = await this.contextOf(userId, row);
    }
    if (index >= row.items.length) throw new NotFoundException('NOT_FOUND');
    const r = await this.complete(userId, today, [index]);
    if (r?.becameComplete) await this.awardDailyGoal(userId, ctx.family?.id ?? null);
    const fresh = (await this.load(userId, today)) ?? row;
    return this.present(userId, today, fresh, ctx.family, ctx.enrollment);
  }

  // ───────────── Target resolution ─────────────

  private async resolveTarget(userId: string, familySlug?: string): Promise<Target> {
    if (familySlug) {
      const family = await this.curriculum.familyBySlug(familySlug);
      if (!family) throw new NotFoundException('NOT_FOUND');
      return { family, enrollment: await this.enrollmentFor(userId, family.id) };
    }
    const [primary] = await this.db
      .select({ ...enrollmentColumns, slug: competitionFamilies.slug })
      .from(enrollments)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, enrollments.familyId))
      .where(and(eq(enrollments.userId, userId), inArray(competitionFamilies.status, VISIBLE_STATUSES)))
      .orderBy(desc(enrollments.isPrimary), asc(enrollments.createdAt))
      .limit(1);
    if (primary) {
      const { slug, ...enrollment } = primary;
      return { family: { id: primary.familyId, slug }, enrollment };
    }
    // Not enrolled yet (typically a guest who just took a diagnostic): plan for the family they last practised.
    const [last] = await this.db
      .select({ id: competitionFamilies.id, slug: competitionFamilies.slug })
      .from(attempts)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, attempts.familyId))
      .where(and(eq(attempts.userId, userId), isNotNull(attempts.familyId), inArray(competitionFamilies.status, VISIBLE_STATUSES)))
      .orderBy(desc(attempts.startedAt))
      .limit(1);
    return { family: last ?? null, enrollment: null };
  }

  private async enrollmentFor(userId: string, familyId: string): Promise<EnrollmentRef | null> {
    const [e] = await this.db
      .select(enrollmentColumns)
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.familyId, familyId)))
      .limit(1);
    return e ?? null;
  }

  /** Family/enrollment a stored plan was built for. */
  private async contextOf(userId: string, row: PlanRow): Promise<Target> {
    let enrollment: EnrollmentRef | null = null;
    if (row.enrollmentId) {
      const [e] = await this.db
        .select(enrollmentColumns)
        .from(enrollments)
        .where(and(eq(enrollments.id, row.enrollmentId), eq(enrollments.userId, userId)))
        .limit(1);
      enrollment = e ?? null;
    }
    const familyId = row.items.find((i) => i.familyId)?.familyId ?? enrollment?.familyId ?? null;
    return { family: familyId ? await this.curriculum.familyById(familyId) : null, enrollment };
  }

  private planFamilyId(row: PlanRow): string | null {
    return row.items.find((i) => i.familyId)?.familyId ?? null;
  }

  private sameTarget(row: PlanRow, target: Target): boolean {
    return (row.enrollmentId ?? null) === (target.enrollment?.id ?? null) && this.planFamilyId(row) === (target.family?.id ?? null);
  }

  private needsRebuild(row: PlanRow, target: Target): boolean {
    if (row.completed.length) return false;
    return !row.items.length || !this.sameTarget(row, target);
  }

  // ───────────── Generation ─────────────

  private async generate(userId: string, target: Target, today: string): Promise<StoredPlanItem[]> {
    const now = Date.now();
    const familyId = target.family?.id ?? null;
    let topics: PlanTopic[] = [];
    const topicMeta = new Map<string, { key: string; ar: string; fr: string }>();
    let daysToExam: number | null = null;
    let hasBlueprint = false;

    if (familyId) {
      const [familyTopics, format] = await Promise.all([this.curriculum.topics(familyId), this.curriculum.examFormat(userId, familyId)]);
      hasBlueprint = !!format.blueprintId;
      const { weights } = planWeights(format, familyTopics);
      const total = weights.reduce((a, w) => a + w.weight, 0) || 1;
      const share = new Map<Domain, number>(weights.map((w) => [w.domain, w.weight / total]));
      const inExam = familyTopics.filter((t) => share.has(t.domain));
      // Only topics that can actually be practised: a plan item must never lead to an empty session.
      const counts = await this.curriculum.servableQuestionCounts(familyId, inExam.map((t) => t.id));
      const practicable = inExam.filter((t) => (counts.get(t.id) ?? 0) > 0);
      const rows = practicable.length
        ? await this.db
          .select({ nodeId: mastery.nodeId, rating: mastery.rating, attempts: mastery.attempts, lastSeenAt: mastery.lastSeenAt, nextReviewAt: mastery.nextReviewAt })
          .from(mastery)
          .where(and(eq(mastery.userId, userId), inArray(mastery.nodeId, practicable.map((t) => t.id))))
        : [];
      const byNode = new Map(rows.map((r) => [r.nodeId, r]));
      topics = practicable.map((t) => {
        topicMeta.set(t.id, { key: t.key, ar: t.titleAr, fr: t.titleFr });
        const m = byNode.get(t.id);
        const seen = m && m.attempts > 0 ? m : null;
        return {
          topicId: t.id,
          domain: t.domain,
          title: t.titleFr,
          examWeight: share.get(t.domain) ?? 0,
          mastery: seen ? shrunkMastery(seen.rating, seen.attempts) : shrunkMastery(START_RATING, 0),
          dueForReview: !!seen?.nextReviewAt && seen.nextReviewAt.getTime() <= now,
          daysSinceSeen: seen?.lastSeenAt ? Math.max(0, Math.floor((now - seen.lastSeenAt.getTime()) / DAY_MS)) : null,
        };
      });
      daysToExam = await this.daysToExam(target, familyId, today);
    }

    const raw = buildDailyPlan({
      topics,
      dailyMinutes: target.enrollment?.dailyMinutes ?? DEFAULT_DAILY_MINUTES,
      daysToExam,
      dayOfWeek: dayOfWeek(today),
      mistakesPending: await this.mistakesPending(userId, today),
    });

    const lessonTopics = raw.filter((i) => i.kind === 'LESSON' && i.topicId).map((i) => i.topicId!);
    const withLesson = await this.curriculum.topicsWithLessons(lessonTopics);
    return raw
      // A mock needs a blueprint; a lesson item needs a lesson to open.
      .filter((i) => (i.kind !== 'MOCK' || hasBlueprint) && (i.kind !== 'LESSON' || (!!i.topicId && withLesson.has(i.topicId))))
      .map((i): StoredPlanItem => {
        const meta = i.topicId ? topicMeta.get(i.topicId) : undefined;
        const titles = meta ? { ar: meta.ar, fr: meta.fr } : FIXED_TITLES[i.kind as keyof typeof FIXED_TITLES] ?? { ar: i.title, fr: i.title };
        return { ...i, title: titles.fr, title_ar: titles.ar, title_fr: titles.fr, ...(meta ? { topicKey: meta.key } : {}), familyId };
      });
  }

  private async daysToExam(target: Target, familyId: string, today: string): Promise<number | null> {
    const own = target.enrollment?.targetExamDate;
    const date = own && own >= today ? own : await this.curriculum.nextExamDate(familyId, today);
    return date ? daysBetween(today, date) : null;
  }

  /** Wrong-answer questions waiting for review (same rule as REVIEW sessions), still servable. */
  private async mistakesPending(userId: string, today: string): Promise<number> {
    const res = await this.db.execute<{ n: number }>(sql`
      select count(*)::int as n from user_question_state s
      join questions q on q.id = s.question_id
      where s.user_id = ${userId} and s.times_wrong > 0
        and (s.last_correct = false or s.next_review_at <= now())
        and q.status in ${inList(servableQuestionStatuses())}
        and (q.valid_until is null or q.valid_until >= ${today})`);
    return Number(res.rows[0]?.n ?? 0);
  }

  // ───────────── Persistence ─────────────

  private async load(userId: string, date: string): Promise<PlanRow | null> {
    const [row] = await this.db
      .select({ enrollmentId: studyPlanDays.enrollmentId, items: studyPlanDays.items, completed: studyPlanDays.completed })
      .from(studyPlanDays)
      .where(and(eq(studyPlanDays.userId, userId), eq(studyPlanDays.date, date)))
      .limit(1);
    return row ? { enrollmentId: row.enrollmentId, items: asItems(row.items), completed: asIndexList(row.completed) } : null;
  }

  /** Insert (or replace a plan without progress); on a lost race, returns whatever is stored. */
  private async save(userId: string, date: string, enrollmentId: string | null, items: StoredPlanItem[], replace: boolean): Promise<PlanRow> {
    if (replace) {
      await this.db
        .update(studyPlanDays)
        .set({ enrollmentId, items, completed: [] })
        .where(and(eq(studyPlanDays.userId, userId), eq(studyPlanDays.date, date), sql`jsonb_array_length(${studyPlanDays.completed}) = 0`));
    } else {
      await this.db.insert(studyPlanDays).values({ userId, date, enrollmentId, items, completed: [] }).onConflictDoNothing();
    }
    return (await this.load(userId, date)) ?? { enrollmentId, items, completed: [] };
  }

  /** Adds indices to `completed` under a row lock; reports the transition to "all items done" exactly once. */
  private async complete(userId: string, date: string, indices: number[]): Promise<{ completed: number[]; becameComplete: boolean } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ items: studyPlanDays.items, completed: studyPlanDays.completed })
        .from(studyPlanDays)
        .where(and(eq(studyPlanDays.userId, userId), eq(studyPlanDays.date, date)))
        .for('update');
      if (!row) return null;
      const count = asItems(row.items).length;
      const before = asIndexList(row.completed).filter((i) => i < count);
      const after = [...new Set([...before, ...indices.filter((i) => i < count)])].sort((a, b) => a - b);
      if (after.length === before.length) return { completed: before, becameComplete: false };
      await tx
        .update(studyPlanDays)
        .set({ completed: after })
        .where(and(eq(studyPlanDays.userId, userId), eq(studyPlanDays.date, date)));
      return { completed: after, becameComplete: count > 0 && before.length < count && after.length === count };
    });
  }

  private async awardDailyGoal(userId: string, familyId: string | null): Promise<void> {
    try {
      await this.gamification.awardXp(userId, XP.DAILY_GOAL, 'DAILY_GOAL', familyId);
    } catch (e) {
      this.logger.warn(`DAILY_GOAL XP not awarded to ${userId}: ${(e as Error).message}`);
    }
  }

  // ───────────── Presentation ─────────────

  private async todayActivity(userId: string, today: string, familyId: string | null) {
    const [answers, mocks] = await Promise.all([
      this.db.execute<{ topic_id: string; kind: string; n: number }>(sql`
        select q.topic_id, a.kind::text as kind, count(*)::int as n
        from attempts a
        join attempt_answers aa on aa.attempt_id = a.id
        join questions q on q.id = aa.question_id
        where a.user_id = ${userId}
          and aa.answered_at > now() - interval '2 days'
          and (aa.answered_at at time zone 'Africa/Tunis')::date = ${today}::date
        group by q.topic_id, a.kind`),
      this.db.execute<{ n: number }>(sql`
        select count(*)::int as n from attempts a
        where a.user_id = ${userId} and a.kind = 'MOCK' and a.submitted_at is not null
          and a.submitted_at > now() - interval '2 days'
          and (a.submitted_at at time zone 'Africa/Tunis')::date = ${today}::date
          and (${familyId}::uuid is null or a.family_id = ${familyId}::uuid)`),
    ]);
    const byTopic = new Map<string, number>();
    let reviewAnswers = 0;
    for (const r of answers.rows) {
      if (r.kind === 'REVIEW') reviewAnswers += Number(r.n);
      else byTopic.set(r.topic_id, (byTopic.get(r.topic_id) ?? 0) + Number(r.n));
    }
    return { byTopic, reviewAnswers, mockSubmitted: Number(mocks.rows[0]?.n ?? 0) > 0 };
  }

  private async present(userId: string, today: string, row: PlanRow, family: FamilyRef | null, enrollment: EnrollmentRef | null): Promise<TodayPlanDTO> {
    let completed = new Set(row.completed);
    if (row.items.length) {
      const auto = detectDone(row.items, await this.todayActivity(userId, today, family?.id ?? null));
      const fresh = [...auto].filter((i) => !completed.has(i));
      if (fresh.length) {
        const r = await this.complete(userId, today, fresh);
        if (r) {
          completed = new Set(r.completed);
          if (r.becameComplete) await this.awardDailyGoal(userId, family?.id ?? null);
        }
      }
    }
    const [u] = await this.db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
    const locale: Locale = u?.locale === 'fr' ? 'fr' : 'ar';
    const daysToExam = family ? await this.daysToExam({ family, enrollment }, family.id, today) : null;
    return {
      date: today,
      enrollmentId: row.enrollmentId,
      familySlug: family?.slug ?? null,
      daysToExam,
      items: row.items.map((item, i): PlanItemDTO => {
        const { familyId: _familyId, ...rest } = item;
        return { ...rest, title: locale === 'fr' ? item.title_fr : item.title_ar, done: completed.has(i) };
      }),
    };
  }
}

import {
  BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  DOMAINS, REFERRAL_REWARD_DAYS, XP, gradeAnswer,
  type AnswerFeedbackDTO, type AnswerInput, type AttemptKind, type AttemptResultDTO, type AttemptSessionDTO, type CorrectAnswer,
  type Domain, type ReadinessResult, type StartAttemptInput, type UserAnswer,
} from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  attemptAnswers, attempts, blueprints, competitionFamilies, enrollments, positions, questions, referrals, studyPlanDays,
  syllabusNodes, usageCounters, userQuestionState, users,
} from '../../db/schema';
import { EntitlementsService } from '../billing/entitlements.service';
import { GamificationService } from '../gamification/gamification.service';
import { MasteryService } from '../learning/mastery.service';
import { ReadinessService } from '../learning/readiness.service';
import {
  DIAGNOSTIC_SIZE, EXAM_GRACE_MS, PRACTICE_DEFAULT, PRACTICE_MAX, VISIBLE_NODE_STATUSES, assertUuid, countsTowardLimit,
  isUuid, modeOf, paymentRequired, type AttemptMode,
} from './practice.util';
import { loadQuestionRows, toQuestionDTO, type QuestionRow } from './question.mapper';
import { QuestionPoolService } from './question-pool.service';
import { durationSeconds, percentileOf, summarize, type GradedItem, type ResultSummary } from './result';
import { allocateWithCaps, byDifficulty, difficultyPattern, pickAdaptive, pickBalanced, type Candidate } from './selection';

type AttemptRow = typeof attempts.$inferSelect;
type Fidelity = 'OFFICIAL_FORMAT' | 'APPROXIMATED';

export interface BlueprintSection { domain: Domain; specialtyKey: string | null; count: number; minutes: number }
interface BlueprintInfo { id: string | null; totalMinutes: number; fidelity: Fidelity; sections: BlueprintSection[] }

/** A MOCK section as served: `start`/`end` index the attempt's question list; `served` came from the intended pool. */
export interface SectionMeta extends BlueprintSection { served: number; filled: number; start: number; end: number }

/** Bookkeeping stored in `attempts.result.meta` from the start of an attempt. */
export interface AttemptMeta {
  /** XP already awarded during an instant-feedback attempt. */
  xp?: number;
  totalMinutes?: number | null;
  fidelity?: Fidelity | null;
  sections?: SectionMeta[];
  /** MOCK: questions that had to come from outside their blueprint section (or are missing altogether). */
  shortfall?: number;
  missing?: number;
  scope?: { topicKey?: string; domain?: Domain; topics?: string[] };
}

/** Result fields persisted at submit (the review list is rebuilt from attempt_answers on read). */
export type StoredFinal = Omit<AttemptResultDTO, 'review'> & {
  answeredCount: number;
  avgTimeS: number | null;
  shortfall: number | null;
};

interface StoredResult { meta?: AttemptMeta; final?: StoredFinal }

/** AttemptResultDTO plus a few additive fields the UI can use (answered count, timing, MOCK sections/shortfall). */
export type AttemptResultView = AttemptResultDTO & Omit<StoredFinal, keyof AttemptResultDTO> & { sections?: SectionMeta[] };

export type AttemptSessionView = AttemptSessionDTO & {
  /** Server clock, so the client timer is not fooled by a wrong device clock. */
  serverTime: string;
  sections?: SectionMeta[];
  shortfall?: number;
  /** Instant mode: correctness of the questions already answered (for resuming a session). */
  results?: Record<string, boolean>;
};

export interface AttemptHistoryItem {
  id: string; kind: AttemptKind; familySlug: string | null; score: number | null; total: number; correctCount: number | null;
  startedAt: string; expiresAt: string | null; submittedAt: string | null;
}

interface Plan {
  questionIds: string[];
  familyId: string | null;
  positionId: string | null;
  blueprintId: string | null;
  expiresAt: Date | null;
  meta: AttemptMeta;
}

/** An unsubmitted diagnostic for the same scope is resumed instead of duplicated within this window. */
const DIAGNOSTIC_RESUME_MS = 6 * 3600_000;
/** Size of a synthesized mock when the position has no blueprint (≈1 minute per question). */
const SYNTH_MOCK_SIZE = 40;
const MAX_MOCK_QUESTIONS = 200;
const MOCK_POOL_SAMPLE = 6000;

const metaOf = (a: Pick<AttemptRow, 'result'>): AttemptMeta => ((a.result as StoredResult | null)?.meta ?? {}) as AttemptMeta;
const finalOf = (a: Pick<AttemptRow, 'result'>): StoredFinal | null => (a.result as StoredResult | null)?.final ?? null;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function parseSections(raw: unknown): BlueprintSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s): BlueprintSection[] => {
    const o = (s ?? {}) as Record<string, unknown>;
    const domain = o.domain as Domain;
    const count = Math.floor(Number(o.count) || 0);
    if (!DOMAINS.includes(domain) || count <= 0) return [];
    const specialtyKey = typeof o.specialtyKey === 'string' && o.specialtyKey.trim() ? o.specialtyKey.trim() : null;
    return [{ domain, specialtyKey, count, minutes: Math.max(0, Number(o.minutes) || 0) }];
  });
}

function groupByDomain(cands: readonly Candidate[]): Map<Domain, Candidate[]> {
  const m = new Map<Domain, Candidate[]>();
  for (const c of cands) {
    const l = m.get(c.domain) ?? [];
    l.push(c);
    m.set(c.domain, l);
  }
  return m;
}

/**
 * Attempts: building sessions (DIAGNOSTIC, PRACTICE, DAILY, MOCK, REVIEW), answering, submitting and scoring.
 * Exam-mode attempts (DIAGNOSTIC, MOCK) never expose `correct`/`explanation` before submit.
 */
@Injectable()
export class AttemptsService {
  private readonly logger = new Logger('Practice');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly pool: QuestionPoolService,
    private readonly mastery: MasteryService,
    private readonly readiness: ReadinessService,
    private readonly gamification: GamificationService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ───────────── Start ─────────────

  async start(userId: string, input: StartAttemptInput): Promise<AttemptSessionView> {
    if (countsTowardLimit(input.kind)) await this.assertQuestionsLeft(userId);
    let plan: Plan | AttemptRow;
    switch (input.kind) {
      case 'DIAGNOSTIC':
        plan = await this.planDiagnostic(userId, input);
        break;
      case 'PRACTICE':
        plan = await this.planPractice(userId, input);
        break;
      case 'DAILY':
        plan = await this.planDaily(userId, input);
        break;
      case 'MOCK':
        plan = await this.planMock(userId, input);
        break;
      case 'REVIEW':
        plan = await this.planReview(userId, input);
        break;
      default:
        throw new BadRequestException('VALIDATION_FAILED');
    }
    // A resumable attempt was found instead of a plan.
    if ('userId' in plan) return this.sessionDTO(plan);
    if (!plan.questionIds.length) throw new NotFoundException('NO_QUESTIONS');

    const [row] = await this.db
      .insert(attempts)
      .values({
        userId,
        kind: input.kind,
        familyId: plan.familyId,
        positionId: plan.positionId,
        blueprintId: plan.blueprintId,
        questionIds: plan.questionIds,
        expiresAt: plan.expiresAt,
        result: { meta: plan.meta },
      })
      .returning();
    return this.sessionDTO(row);
  }

  /** Free users with no question left today are told before a session is built (consume() enforces it per answer). */
  private async assertQuestionsLeft(userId: string): Promise<void> {
    try {
      const ent = await this.entitlements.get(userId);
      const limit = ent.limits.questionsPerDay;
      if (limit == null) return;
      const [row] = await this.db
        .select({ n: usageCounters.questions })
        .from(usageCounters)
        .where(and(eq(usageCounters.userId, userId), eq(usageCounters.date, tunisToday())))
        .limit(1);
      if ((row?.n ?? 0) >= limit) throw paymentRequired('LIMIT_REACHED');
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Billing problems never block learning; consume() still runs per answer.
      this.logger.warn(`entitlements pre-check failed for ${userId}: ${(e as Error).message}`);
    }
  }

  private async planDiagnostic(userId: string, input: StartAttemptInput): Promise<Plan | AttemptRow> {
    const familyId = await this.familyIdFor(userId, input.familySlug);
    const resumable = await this.resumableDiagnostic(userId, familyId);
    if (resumable) return resumable;

    const target = familyId ? await this.targetPosition(userId, familyId, input.positionSlug, false) : null;
    const pool = await this.pool.candidates({ userId, familyId });
    const byDomain = groupByDomain(pool);
    const caps = new Map([...byDomain].map(([d, l]) => [d, l.length] as const));

    // Shares: the target position's blueprint, else equal over the family's linked domains, else over what exists.
    let weights: { key: Domain; weight: number }[] = [];
    if (target?.blueprint) {
      const sums = new Map<Domain, number>();
      for (const s of target.blueprint.sections) sums.set(s.domain, (sums.get(s.domain) ?? 0) + s.count);
      weights = [...sums].filter(([d]) => caps.has(d)).map(([key, weight]) => ({ key, weight }));
    }
    if (!weights.length && familyId) {
      const linked = await this.pool.familyDomainWeights(familyId);
      weights = DOMAINS.filter((d) => linked.has(d) && caps.has(d)).map((key) => ({ key, weight: 1 }));
    }
    if (!weights.length) weights = DOMAINS.filter((d) => caps.has(d)).map((key) => ({ key, weight: 1 }));

    const size = Math.min(DIAGNOSTIC_SIZE, pool.length);
    const counts = allocateWithCaps(size, weights, caps);
    const placed = [...counts.values()].reduce((a, b) => a + b, 0);
    if (placed < size) {
      // Weighted domains ran dry: complete with the other domains that have questions.
      const others = DOMAINS.filter((d) => caps.has(d) && !counts.has(d)).map((key) => ({ key, weight: 1 }));
      for (const [d, n] of allocateWithCaps(size - placed, others, caps)) if (n) counts.set(d, n);
      for (const o of others) if (!weights.some((w) => w.key === o.key)) weights.push(o);
    }

    // 25/50/25 difficulty mix inside every domain; the rotating offset keeps small domains from all leaning easy.
    const ordered: Candidate[] = [];
    weights.forEach(({ key }, k) => {
      const n = counts.get(key) ?? 0;
      if (n > 0) ordered.push(...byDifficulty(pickBalanced(byDomain.get(key) ?? [], difficultyPattern(n, k))));
    });
    return {
      questionIds: ordered.map((c) => c.id),
      familyId,
      positionId: target?.positionId ?? null,
      blueprintId: target?.blueprint?.id ?? null,
      expiresAt: null,
      meta: { fidelity: target?.blueprint?.fidelity ?? null, totalMinutes: null },
    };
  }

  private async planPractice(userId: string, input: StartAttemptInput): Promise<Plan> {
    const count = clamp(input.count ?? PRACTICE_DEFAULT, 1, PRACTICE_MAX);
    const explicitFamily = input.familySlug ? await this.familyId(input.familySlug) : null;
    let roots: string[] | null = null;
    if (input.topicKey) {
      const [node] = await this.db
        .select({ id: syllabusNodes.id })
        .from(syllabusNodes)
        .where(and(eq(syllabusNodes.key, input.topicKey), inArray(syllabusNodes.status, VISIBLE_NODE_STATUSES)))
        .limit(1);
      if (!node) throw new NotFoundException('NOT_FOUND');
      roots = [node.id];
    }
    const domains = input.domain ? [input.domain] : null;
    const enrollment = explicitFamily ? null : await this.enrollmentFor(userId, null);
    // Selection scope: explicit family, else the primary enrollment unless an explicit topic was chosen
    // (a douane candidate drilling SPECIALTY must get douane specialty questions, not another corps').
    const scopeFamily = explicitFamily ?? (!roots ? enrollment?.familyId ?? null : null);

    let pool = await this.pool.candidates({ userId, familyId: scopeFamily, topicRootIds: roots, domains });
    if (!pool.length && scopeFamily && !explicitFamily) pool = await this.pool.candidates({ userId, topicRootIds: roots, domains });
    const picked = pickAdaptive(pool, count).sort((a, b) => a.rating - b.rating);
    return {
      questionIds: picked.map((c) => c.id),
      // XP and readiness are attributed to the user's family even for topic/domain drills.
      familyId: explicitFamily ?? enrollment?.familyId ?? null,
      positionId: null,
      blueprintId: null,
      expiresAt: null,
      meta: { scope: { topicKey: input.topicKey, domain: input.domain } },
    };
  }

  private async planDaily(userId: string, input: StartAttemptInput): Promise<Plan> {
    const [plan] = await this.db
      .select({ items: studyPlanDays.items, enrollmentId: studyPlanDays.enrollmentId })
      .from(studyPlanDays)
      .where(and(eq(studyPlanDays.userId, userId), eq(studyPlanDays.date, tunisToday())))
      .limit(1);
    let familyId = input.familySlug ? await this.familyId(input.familySlug) : null;
    if (!familyId && plan?.enrollmentId) {
      const [e] = await this.db
        .select({ familyId: enrollments.familyId })
        .from(enrollments)
        .where(and(eq(enrollments.id, plan.enrollmentId), eq(enrollments.userId, userId)))
        .limit(1);
      familyId = e?.familyId ?? null;
    }
    if (!familyId) familyId = (await this.enrollmentFor(userId, null))?.familyId ?? null;

    const items = Array.isArray(plan?.items) ? (plan.items as { kind?: string; topicId?: unknown; questions?: unknown }[]) : [];
    const refs = [...new Set(items.map((i) => i.topicId).filter((t): t is string => typeof t === 'string' && !!t))];
    const planned = items.filter((i) => i.kind === 'PRACTICE').reduce((a, i) => a + (Number(i.questions) || 0), 0);
    const count = clamp(input.count ?? (planned || PRACTICE_DEFAULT), 1, PRACTICE_MAX);

    let roots = await this.resolveNodeRefs(refs);
    if (!roots.length && familyId) roots = await this.pool.weakestTopicIds(userId, familyId, 3);

    let picked: Candidate[] = [];
    if (roots.length) picked = pickAdaptive(await this.pool.candidates({ userId, familyId, topicRootIds: roots }), count);
    if (picked.length < count) {
      // Thin topics: top up from the family (or the whole general bank).
      const more = await this.pool.candidates({ userId, familyId, excludeIds: picked.map((c) => c.id) });
      picked = [...picked, ...pickAdaptive(more, count - picked.length)];
    }
    return {
      questionIds: picked.sort((a, b) => a.rating - b.rating).map((c) => c.id),
      familyId,
      positionId: null,
      blueprintId: null,
      expiresAt: null,
      meta: { scope: { topics: roots } },
    };
  }

  private async planMock(userId: string, input: StartAttemptInput): Promise<Plan | AttemptRow> {
    const familyId = await this.familyIdFor(userId, input.familySlug);
    if (!familyId) throw new BadRequestException('FAMILY_REQUIRED');
    const target = await this.targetPosition(userId, familyId, input.positionSlug, true);
    const positionId = target?.positionId ?? null;

    const resumable = await this.resumableMock(userId, familyId, positionId);
    if (resumable) return resumable;

    let allowed = true;
    try {
      allowed = await this.entitlements.canStartMock(userId);
    } catch (e) {
      this.logger.warn(`canStartMock failed for ${userId}: ${(e as Error).message}`);
    }
    if (!allowed) throw paymentRequired('PREMIUM_REQUIRED');

    const bp = target?.blueprint ?? (await this.synthesizedBlueprint(familyId));
    if (!bp.sections.length) throw new NotFoundException('NO_QUESTIONS');
    const pool = await this.pool.candidates({ userId, familyId, limit: MOCK_POOL_SAMPLE });

    const chosen = new Set<string>();
    const free = (c: Candidate) => !chosen.has(c.id);
    const ordered: Candidate[] = [];
    const sections: SectionMeta[] = [];
    let budget = MAX_MOCK_QUESTIONS;
    for (const s of bp.sections) {
      const count = Math.min(s.count, budget);
      if (count <= 0) break;
      budget -= count;
      let intended: Candidate[];
      if (s.specialtyKey) {
        const nodes = await this.pool.subtreeIds(await this.pool.nodesByKeyOrPrefix(s.specialtyKey));
        intended = pool.filter((c) => nodes.has(c.topicId));
      } else {
        intended = pool.filter((c) => c.domain === s.domain);
      }
      const take = (from: Candidate[], n: number) => {
        const got = pickBalanced(from.filter(free), difficultyPattern(n));
        got.forEach((c) => chosen.add(c.id));
        return got;
      };
      const got = take(intended, count);
      const served = got.length;
      // Shortfall: same domain first, then anything from the family pool.
      if (got.length < count) got.push(...take(pool.filter((c) => c.domain === s.domain), count - got.length));
      if (got.length < count) got.push(...take(pool, count - got.length));
      sections.push({ ...s, count, served, filled: got.length - served, start: ordered.length, end: ordered.length + got.length });
      ordered.push(...got);
    }
    const requested = sections.reduce((a, s) => a + s.count, 0);
    return {
      questionIds: ordered.map((c) => c.id),
      familyId,
      positionId,
      blueprintId: bp.id,
      expiresAt: new Date(Date.now() + bp.totalMinutes * 60_000),
      meta: {
        totalMinutes: bp.totalMinutes,
        fidelity: bp.fidelity,
        sections,
        shortfall: sections.reduce((a, s) => a + (s.count - s.served), 0),
        missing: requested - ordered.length,
      },
    };
  }

  private async planReview(userId: string, input: StartAttemptInput): Promise<Plan> {
    const count = clamp(input.count ?? PRACTICE_DEFAULT, 1, PRACTICE_MAX);
    const familyId = input.familySlug ? await this.familyId(input.familySlug) : null;
    const ids = await this.pool.dueMistakeIds(userId, familyId, count);
    if (!ids.length) throw new NotFoundException('NOTHING_TO_REVIEW');
    return {
      questionIds: ids,
      familyId: familyId ?? (await this.enrollmentFor(userId, null))?.familyId ?? null,
      positionId: null,
      blueprintId: null,
      expiresAt: null,
      meta: {},
    };
  }

  // ───────────── Read ─────────────

  async get(userId: string, id: string): Promise<AttemptSessionView | { result: AttemptResultView }> {
    const a = await this.owned(userId, id);
    if (a.submittedAt) return { result: await this.resultView(a) };
    if (this.isExpired(a)) return { result: await this.finalize(a) };
    return this.sessionDTO(a);
  }

  async history(userId: string, kind: AttemptKind | undefined, limit: number): Promise<AttemptHistoryItem[]> {
    const rows = await this.db
      .select({
        id: attempts.id, kind: attempts.kind, familySlug: competitionFamilies.slug, score: attempts.score,
        correctCount: attempts.correctCount, total: sql<number>`coalesce(cardinality(${attempts.questionIds}), 0)::int`,
        startedAt: attempts.startedAt, expiresAt: attempts.expiresAt, submittedAt: attempts.submittedAt,
      })
      .from(attempts)
      .leftJoin(competitionFamilies, eq(competitionFamilies.id, attempts.familyId))
      .where(kind ? and(eq(attempts.userId, userId), eq(attempts.kind, kind)) : eq(attempts.userId, userId))
      .orderBy(desc(sql`coalesce(${attempts.submittedAt}, ${attempts.startedAt})`))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      familySlug: r.familySlug,
      score: r.score == null ? null : Math.round(r.score * 100),
      total: Number(r.total),
      correctCount: r.correctCount,
      startedAt: r.startedAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      submittedAt: r.submittedAt?.toISOString() ?? null,
    }));
  }

  private async owned(userId: string, id: string): Promise<AttemptRow> {
    assertUuid(id);
    const [a] = await this.db.select().from(attempts).where(eq(attempts.id, id)).limit(1);
    // Someone else's attempt is indistinguishable from a missing one.
    if (!a || a.userId !== userId) throw new NotFoundException('NOT_FOUND');
    return a;
  }

  private isExpired(a: AttemptRow, now = Date.now()): boolean {
    return modeOf(a.kind) === 'exam' && !!a.expiresAt && now > a.expiresAt.getTime() + EXAM_GRACE_MS;
  }

  private async sessionDTO(a: AttemptRow): Promise<AttemptSessionView> {
    const mode = modeOf(a.kind);
    const meta = metaOf(a);
    const [rows, answers, bookmarked, slugs] = await Promise.all([
      loadQuestionRows(this.db, a.questionIds),
      this.db
        .select({ questionId: attemptAnswers.questionId, answer: attemptAnswers.answer, isCorrect: attemptAnswers.isCorrect })
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, a.id)),
      this.bookmarkedSet(a.userId, a.questionIds),
      this.slugsOf(a),
    ]);
    const answered = new Map(answers.map((x) => [x.questionId, x]));
    const view: AttemptSessionView = {
      id: a.id,
      kind: a.kind,
      mode,
      startedAt: a.startedAt.toISOString(),
      expiresAt: a.expiresAt?.toISOString() ?? null,
      durationMinutes: meta.totalMinutes ?? null,
      familySlug: slugs.familySlug,
      positionSlug: slugs.positionSlug,
      blueprintFidelity: meta.fidelity ?? null,
      questions: a.questionIds
        .map((qid) => rows.get(qid))
        .filter((r): r is QuestionRow => !!r)
        .map((r) =>
          toQuestionDTO(r, {
            // Instant mode: feedback was already given for answered questions. Exam mode: never before submit.
            reveal: mode === 'instant' && answered.has(r.id),
            bookmarked: bookmarked.has(r.id),
            shuffleSeed: `${a.id}:${r.id}`,
          }),
        ),
      answered: Object.fromEntries(answers.map((x) => [x.questionId, x.answer])),
      serverTime: new Date().toISOString(),
    };
    if (mode === 'instant') view.results = Object.fromEntries(answers.map((x) => [x.questionId, x.isCorrect]));
    if (meta.sections) view.sections = meta.sections;
    if (meta.shortfall) view.shortfall = meta.shortfall;
    return view;
  }

  // ───────────── Answer ─────────────

  async answer(userId: string, id: string, input: AnswerInput): Promise<AnswerFeedbackDTO & { remainingToday?: number | null; newBadges?: string[] }> {
    const a = await this.owned(userId, id);
    if (!a.questionIds.includes(input.questionId)) throw new BadRequestException('QUESTION_NOT_IN_ATTEMPT');
    if (a.submittedAt || this.isExpired(a)) throw new ConflictException('ATTEMPT_CLOSED');
    const mode: AttemptMode = modeOf(a.kind);
    return mode === 'exam' ? this.saveExamAnswer(a, input) : this.instantAnswer(a, input);
  }

  private async questionForGrading(questionId: string) {
    const [q] = await this.db
      .select({
        id: questions.id, type: questions.type, correct: questions.correct, explanation: questions.explanation,
        topicId: questions.topicId, rating: questions.rating,
      })
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);
    if (!q) throw new NotFoundException('NOT_FOUND');
    return q;
  }

  /** Exam mode: answers can change until submit; nothing about correctness is returned. */
  private async saveExamAnswer(a: AttemptRow, input: AnswerInput): Promise<AnswerFeedbackDTO> {
    if (input.answer === null) {
      // Clearing an answer: the question goes back to unanswered.
      await this.db.execute(sql`
        delete from attempt_answers aa using attempts a
        where aa.attempt_id = ${a.id} and aa.question_id = ${input.questionId} and a.id = aa.attempt_id and a.submitted_at is null`);
      return { saved: true };
    }
    const q = await this.questionForGrading(input.questionId);
    const isCorrect = gradeAnswer(q.type, q.correct as CorrectAnswer, input.answer as UserAnswer);
    // The guard makes a save racing with submit fail instead of slipping in after grading.
    const res = await this.db.execute<{ id: string }>(sql`
      insert into attempt_answers (attempt_id, question_id, answer, is_correct, time_ms)
      select ${a.id}, ${input.questionId}, ${JSON.stringify(input.answer)}::jsonb, ${isCorrect}, ${input.timeMs ?? null}
      where exists (select 1 from attempts where id = ${a.id} and submitted_at is null)
      on conflict (attempt_id, question_id) do update
        set answer = excluded.answer, is_correct = excluded.is_correct,
            time_ms = coalesce(excluded.time_ms, attempt_answers.time_ms), answered_at = now()
      returning id`);
    if (!res.rows.length) throw new ConflictException('ATTEMPT_CLOSED');
    return { saved: true };
  }

  /** Instant mode: the first answer is final; feedback, mastery and XP happen right away. */
  private async instantAnswer(a: AttemptRow, input: AnswerInput): Promise<AnswerFeedbackDTO & { remainingToday?: number | null; newBadges?: string[] }> {
    const q = await this.questionForGrading(input.questionId);
    const existing = await this.existingAnswer(a.id, q.id);
    if (existing) return { saved: true, isCorrect: existing.isCorrect, correct: q.correct, explanation: q.explanation, xpGained: 0 };

    let remaining: number | null = null;
    if (countsTowardLimit(a.kind)) {
      const c = await this.consumeQuestion(a.userId);
      if (!c.allowed) throw paymentRequired('LIMIT_REACHED');
      remaining = c.remaining;
    }

    const [prev] = await this.db
      .select({ lastCorrect: userQuestionState.lastCorrect })
      .from(userQuestionState)
      .where(and(eq(userQuestionState.userId, a.userId), eq(userQuestionState.questionId, q.id)))
      .limit(1);
    const isCorrect = gradeAnswer(q.type, q.correct as CorrectAnswer, input.answer as UserAnswer);
    const inserted = await this.db
      .insert(attemptAnswers)
      .values({ attemptId: a.id, questionId: q.id, answer: input.answer as object | null, isCorrect, timeMs: input.timeMs ?? null })
      .onConflictDoNothing()
      .returning({ id: attemptAnswers.id });
    if (!inserted.length) {
      // A concurrent request answered first: report its (final) outcome.
      const first = await this.existingAnswer(a.id, q.id);
      return { saved: true, isCorrect: first?.isCorrect ?? isCorrect, correct: q.correct, explanation: q.explanation, xpGained: 0 };
    }

    try {
      await this.mastery.recordAnswer(a.userId, { questionId: q.id, topicId: q.topicId, rating: q.rating }, isCorrect, input.timeMs);
    } catch (e) {
      this.logger.error(`recordAnswer failed (${a.userId}, ${q.id}): ${(e as Error).message}`);
    }
    const reward = await this.instantRewards(a, isCorrect, isCorrect && prev?.lastCorrect === false);

    const out: AnswerFeedbackDTO & { remainingToday?: number | null; newBadges?: string[] } = {
      saved: true, isCorrect, correct: q.correct, explanation: q.explanation, xpGained: reward.xp,
    };
    if (countsTowardLimit(a.kind)) {
      out.limitReached = remaining === 0;
      out.remainingToday = remaining;
    }
    if (reward.newBadges.length) out.newBadges = reward.newBadges;
    return out;
  }

  private async existingAnswer(attemptId: string, questionId: string) {
    const [x] = await this.db
      .select({ isCorrect: attemptAnswers.isCorrect, answer: attemptAnswers.answer })
      .from(attemptAnswers)
      .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.questionId, questionId)))
      .limit(1);
    return x ?? null;
  }

  private async consumeQuestion(userId: string): Promise<{ allowed: boolean; remaining: number | null }> {
    try {
      return await this.entitlements.consume(userId, 'questions');
    } catch (e) {
      // Billing outages never block learning (user outcomes > monetization).
      this.logger.error(`consume failed for ${userId}: ${(e as Error).message}`);
      return { allowed: true, remaining: null };
    }
  }

  /** XP/streak/badges for one instant answer. Gamification failures never fail the answer. */
  private async instantRewards(a: AttemptRow, isCorrect: boolean, mistakeFixed: boolean): Promise<{ xp: number; newBadges: string[] }> {
    let xp = 0;
    const award = async (amount: number, reason: string) => {
      if (amount <= 0) return;
      try {
        await this.gamification.awardXp(a.userId, amount, reason, a.familyId);
        xp += amount;
      } catch (e) {
        this.logger.warn(`awardXp ${reason} failed for ${a.userId}: ${(e as Error).message}`);
      }
    };
    await award(XP.ANSWER + (isCorrect ? XP.CORRECT : 0), isCorrect ? 'CORRECT' : 'ANSWER');
    if (mistakeFixed) await award(XP.MISTAKE_FIXED, 'MISTAKE_FIXED');
    await this.quietly(() => this.gamification.incrementAnswered(a.userId, 1), 'incrementAnswered');
    await this.quietly(() => this.gamification.touchStreak(a.userId), 'touchStreak');
    const newBadges = (await this.quietly(() => this.gamification.checkBadges(a.userId), 'checkBadges')) ?? [];
    if (xp > 0) {
      await this.db.execute(sql`
        update attempts set result = jsonb_set(
          case when jsonb_typeof(result -> 'meta') = 'object' then result else coalesce(result, '{}'::jsonb) || '{"meta":{}}'::jsonb end,
          '{meta,xp}', to_jsonb(coalesce((result -> 'meta' ->> 'xp')::int, 0) + ${xp}::int))
        where id = ${a.id}`);
    }
    return { xp, newBadges };
  }

  private async quietly<T>(fn: () => Promise<T>, what: string): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`${what} failed: ${(e as Error).message}`);
      return null;
    }
  }

  // ───────────── Submit ─────────────

  async submit(userId: string, id: string): Promise<AttemptResultView> {
    const a = await this.owned(userId, id);
    if (a.submittedAt) return this.resultView(a);
    return this.finalize(a);
  }

  /** Grades, persists and rewards an attempt exactly once (concurrent submits get the stored result). */
  private async finalize(a: AttemptRow): Promise<AttemptResultView> {
    const now = new Date();
    const durationS = durationSeconds(a.startedAt, now, a.expiresAt, EXAM_GRACE_MS);
    const [claimed] = await this.db
      .update(attempts)
      .set({ submittedAt: now, durationS })
      .where(and(eq(attempts.id, a.id), isNull(attempts.submittedAt)))
      .returning();
    if (!claimed) {
      const [fresh] = await this.db.select().from(attempts).where(eq(attempts.id, a.id)).limit(1);
      return this.resultView(fresh);
    }

    const graded = await this.grade(claimed);
    const s = graded.summary;
    const meta = metaOf(claimed);
    const exam = modeOf(claimed.kind) === 'exam';
    const base: StoredFinal = {
      id: claimed.id, kind: claimed.kind, score: s.score, correctCount: s.correctCount, total: s.total, durationS, accuracy: s.accuracy,
      byDomain: s.byDomain, weakTopics: s.weakTopics, strongTopics: s.strongTopics, readiness: null,
      xpGained: exam ? 0 : meta.xp ?? 0, newBadges: [], percentile: null,
      answeredCount: s.answeredCount, avgTimeS: s.avgTimeS, shortfall: meta.shortfall ?? null,
    };
    const ratio = s.total ? s.correctCount / s.total : 0;
    await this.db.update(attempts).set({ correctCount: s.correctCount, score: ratio, result: { meta, final: base } }).where(eq(attempts.id, claimed.id));

    if (exam) {
      // Sequential on purpose: Elo updates on the same topic must not race.
      for (const it of graded.items) {
        if (!it.answered) continue;
        const row = graded.rows.get(it.questionId);
        if (!row) continue;
        try {
          await this.mastery.recordAnswer(claimed.userId, { questionId: row.id, topicId: row.topicId, rating: row.rating }, it.isCorrect, it.timeMs ?? undefined);
        } catch (e) {
          this.logger.error(`recordAnswer failed at submit (${claimed.id}, ${row.id}): ${(e as Error).message}`);
        }
      }
    }
    const reward = await this.submitRewards(claimed, s, exam);
    const readiness = claimed.familyId ? await this.readinessFor(claimed.userId, claimed.familyId) : null;
    const percentile = claimed.kind === 'MOCK' && claimed.blueprintId ? await this.percentile(claimed.id, claimed.blueprintId, ratio) : null;
    if (claimed.kind === 'DIAGNOSTIC') await this.rewardReferral(claimed.userId);

    const final: StoredFinal = { ...base, readiness, xpGained: base.xpGained + reward.xp, newBadges: reward.newBadges, percentile };
    await this.db.update(attempts).set({ result: { meta, final } }).where(eq(attempts.id, claimed.id));
    return this.view(final, meta, graded, claimed);
  }

  private async submitRewards(a: AttemptRow, s: ResultSummary, exam: boolean): Promise<{ xp: number; newBadges: string[] }> {
    let xp = 0;
    const award = async (amount: number, reason: string) => {
      if (amount <= 0) return;
      const ok = await this.quietly(() => this.gamification.awardXp(a.userId, amount, reason, a.familyId), `awardXp ${reason}`);
      if (ok !== null) xp += amount;
    };
    if (exam) {
      // Instant attempts were rewarded answer by answer.
      await award(s.answeredCount * XP.ANSWER, 'ANSWER');
      await award(s.correctCount * XP.CORRECT, 'CORRECT');
      if (s.answeredCount > 0) await this.quietly(() => this.gamification.incrementAnswered(a.userId, s.answeredCount), 'incrementAnswered');
      if (a.kind === 'MOCK') await award(XP.MOCK_DONE, 'MOCK_DONE');
    }
    if (s.answeredCount > 0) await this.quietly(() => this.gamification.touchStreak(a.userId), 'touchStreak');
    const newBadges = (await this.quietly(() => this.gamification.checkBadges(a.userId), 'checkBadges')) ?? [];
    return { xp, newBadges };
  }

  private async readinessFor(userId: string, familyId: string): Promise<ReadinessResult | null> {
    try {
      const r = await this.readiness.forFamily(userId, familyId);
      return r ?? null;
    } catch (e) {
      this.logger.warn(`readiness failed (${userId}, ${familyId}): ${(e as Error).message}`);
      return null;
    }
  }

  /** Mid-rank percentile among the other submitted mocks of the same blueprint (null under 5 of them). */
  private async percentile(attemptId: string, blueprintId: string, ratio: number): Promise<number | null> {
    const res = await this.db.execute<{ below: number; equal: number; total: number }>(sql`
      select count(*) filter (where round(score::numeric, 4) < round(${ratio}::numeric, 4))::int as below,
             count(*) filter (where round(score::numeric, 4) = round(${ratio}::numeric, 4))::int as equal,
             count(*)::int as total
      from attempts
      where kind = 'MOCK' and blueprint_id = ${blueprintId} and submitted_at is not null and score is not null and id <> ${attemptId}`);
    const r = res.rows[0];
    return r ? percentileOf(Number(r.below), Number(r.equal), Number(r.total)) : null;
  }

  /**
   * Referral reward once the referred user (registered) completes a diagnostic: premium days for both sides.
   * `rewarded_at` is claimed atomically first so concurrent submits cannot double-grant; a failed grant releases it.
   */
  private async rewardReferral(userId: string): Promise<void> {
    try {
      const [u] = await this.db.select({ isGuest: users.isGuest, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId)).limit(1);
      if (!u || u.isGuest || u.deletedAt) return;
      const [claim] = await this.db
        .update(referrals)
        .set({ rewardedAt: new Date() })
        .where(and(eq(referrals.referredId, userId), isNull(referrals.rewardedAt)))
        .returning({ id: referrals.id, referrerId: referrals.referrerId });
      if (!claim) return;
      try {
        const [referrer] = await this.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, claim.referrerId), isNull(users.deletedAt)))
          .limit(1);
        await this.entitlements.grantDays(userId, REFERRAL_REWARD_DAYS, 'REFERRAL');
        if (referrer) await this.entitlements.grantDays(referrer.id, REFERRAL_REWARD_DAYS, 'REFERRAL');
      } catch (e) {
        await this.db.update(referrals).set({ rewardedAt: null }).where(eq(referrals.id, claim.id));
        throw e;
      }
    } catch (e) {
      this.logger.error(`referral reward failed for ${userId}: ${(e as Error).message}`);
    }
  }

  // ───────────── Results ─────────────

  private async grade(a: AttemptRow): Promise<{ items: GradedItem[]; rows: Map<string, QuestionRow>; answers: Map<string, { answer: unknown; isCorrect: boolean }>; summary: ResultSummary }> {
    const [rows, answerRows] = await Promise.all([
      loadQuestionRows(this.db, a.questionIds),
      this.db
        .select({ questionId: attemptAnswers.questionId, answer: attemptAnswers.answer, isCorrect: attemptAnswers.isCorrect, timeMs: attemptAnswers.timeMs })
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, a.id)),
    ]);
    const answers = new Map(answerRows.map((r) => [r.questionId, r]));
    const items: GradedItem[] = a.questionIds
      .filter((qid) => rows.has(qid))
      .map((qid) => {
        const r = rows.get(qid)!;
        const ans = answers.get(qid);
        return {
          questionId: qid, domain: r.domain, topicKey: r.topicKey, topicTitleAr: r.topicTitleAr, topicTitleFr: r.topicTitleFr,
          answered: !!ans, isCorrect: !!ans?.isCorrect, timeMs: ans?.timeMs ?? null,
        };
      });
    return { items, rows, answers, summary: summarize(items) };
  }

  /** Result of an already-submitted attempt (stored summary + review rebuilt from the answers). */
  private async resultView(a: AttemptRow): Promise<AttemptResultView> {
    const graded = await this.grade(a);
    const meta = metaOf(a);
    const stored = finalOf(a);
    const s = graded.summary;
    // A submit interrupted before its summary was written: recompute it (without side effects).
    const final: StoredFinal = stored ?? {
      id: a.id, kind: a.kind, score: s.score, correctCount: s.correctCount, total: s.total, durationS: a.durationS ?? 0,
      accuracy: s.accuracy, byDomain: s.byDomain, weakTopics: s.weakTopics, strongTopics: s.strongTopics, readiness: null,
      xpGained: meta.xp ?? 0, newBadges: [], percentile: null, answeredCount: s.answeredCount, avgTimeS: s.avgTimeS,
      shortfall: meta.shortfall ?? null,
    };
    return this.view(final, meta, graded, a);
  }

  private async view(
    final: StoredFinal,
    meta: AttemptMeta,
    graded: { items: GradedItem[]; rows: Map<string, QuestionRow>; answers: Map<string, { answer: unknown; isCorrect: boolean }> },
    a: AttemptRow,
  ): Promise<AttemptResultView> {
    const bookmarked = await this.bookmarkedSet(a.userId, a.questionIds);
    const review = graded.items.map((it) => ({
      question: toQuestionDTO(graded.rows.get(it.questionId)!, { reveal: true, bookmarked: bookmarked.has(it.questionId), shuffleSeed: `${a.id}:${it.questionId}` }),
      answer: graded.answers.get(it.questionId)?.answer ?? null,
      isCorrect: it.isCorrect,
    }));
    const out: AttemptResultView = { ...final, review };
    if (meta.sections) out.sections = meta.sections;
    return out;
  }

  // ───────────── Lookups ─────────────

  private async bookmarkedSet(userId: string, ids: readonly string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db
      .select({ id: userQuestionState.questionId })
      .from(userQuestionState)
      .where(and(eq(userQuestionState.userId, userId), eq(userQuestionState.bookmarked, true), inArray(userQuestionState.questionId, [...ids])));
    return new Set(rows.map((r) => r.id));
  }

  private async slugsOf(a: AttemptRow): Promise<{ familySlug: string | null; positionSlug: string | null }> {
    const [f, p] = await Promise.all([
      a.familyId ? this.db.select({ slug: competitionFamilies.slug }).from(competitionFamilies).where(eq(competitionFamilies.id, a.familyId)).limit(1) : [],
      a.positionId ? this.db.select({ slug: positions.slug }).from(positions).where(eq(positions.id, a.positionId)).limit(1) : [],
    ]);
    return { familySlug: f[0]?.slug ?? null, positionSlug: p[0]?.slug ?? null };
  }

  private async familyId(slug: string): Promise<string> {
    const [f] = await this.db
      .select({ id: competitionFamilies.id })
      .from(competitionFamilies)
      .where(and(eq(competitionFamilies.slug, slug), inArray(competitionFamilies.status, VISIBLE_NODE_STATUSES)))
      .limit(1);
    if (!f) throw new NotFoundException('NOT_FOUND');
    return f.id;
  }

  /** Explicit family, else the user's primary enrollment, else none. */
  private async familyIdFor(userId: string, slug: string | undefined): Promise<string | null> {
    if (slug) return this.familyId(slug);
    return (await this.enrollmentFor(userId, null))?.familyId ?? null;
  }

  /** The user's enrollment in a family, or their primary (then oldest) enrollment when familyId is null. */
  private async enrollmentFor(userId: string, familyId: string | null): Promise<{ familyId: string; positionId: string | null } | null> {
    const [e] = await this.db
      .select({ familyId: enrollments.familyId, positionId: enrollments.positionId })
      .from(enrollments)
      .where(familyId ? and(eq(enrollments.userId, userId), eq(enrollments.familyId, familyId)) : eq(enrollments.userId, userId))
      .orderBy(desc(enrollments.isPrimary), asc(enrollments.createdAt))
      .limit(1);
    return e ?? null;
  }

  private async blueprintOf(positionId: string): Promise<BlueprintInfo | null> {
    const [b] = await this.db
      .select({ id: blueprints.id, totalMinutes: blueprints.totalMinutes, fidelity: blueprints.fidelity, sections: blueprints.sections })
      .from(blueprints)
      .where(and(eq(blueprints.positionId, positionId), inArray(blueprints.status, VISIBLE_NODE_STATUSES)))
      .limit(1);
    if (!b) return null;
    const sections = parseSections(b.sections);
    if (!sections.length) return null;
    const totalMinutes = b.totalMinutes > 0 ? b.totalMinutes : Math.max(1, Math.round(sections.reduce((x, s) => x + (s.minutes || s.count), 0)));
    return { id: b.id, totalMinutes, fidelity: b.fidelity === 'OFFICIAL_FORMAT' ? 'OFFICIAL_FORMAT' : 'APPROXIMATED', sections };
  }

  /**
   * Position whose blueprint drives the attempt: the requested one, else the user's enrolled position, else the family's
   * first position with a blueprint. `keepWithoutBlueprint` keeps a requested/enrolled position even if it has none (MOCK).
   */
  private async targetPosition(
    userId: string, familyId: string, positionSlug: string | undefined, keepWithoutBlueprint: boolean,
  ): Promise<{ positionId: string; blueprint: BlueprintInfo | null } | null> {
    if (positionSlug) {
      const [p] = await this.db
        .select({ id: positions.id })
        .from(positions)
        .where(and(eq(positions.familyId, familyId), eq(positions.slug, positionSlug), inArray(positions.status, VISIBLE_NODE_STATUSES)))
        .limit(1);
      if (!p) throw new NotFoundException('NOT_FOUND');
      return { positionId: p.id, blueprint: await this.blueprintOf(p.id) };
    }
    const enrolled = (await this.enrollmentFor(userId, familyId))?.positionId;
    if (enrolled) {
      const bp = await this.blueprintOf(enrolled);
      if (bp || keepWithoutBlueprint) return { positionId: enrolled, blueprint: bp };
    }
    const list = await this.db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.familyId, familyId), inArray(positions.status, VISIBLE_NODE_STATUSES)))
      .orderBy(asc(positions.orderIndex));
    for (const p of list) {
      const bp = await this.blueprintOf(p.id);
      if (bp) return { positionId: p.id, blueprint: bp };
    }
    return keepWithoutBlueprint && list[0] ? { positionId: list[0].id, blueprint: null } : null;
  }

  /** Mock format when no blueprint exists: SYNTH_MOCK_SIZE questions spread equally over the family's domains. */
  private async synthesizedBlueprint(familyId: string): Promise<BlueprintInfo> {
    const linked = await this.pool.familyDomainWeights(familyId);
    const domains = DOMAINS.filter((d) => linked.has(d));
    const counts = allocateWithCaps(SYNTH_MOCK_SIZE, domains.map((key) => ({ key, weight: 1 })), new Map(domains.map((d) => [d, SYNTH_MOCK_SIZE])));
    const sections = domains.map((domain) => ({ domain, specialtyKey: null, count: counts.get(domain) ?? 0, minutes: counts.get(domain) ?? 0 })).filter((s) => s.count > 0);
    return { id: null, totalMinutes: Math.max(1, sections.reduce((a, s) => a + s.minutes, 0)), fidelity: 'APPROXIMATED', sections };
  }

  /** Plan topic references may be node ids or node keys. */
  private async resolveNodeRefs(refs: string[]): Promise<string[]> {
    if (!refs.length) return [];
    const ids = refs.filter(isUuid);
    const keys = refs.filter((r) => !isUuid(r));
    const rows = await this.db
      .select({ id: syllabusNodes.id })
      .from(syllabusNodes)
      .where(
        and(
          inArray(syllabusNodes.status, VISIBLE_NODE_STATUSES),
          or(ids.length ? inArray(syllabusNodes.id, ids) : undefined, keys.length ? inArray(syllabusNodes.key, keys) : undefined),
        ),
      );
    return rows.map((r) => r.id);
  }

  private async resumableDiagnostic(userId: string, familyId: string | null): Promise<AttemptRow | null> {
    const [a] = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.userId, userId),
          eq(attempts.kind, 'DIAGNOSTIC'),
          isNull(attempts.submittedAt),
          familyId ? eq(attempts.familyId, familyId) : isNull(attempts.familyId),
          sql`${attempts.startedAt} > ${new Date(Date.now() - DIAGNOSTIC_RESUME_MS)}`,
        ),
      )
      .orderBy(desc(attempts.startedAt))
      .limit(1);
    return a ?? null;
  }

  /** An unexpired, unsubmitted mock for the same position is resumed (a reload must not burn the free mock). */
  private async resumableMock(userId: string, familyId: string, positionId: string | null): Promise<AttemptRow | null> {
    const [a] = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.userId, userId),
          eq(attempts.kind, 'MOCK'),
          isNull(attempts.submittedAt),
          eq(attempts.familyId, familyId),
          positionId ? eq(attempts.positionId, positionId) : isNull(attempts.positionId),
          sql`${attempts.expiresAt} > ${new Date(Date.now() - EXAM_GRACE_MS)}`,
        ),
      )
      .orderBy(desc(attempts.startedAt))
      .limit(1);
    return a ?? null;
  }
}

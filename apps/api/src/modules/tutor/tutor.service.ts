import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  gradeAnswer, type CorrectAnswer, type Difficulty, type Domain, type Locale, type QuestionDTO, type QuestionType, type SourceType,
  type TutorInput, type TutorResponseDTO,
} from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import {
  learningObjectives, questionObjectives, questions, sources, syllabusNodes, tutorCache, usageCounters, users, weaknessEvents,
} from '../../db/schema';
import { AiService } from '../ai/ai.service';
import { rateLimiter } from '../auth/rate-limit';
import { EntitlementsService } from '../billing/entitlements.service';
import { inList, servableQuestionStatuses } from '../catalog/catalog.util';
import {
  asOptions, canonicalAnswer, fallbackParts, parseAiParts, presentOptions, stableStringify, tutorSystemPrompt, tutorUserPrompt,
  type QuestionOption, type TutorMaterial, type TutorParts,
} from './tutor.util';

/** Burst limit per user (cache hits are free, so they need their own guard). */
const BURST_LIMIT = 20;
const BURST_WINDOW_MS = 60_000;
/** A question answered correctly this recently is not offered again as the "similar question". */
const RECENTLY_CORRECT_DAYS = 30;
/** Abandoned exam-mode attempts without an expiry stop locking the tutor after this long. */
const OPEN_EXAM_MAX_AGE_HOURS = 24;
const FALLBACK_MODEL = 'fallback';
const AI_MAX_TOKENS = 1200;

interface QuestionContext {
  id: string;
  type: QuestionType;
  domain: Domain;
  language: string;
  stem: string;
  options: QuestionOption[];
  correct: CorrectAnswer;
  explanation: string;
  rating: number;
  version: number;
  topic: { id: string; key: string; titleAr: string; titleFr: string };
  objectives: { id: string; ar: string; fr: string }[];
  /** Question source first, then the topic source (deduplicated). */
  sources: { title: string; url: string | null; sourceType: SourceType }[];
}

interface CachedExplanation extends TutorParts {
  ai: boolean;
}

function asCached(v: unknown): CachedExplanation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.why_wrong !== 'string' || typeof o.concept !== 'string' || typeof o.example !== 'string') return null;
  return { why_wrong: o.why_wrong, concept: o.concept, example: o.example, ai: o.ai === true };
}

/**
 * "Why was I wrong?" — grounded explanation of an answered question. Cached per (question version, canonical answer, locale);
 * AI output is used only when it validates, otherwise a deterministic explanation built from the human-reviewed content.
 */
@Injectable()
export class TutorService {
  private readonly logger = new Logger('Tutor');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly entitlements: EntitlementsService,
    private readonly ai: AiService,
  ) {}

  async explain(userId: string, input: TutorInput): Promise<TutorResponseDTO> {
    const burst = rateLimiter.hit(`tutor|${userId}`, BURST_LIMIT, BURST_WINDOW_MS);
    if (!burst.allowed) throw new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);

    const q = await this.loadQuestion(input.questionId);
    if (!q) throw new NotFoundException('NOT_FOUND');
    await this.assertMayExplain(userId, q.id);

    const locale = input.locale ?? (await this.userLocale(userId));
    const answer = canonicalAnswer(q.type, q.options, input.answer);
    const isCorrect = gradeAnswer(q.type, q.correct, answer);
    // The version is part of the key: an editor fixing a question must never leave a stale explanation behind.
    const answerKey = `v${q.version}:${stableStringify(answer)}`;

    // Asking for help is a weakness signal on the topic, even after a lucky correct answer.
    await this.db.insert(weaknessEvents).values({ userId, nodeId: q.topic.id, questionId: q.id });

    const reviewTopic = { key: q.topic.key, title_ar: q.topic.titleAr, title_fr: q.topic.titleFr };
    const hit = await this.cacheGet(q.id, answerKey, locale);
    // A deterministic explanation cached while AI was off is upgraded once AI is available.
    if (hit && (hit.ai || !this.ai.enabled)) {
      await this.db
        .update(tutorCache)
        .set({ hits: sql`${tutorCache.hits} + 1` })
        .where(and(eq(tutorCache.questionId, q.id), eq(tutorCache.answerKey, answerKey), eq(tutorCache.locale, locale)));
      const [similar, remainingToday] = await Promise.all([this.similarQuestion(userId, q), this.remainingToday(userId)]);
      return {
        why_wrong: hit.why_wrong, concept: hit.concept, example: hit.example,
        similar_question: similar, review_topic: reviewTopic, citations: q.sources, cached: true, ai: hit.ai, remainingToday,
      };
    }

    let quota: { allowed: boolean; remaining: number | null } | null = null;
    try {
      quota = await this.entitlements.consume(userId, 'tutor');
    } catch (e) {
      // Billing unavailable: still help with the free deterministic explanation, but never spend AI budget unmetered.
      this.logger.error(`tutor quota check failed for ${userId}: ${(e as Error).message}`);
    }
    if (quota && !quota.allowed) throw new HttpException('LIMIT_REACHED', HttpStatus.PAYMENT_REQUIRED);

    const material: TutorMaterial = {
      type: q.type, language: q.language, stem: q.stem, options: q.options, correct: q.correct, explanation: q.explanation,
      answer, isCorrect, objectives: q.objectives.map((o) => ({ ar: o.ar, fr: o.fr })),
      topic: { ar: q.topic.titleAr, fr: q.topic.titleFr },
      source: q.sources[0] ? { title: q.sources[0].title, url: q.sources[0].url } : null,
    };
    let parts: TutorParts | null = null;
    let model = FALLBACK_MODEL;
    if (quota && this.ai.enabled) {
      try {
        const r = await this.ai.json<unknown>({ model: 'tutor', system: tutorSystemPrompt(locale), prompt: tutorUserPrompt(material, locale), maxTokens: AI_MAX_TOKENS });
        parts = parseAiParts(r.data);
        if (parts) model = r.model;
        else this.logger.warn(`tutor AI output rejected (invalid shape) for question ${q.id}`);
      } catch (e) {
        this.logger.warn(`tutor AI call failed for question ${q.id}: ${(e as Error).message}`);
      }
    }
    const aiUsed = !!parts;
    const explanation = parts ?? fallbackParts(material, locale);

    const cached: CachedExplanation = { ...explanation, ai: aiUsed };
    await this.db
      .insert(tutorCache)
      .values({ questionId: q.id, answerKey, locale, response: cached, model })
      .onConflictDoUpdate({
        target: [tutorCache.questionId, tutorCache.answerKey, tutorCache.locale],
        set: { response: cached, model, createdAt: sql`now()` },
      });

    return {
      ...explanation,
      similar_question: await this.similarQuestion(userId, q),
      review_topic: reviewTopic,
      citations: q.sources,
      cached: false,
      ai: aiUsed,
      remainingToday: quota?.remaining ?? null,
    };
  }

  // ───────────── Loading & authorization ─────────────

  private async loadQuestion(id: string): Promise<QuestionContext | null> {
    const [row] = await this.db
      .select({
        id: questions.id, type: questions.type, domain: questions.domain, language: questions.language, stem: questions.stem,
        options: questions.options, correct: questions.correct, explanation: questions.explanation, rating: questions.rating,
        version: questions.version, sourceId: questions.sourceId,
        topicId: syllabusNodes.id, topicKey: syllabusNodes.key, topicTitleAr: syllabusNodes.titleAr, topicTitleFr: syllabusNodes.titleFr,
        topicSourceId: syllabusNodes.sourceId,
      })
      .from(questions)
      .innerJoin(syllabusNodes, eq(syllabusNodes.id, questions.topicId))
      .where(and(
        eq(questions.id, id),
        inArray(questions.status, servableQuestionStatuses()),
        sql`(${questions.validUntil} is null or ${questions.validUntil} >= ${tunisToday()})`,
      ))
      .limit(1);
    if (!row) return null;

    const sourceIds = [...new Set([row.sourceId, row.topicSourceId].filter((s): s is string => !!s))];
    const [objectives, sourceRows] = await Promise.all([
      this.db
        .select({ id: learningObjectives.id, ar: learningObjectives.textAr, fr: learningObjectives.textFr })
        .from(questionObjectives)
        .innerJoin(learningObjectives, eq(learningObjectives.id, questionObjectives.objectiveId))
        .where(eq(questionObjectives.questionId, id))
        .orderBy(learningObjectives.key),
      sourceIds.length
        ? this.db.select({ id: sources.id, title: sources.title, url: sources.url, sourceType: sources.sourceType }).from(sources).where(inArray(sources.id, sourceIds))
        : Promise.resolve([]),
    ]);
    const byId = new Map(sourceRows.map((s) => [s.id, s]));
    return {
      id: row.id, type: row.type, domain: row.domain, language: row.language, stem: row.stem, options: asOptions(row.options),
      correct: row.correct as CorrectAnswer, explanation: row.explanation, rating: row.rating, version: row.version,
      topic: { id: row.topicId, key: row.topicKey, titleAr: row.topicTitleAr, titleFr: row.topicTitleFr },
      objectives,
      sources: sourceIds.map((sid) => byId.get(sid)).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ title: s.title, url: s.url, sourceType: s.sourceType })),
    };
  }

  /**
   * The tutor reveals the correct answer, so it only explains questions the user has already answered, and never while
   * the question is part of one of their exam-mode attempts (diagnostic / mock) still in progress.
   */
  private async assertMayExplain(userId: string, questionId: string): Promise<void> {
    const res = await this.db.execute<{ seen: boolean; in_exam: boolean }>(sql`
      select
        (exists (select 1 from user_question_state s where s.user_id = ${userId} and s.question_id = ${questionId})
          or exists (select 1 from attempt_answers aa join attempts a on a.id = aa.attempt_id
                     where a.user_id = ${userId} and aa.question_id = ${questionId})) as seen,
        exists (select 1 from attempts a
                where a.user_id = ${userId} and a.kind in ('DIAGNOSTIC', 'MOCK') and a.submitted_at is null
                  and ${questionId}::uuid = any(a.question_ids)
                  and (case when a.expires_at is not null then a.expires_at > now()
                            else a.started_at > now() - make_interval(hours => ${OPEN_EXAM_MAX_AGE_HOURS}) end)) as in_exam`);
    const r = res.rows[0];
    if (r?.in_exam) throw new ForbiddenException('EXAM_IN_PROGRESS');
    if (!r?.seen) throw new ForbiddenException('NOT_ANSWERED');
  }

  private async userLocale(userId: string): Promise<Locale> {
    const [u] = await this.db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.locale === 'fr' ? 'fr' : 'ar';
  }

  private async cacheGet(questionId: string, answerKey: string, locale: Locale): Promise<CachedExplanation | null> {
    const [row] = await this.db
      .select({ response: tutorCache.response })
      .from(tutorCache)
      .where(and(eq(tutorCache.questionId, questionId), eq(tutorCache.answerKey, answerKey), eq(tutorCache.locale, locale)))
      .limit(1);
    return row ? asCached(row.response) : null;
  }

  /** Remaining tutor explanations today without consuming one (cache hits are free). */
  private async remainingToday(userId: string): Promise<number | null> {
    try {
      const ent = await this.entitlements.get(userId);
      const limit = ent.limits.tutorPerDay;
      if (typeof limit !== 'number') return null;
      const [u] = await this.db
        .select({ used: usageCounters.tutor })
        .from(usageCounters)
        .where(and(eq(usageCounters.userId, userId), eq(usageCounters.date, tunisToday())))
        .limit(1);
      return Math.max(0, limit - (u?.used ?? 0));
    } catch {
      return null;
    }
  }

  // ───────────── Similar question ─────────────

  /**
   * A servable question on the same topic (same objective first, then never-seen ones, then closest difficulty),
   * excluding this one and those the user answered correctly recently. Served without correct answer/explanation.
   */
  private async similarQuestion(userId: string, q: QuestionContext): Promise<QuestionDTO | null> {
    const objectiveIds = q.objectives.map((o) => o.id);
    const sameObjective = objectiveIds.length
      ? sql`exists (select 1 from question_objectives qo where qo.question_id = q.id and qo.objective_id in ${inList(objectiveIds)})`
      : sql`false`;
    const res = await this.db.execute<{
      id: string; type: QuestionType; domain: Domain; language: string; stem: string; options: unknown; difficulty: Difficulty;
      origin: string; year: number | null; status: string; source_title: string | null; bookmarked: boolean | null;
    }>(sql`
      select q.id, q.type, q.domain, q.language, q.stem, q.options, q.difficulty, q.origin, q.year, q.status,
             src.title as source_title, s.bookmarked
      from questions q
      left join sources src on src.id = q.source_id
      left join user_question_state s on s.question_id = q.id and s.user_id = ${userId}
      where q.topic_id = ${q.topic.id} and q.id <> ${q.id}
        and q.status in ${inList(servableQuestionStatuses())}
        and (q.valid_until is null or q.valid_until >= ${tunisToday()})
        and not (coalesce(s.last_correct, false)
                 and s.last_answered_at > now() - make_interval(days => ${RECENTLY_CORRECT_DAYS}))
      order by ${sameObjective} desc, (s.question_id is null) desc, abs(q.rating - ${q.rating}), random()
      limit 1`);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id, type: r.type, domain: r.domain, language: r.language === 'fr' || r.language === 'en' ? r.language : 'ar',
      stem: r.stem, options: presentOptions(r.type, asOptions(r.options)), difficulty: r.difficulty,
      topicKey: q.topic.key, topicTitle_ar: q.topic.titleAr, topicTitle_fr: q.topic.titleFr,
      origin: r.origin, year: r.year, sourceLabel: r.source_title ?? null,
      unreviewed: r.status !== 'PUBLISHED',
      bookmarked: !!r.bookmarked,
    };
  }
}

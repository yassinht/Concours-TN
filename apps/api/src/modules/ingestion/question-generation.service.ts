import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DIFFICULTY_RATING, type AiGenerateInput, type Difficulty, type Domain } from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { aiJobs, learningObjectives, questionObjectives, questions, sourceChunks, sourceDocuments, sources, syllabusNodes } from '../../db/schema';
import { AiService } from '../ai/ai.service';
import { toJobDTO, type AiJobDTO } from './ai-jobs.service';
import {
  GEN_BATCH_SIZE, GEN_PROMPT_VERSION, GEN_SCHEMA_HINT, SOLVE_SCHEMA_HINT, defaultLanguage, generationSystemPrompt, generationUserPrompt,
  solveSystemPrompt, solveUserPrompt, type GenExcerpt, type GenObjective,
} from './generation-prompts';
import {
  coerceCandidate, findNearDuplicate, rejectionNote, tokenSet, validateStructure, type CandidateQuestion, type RejectReason,
} from './question-validation';

type GenerateInput = z.infer<typeof AiGenerateInput>;

/** In-process jobs at once: generation is expensive, a double click must not launch ten of them. */
const MAX_CONCURRENT_JOBS = 2;
const GEN_MAX_TOKENS = 12_000;
const SOLVE_MAX_TOKENS = 2_000;
const MAX_EXCERPT_CHARS = 9_000;
const AVOID_STEMS = 25;

interface TopicRow {
  id: string;
  key: string;
  titleAr: string;
  titleFr: string;
  domain: Domain;
  sourceId: string | null;
}

interface Rejection {
  questionId: string;
  reason: RejectReason;
  detail?: string;
}

interface JobOutput {
  topicKey: string;
  requested: number;
  inserted: number;
  aiReviewed: number;
  draft: number;
  discarded: number;
  questionIds: string[];
  rejected: Rejection[];
  batchErrors: string[];
}

/**
 * POST /admin/ai/generate-questions — asynchronous AI generation grounded on a syllabus topic.
 * Every generated question is inserted as DRAFT (origin AI_GENERATED) and then auto-validated:
 *   1. structure (4 options, unique ids/texts, exactly one existing correct id),
 *   2. near-duplicate check against the topic's stems (normalised-token Jaccard > 0.8),
 *   3. a second, blind AI pass that must find the same key.
 * Passing all three → AI_REVIEWED (still needs a human before PUBLISHED); otherwise the question stays DRAFT with the
 * reason in its tags and a note appended to its explanation.
 */
@Injectable()
export class QuestionGenerationService implements OnModuleDestroy {
  private readonly logger = new Logger('QuestionGeneration');
  private readonly inflight = new Set<Promise<void>>();
  /** Slots taken by requests still preparing their job (counted synchronously, so parallel requests cannot overshoot). */
  private starting = 0;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly ai: AiService,
    private readonly audit: AuditService,
  ) {}

  async start(input: GenerateInput, actorId: string): Promise<AiJobDTO> {
    if (!this.ai.enabled) throw new BadRequestException('AI_DISABLED');
    if (this.inflight.size + this.starting >= MAX_CONCURRENT_JOBS) throw new HttpException('JOBS_BUSY', HttpStatus.TOO_MANY_REQUESTS);
    this.starting++;
    let topic: TopicRow;
    let job: typeof aiJobs.$inferSelect;
    try {
      topic = await this.loadTopic(input.topicKey);
      [job] = await this.db.insert(aiJobs).values({
        kind: 'GENERATE_QUESTIONS',
        status: 'QUEUED',
        input: { ...input },
        model: this.ai.modelId('content'),
        promptVersion: GEN_PROMPT_VERSION,
        createdBy: actorId,
      }).returning();
    } finally {
      this.starting--;
    }
    // No await between releasing the "starting" slot and registering the run: the slot count stays exact.
    const run: Promise<void> = this.run(job.id, input, topic, actorId)
      .catch((e) => this.logger.error(`job ${job.id} crashed: ${(e as Error).message}`))
      .finally(() => this.inflight.delete(run));
    this.inflight.add(run);
    await this.audit.log(actorId, 'ai.generate_questions', 'ai_job', job.id, { topicKey: input.topicKey, count: input.count });
    return toJobDTO(job);
  }

  /** Resolves when every running job has finished (tests, graceful shutdown). */
  async whenIdle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.whenIdle();
  }

  private async loadTopic(key: string): Promise<TopicRow> {
    const [topic] = await this.db
      .select({ id: syllabusNodes.id, key: syllabusNodes.key, titleAr: syllabusNodes.titleAr, titleFr: syllabusNodes.titleFr, domain: syllabusNodes.domain, sourceId: syllabusNodes.sourceId, level: syllabusNodes.level })
      .from(syllabusNodes)
      .where(eq(syllabusNodes.key, key))
      .limit(1);
    if (!topic) throw new NotFoundException('TOPIC_NOT_FOUND');
    if (topic.level !== 'TOPIC') throw new BadRequestException('TOPIC_LEVEL_REQUIRED');
    return topic;
  }

  private async run(jobId: string, input: GenerateInput, topic: TopicRow, actorId: string): Promise<void> {
    await this.db.update(aiJobs).set({ status: 'RUNNING' }).where(eq(aiJobs.id, jobId));
    const out: JobOutput = {
      topicKey: topic.key, requested: input.count, inserted: 0, aiReviewed: 0, draft: 0, discarded: 0, questionIds: [], rejected: [], batchErrors: [],
    };
    let tokensIn = 0;
    let tokensOut = 0;
    let model: string | null = null;
    try {
      const objectives = await this.db
        .select({ id: learningObjectives.id, key: learningObjectives.key, textAr: learningObjectives.textAr, textFr: learningObjectives.textFr, sourceChunkId: learningObjectives.sourceChunkId })
        .from(learningObjectives)
        .where(eq(learningObjectives.nodeId, topic.id))
        .orderBy(asc(learningObjectives.key));
      const excerpts = await this.loadExcerpts(topic, objectives.map((o) => o.sourceChunkId).filter((x): x is string => !!x));
      const examples = await this.db
        .select({ stem: questions.stem, options: questions.options, correct: questions.correct, explanation: questions.explanation })
        .from(questions)
        .where(and(eq(questions.topicId, topic.id), inArray(questions.status, ['PUBLISHED', 'HUMAN_REVIEWED', 'AI_REVIEWED']), eq(questions.type, 'MCQ_SINGLE')))
        .orderBy(sql`case ${questions.status} when 'PUBLISHED' then 0 when 'HUMAN_REVIEWED' then 1 else 2 end`, sql`random()`)
        .limit(3);
      const existing = await this.db.select({ id: questions.id, stem: questions.stem }).from(questions).where(eq(questions.topicId, topic.id));
      const known = existing.map((e) => ({ id: e.id, tokens: tokenSet(e.stem) }));
      const avoid = existing.slice(-AVOID_STEMS).map((e) => e.stem);

      const language = input.language ?? defaultLanguage(topic.domain);
      const objectiveIdByKey = new Map(objectives.map((o) => [o.key, o.id]));
      let remaining = input.count;
      while (remaining > 0) {
        const batch = Math.min(GEN_BATCH_SIZE, remaining);
        remaining -= batch;
        let items: unknown[];
        try {
          const r = await this.ai.json<{ questions?: unknown }>({
            model: 'content',
            system: generationSystemPrompt(),
            prompt: generationUserPrompt({
              topic, objectives: objectives as GenObjective[], examples, excerpts, avoid, count: batch, difficulty: input.difficulty ?? null, language,
            }),
            schemaHint: GEN_SCHEMA_HINT,
            maxTokens: GEN_MAX_TOKENS,
          });
          tokensIn += r.tokensIn;
          tokensOut += r.tokensOut;
          model = r.model;
          items = Array.isArray(r.data.questions) ? r.data.questions.slice(0, batch) : [];
          if (!items.length) out.batchErrors.push('EMPTY_BATCH');
        } catch (e) {
          out.batchErrors.push((e as Error).message.slice(0, 200));
          continue;
        }

        const inserted: { id: string; q: CandidateQuestion; reason: RejectReason | null; detail?: string }[] = [];
        for (const raw of items) {
          const q = coerceCandidate(raw, input.difficulty ?? 'MEDIUM');
          if (!q) {
            out.discarded++;
            continue;
          }
          if (input.difficulty) q.difficulty = input.difficulty;
          let reason: RejectReason | null = validateStructure(q);
          let detail: string | undefined;
          if (!reason) {
            const dup = findNearDuplicate(q.stem, known);
            if (dup) {
              reason = 'NEAR_DUPLICATE';
              detail = `similarity ${dup.similarity.toFixed(2)} with ${dup.id}`;
            }
          }
          const id = await this.insertDraft(q, topic, language, model ?? this.ai.modelId('content'), actorId, objectiveIdByKey, objectives[0]?.id ?? null);
          known.push({ id, tokens: tokenSet(q.stem) });
          avoid.push(q.stem);
          out.inserted++;
          out.questionIds.push(id);
          inserted.push({ id, q, reason, detail });
        }

        // Blind solve: the model sees stems and options, never the key, and must land on the same option.
        const toSolve = inserted.filter((x) => !x.reason);
        if (toSolve.length) {
          try {
            const r = await this.ai.json<{ answers?: unknown }>({
              model: 'content',
              system: solveSystemPrompt(),
              prompt: solveUserPrompt(toSolve.map((x, i) => ({ id: `q${i + 1}`, stem: x.q.stem, options: x.q.options }))),
              schemaHint: SOLVE_SCHEMA_HINT,
              maxTokens: SOLVE_MAX_TOKENS,
            });
            tokensIn += r.tokensIn;
            tokensOut += r.tokensOut;
            const answers = new Map<string, string | null>();
            for (const a of Array.isArray(r.data.answers) ? r.data.answers : []) {
              if (a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string') {
                const choice = (a as { choice?: unknown }).choice;
                answers.set((a as { id: string }).id, typeof choice === 'string' ? choice.trim().toLowerCase() : null);
              }
            }
            toSolve.forEach((x, i) => {
              const choice = answers.get(`q${i + 1}`);
              if (choice !== x.q.correct[0]) {
                x.reason = 'BLIND_SOLVE_DISAGREES';
                x.detail = `solver answered ${choice ?? 'null'}, key is ${x.q.correct[0]}`;
              }
            });
          } catch (e) {
            for (const x of toSolve) {
              x.reason = 'BLIND_SOLVE_FAILED';
              x.detail = (e as Error).message.slice(0, 120);
            }
          }
        }

        for (const x of inserted) {
          if (x.reason) {
            await this.markRejected(x.id, x.q, x.reason, x.detail);
            out.rejected.push({ questionId: x.id, reason: x.reason, ...(x.detail ? { detail: x.detail } : {}) });
            out.draft++;
          } else {
            await this.db.update(questions).set({ status: 'AI_REVIEWED', updatedAt: new Date() }).where(and(eq(questions.id, x.id), eq(questions.status, 'DRAFT')));
            await this.audit.review('question', x.id, 'DRAFT', 'AI_REVIEWED', null, 'auto-validation: structure ok, no near-duplicate, blind solve agreed');
            out.aiReviewed++;
          }
        }
      }

      const failed = out.inserted === 0 && out.batchErrors.length > 0;
      await this.db.update(aiJobs).set({
        status: failed ? 'FAILED' : 'DONE', output: out, model, tokensIn, tokensOut, finishedAt: new Date(),
        error: failed ? out.batchErrors.join(' | ').slice(0, 1000) : null,
      }).where(eq(aiJobs.id, jobId));
    } catch (e) {
      this.logger.error(`generation job ${jobId} failed: ${(e as Error).message}`);
      await this.db.update(aiJobs).set({
        status: 'FAILED', output: out, model, tokensIn, tokensOut, finishedAt: new Date(), error: (e as Error).message.slice(0, 1000),
      }).where(eq(aiJobs.id, jobId));
    }
  }

  /** Objective-linked chunks first, then chunks of documents attached to the topic's source. */
  private async loadExcerpts(topic: TopicRow, chunkIds: string[]): Promise<GenExcerpt[]> {
    const rows: { title: string | null; filename: string | null; page: number; text: string }[] = [];
    if (chunkIds.length) {
      rows.push(...(await this.db
        .select({ title: sources.title, filename: sourceDocuments.filename, page: sourceChunks.page, text: sourceChunks.text })
        .from(sourceChunks)
        .innerJoin(sourceDocuments, eq(sourceDocuments.id, sourceChunks.documentId))
        .leftJoin(sources, eq(sources.id, sourceDocuments.sourceId))
        .where(inArray(sourceChunks.id, chunkIds))
        .limit(6)));
    }
    if (topic.sourceId && rows.length < 6) {
      rows.push(...(await this.db
        .select({ title: sources.title, filename: sourceDocuments.filename, page: sourceChunks.page, text: sourceChunks.text })
        .from(sourceChunks)
        .innerJoin(sourceDocuments, eq(sourceDocuments.id, sourceChunks.documentId))
        .leftJoin(sources, eq(sources.id, sourceDocuments.sourceId))
        .where(and(eq(sourceDocuments.sourceId, topic.sourceId), isNotNull(sourceChunks.text)))
        .orderBy(asc(sourceChunks.page), asc(sourceChunks.chunkIndex))
        .limit(6 - rows.length)));
    }
    let budget = MAX_EXCERPT_CHARS;
    const out: GenExcerpt[] = [];
    for (const r of rows) {
      if (budget <= 0) break;
      const text = r.text.slice(0, budget);
      budget -= text.length;
      out.push({ title: r.title ?? r.filename ?? 'document', page: r.page, text });
    }
    return out;
  }

  private async insertDraft(
    q: CandidateQuestion, topic: TopicRow, language: 'ar' | 'fr' | 'en', model: string, actorId: string,
    objectiveIdByKey: Map<string, string>, fallbackObjectiveId: string | null,
  ): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(questions).values({
        type: 'MCQ_SINGLE', domain: topic.domain, language, stem: q.stem, options: q.options, correct: q.correct, explanation: q.explanation,
        difficulty: q.difficulty, rating: DIFFICULTY_RATING[q.difficulty as Difficulty], topicId: topic.id, isGeneral: true, origin: 'AI_GENERATED',
        tags: ['ai-generated'], status: 'DRAFT', createdBy: actorId, aiModel: model, aiPromptVersion: GEN_PROMPT_VERSION,
      }).returning({ id: questions.id });
      const objectiveId = (q.objectiveKey && objectiveIdByKey.get(q.objectiveKey)) || fallbackObjectiveId;
      if (objectiveId) await tx.insert(questionObjectives).values({ questionId: row.id, objectiveId }).onConflictDoNothing();
      return row.id;
    });
  }

  private async markRejected(id: string, q: CandidateQuestion, reason: RejectReason, detail?: string): Promise<void> {
    const note = rejectionNote(reason, detail);
    await this.db.update(questions).set({
      tags: ['ai-generated', 'ai-rejected', `reject:${reason.toLowerCase()}`],
      explanation: `${q.explanation}\n\n${note}`,
      updatedAt: new Date(),
    }).where(eq(questions.id, id));
    await this.audit.review('question', id, 'DRAFT', 'DRAFT', null, note);
  }
}

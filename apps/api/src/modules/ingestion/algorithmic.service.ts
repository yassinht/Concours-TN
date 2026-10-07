import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DIFFICULTIES, DIFFICULTY_RATING } from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { aiJobs, contentReviews, learningObjectives, questionObjectives, questions, syllabusNodes } from '../../db/schema';
import { ALGO_KINDS, ALGO_TOPICS, ALGO_VERSION, generateAlgorithmic, makeRng, type AlgoQuestion } from './algorithmic';
import { sha256 } from './text.util';

export const AlgorithmicInput = z.object({
  kind: z.enum(ALGO_KINDS),
  count: z.number().int().min(1).max(100),
  difficulty: z.enum(DIFFICULTIES).optional(),
  language: z.enum(['ar', 'fr']).optional(),
  /** Reproducible batch (same seed → same items, already-stored ones are skipped). */
  seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
});
export type AlgorithmicInput = z.infer<typeof AlgorithmicInput>;

export interface AlgorithmicResult {
  jobId: string;
  kind: AlgorithmicInput['kind'];
  topicKey: string;
  requested: number;
  inserted: number;
  skippedDuplicates: number;
  questionIds: string[];
}

/**
 * POST /admin/ai/generate-algorithmic — correct-by-construction psychotechnical items (no AI). Their key is computed,
 * so they go straight to AI_REVIEWED (origin ALGORITHMIC); a human still publishes them. Each item has a stable ext_id
 * derived from its content, so the same item is never stored twice.
 */
@Injectable()
export class AlgorithmicService {
  private readonly logger = new Logger('AlgorithmicGenerator');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async generate(input: AlgorithmicInput, actorId: string): Promise<AlgorithmicResult> {
    const { topicKey, domain } = ALGO_TOPICS[input.kind];
    const [topic] = await this.db.select({ id: syllabusNodes.id }).from(syllabusNodes).where(eq(syllabusNodes.key, topicKey)).limit(1);
    if (!topic) throw new NotFoundException('TOPIC_NOT_FOUND');
    const objectives = await this.db.select({ id: learningObjectives.id }).from(learningObjectives).where(eq(learningObjectives.nodeId, topic.id));

    const rng = makeRng(input.seed);
    const language = input.language ?? 'ar';
    const fresh = new Map<string, AlgoQuestion>();
    let skippedDuplicates = 0;
    // Bounded attempts: small rule spaces (e.g. EASY letter series) can run out of unseen items.
    for (let round = 0; round < 5 && fresh.size < input.count; round++) {
      const batch = new Map<string, AlgoQuestion>();
      for (let i = 0; i < (input.count - fresh.size) * 3 && batch.size + fresh.size < input.count * 2; i++) {
        try {
          const q = generateAlgorithmic(input.kind, rng, { difficulty: input.difficulty, language });
          const extId = `algo:${input.kind.toLowerCase()}:${sha256(`${q.stem}|${q.options.map((o) => o.text).sort().join('|')}`).slice(0, 24)}`;
          if (!fresh.has(extId)) batch.set(extId, q);
        } catch (e) {
          this.logger.debug(`generator retry: ${(e as Error).message}`);
        }
      }
      if (!batch.size) continue;
      const stored = await this.db.select({ extId: questions.extId }).from(questions).where(inArray(questions.extId, [...batch.keys()]));
      const storedSet = new Set(stored.map((s) => s.extId));
      for (const [extId, q] of batch) {
        if (fresh.size >= input.count) break;
        if (storedSet.has(extId)) skippedDuplicates++;
        else fresh.set(extId, q);
      }
    }

    const questionIds: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const [extId, q] of fresh) {
        const [row] = await tx.insert(questions).values({
          extId, type: 'MCQ_SINGLE', domain, language: q.language, stem: q.stem, options: q.options, correct: q.correct,
          explanation: q.explanation, difficulty: q.difficulty, rating: DIFFICULTY_RATING[q.difficulty], topicId: topic.id, isGeneral: true,
          origin: 'ALGORITHMIC', status: 'AI_REVIEWED', tags: ['algorithmic', input.kind.toLowerCase(), `rule:${q.rule}`],
          aiPromptVersion: ALGO_VERSION, createdBy: actorId,
        }).onConflictDoNothing({ target: questions.extId, where: sql`ext_id is not null` }).returning({ id: questions.id });
        if (!row) {
          skippedDuplicates++;
          continue;
        }
        questionIds.push(row.id);
        if (objectives.length) {
          await tx.insert(questionObjectives).values(objectives.map((o) => ({ questionId: row.id, objectiveId: o.id }))).onConflictDoNothing();
        }
      }
      if (questionIds.length) {
        await tx.insert(contentReviews).values(questionIds.map((entityId) => ({
          entityType: 'question', entityId, fromStatus: null, toStatus: 'AI_REVIEWED', reviewerId: null,
          comment: `algorithmic (${ALGO_VERSION}): answer computed by construction, awaiting human review`,
        })));
      }
    });

    const result = { kind: input.kind, topicKey, requested: input.count, inserted: questionIds.length, skippedDuplicates, questionIds };
    const [job] = await this.db.insert(aiJobs).values({
      kind: 'GENERATE_ALGORITHMIC', status: 'DONE', input: { ...input }, output: result, model: null, promptVersion: ALGO_VERSION,
      tokensIn: 0, tokensOut: 0, createdBy: actorId, finishedAt: new Date(),
    }).returning({ id: aiJobs.id });
    await this.audit.log(actorId, 'ai.generate_algorithmic', 'ai_job', job.id, { kind: input.kind, inserted: questionIds.length });
    return { jobId: job.id, ...result };
  }
}

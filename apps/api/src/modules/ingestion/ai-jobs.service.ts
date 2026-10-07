import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { aiJobs } from '../../db/schema';

export type AiJobKind = 'EXTRACT_FACTS' | 'GENERATE_QUESTIONS' | 'GENERATE_ALGORITHMIC';
export type AiJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export interface AiJobDTO {
  id: string;
  kind: string;
  status: string;
  input: unknown;
  output: unknown;
  model: string | null;
  promptVersion: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function toJobDTO(j: typeof aiJobs.$inferSelect, opts: { withOutput?: boolean } = {}): AiJobDTO {
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    input: j.input,
    output: opts.withOutput === false ? null : j.output,
    model: j.model,
    promptVersion: j.promptVersion,
    tokensIn: j.tokensIn,
    tokensOut: j.tokensOut,
    error: j.error,
    createdBy: j.createdBy,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}

/** Read side of ai_jobs (every AI/heuristic/algorithmic content job is logged there by the services of this module). */
@Injectable()
export class AiJobsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(filter: { kind?: string; status?: string; limit: number }): Promise<AiJobDTO[]> {
    const where: SQL[] = [];
    if (filter.kind) where.push(eq(aiJobs.kind, filter.kind));
    if (filter.status) where.push(eq(aiJobs.status, filter.status));
    const rows = await this.db
      .select()
      .from(aiJobs)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(aiJobs.createdAt))
      .limit(filter.limit);
    return rows.map((r) => toJobDTO(r));
  }

  async get(id: string): Promise<AiJobDTO> {
    const [row] = await this.db.select().from(aiJobs).where(eq(aiJobs.id, id)).limit(1);
    if (!row) throw new NotFoundException('NOT_FOUND');
    return toJobDTO(row);
  }
}

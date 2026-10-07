import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import type { AttemptKind, ContentStatus } from '@ctn/shared';
import { readSession, type SessionUser } from '../../common/session';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { users } from '../../db/schema';

/** Late answers are still accepted this long after `expiresAt` (network latency, clock skew). */
export const EXAM_GRACE_MS = 60_000;
export const DIAGNOSTIC_SIZE = 24;
export const PRACTICE_DEFAULT = 10;
export const PRACTICE_MAX = 30;
export const OFFLINE_PACK_SIZE = 200;
/** Candidate sample size per pool query (random sample when the bank is larger). */
export const POOL_SAMPLE = 3000;
/** Syllabus nodes visible to learners (drafts and archived nodes are hidden). */
export const VISIBLE_NODE_STATUSES: ContentStatus[] = ['AI_REVIEWED', 'HUMAN_REVIEWED', 'PUBLISHED'];

export type AttemptMode = 'instant' | 'exam';

/** DIAGNOSTIC and MOCK simulate the exam (no feedback until submit); the rest give instant feedback. */
export function modeOf(kind: AttemptKind): AttemptMode {
  return kind === 'DIAGNOSTIC' || kind === 'MOCK' ? 'exam' : 'instant';
}

/** Instant-feedback kinds that count toward the free daily question limit. */
export function countsTowardLimit(kind: AttemptKind): boolean {
  return kind === 'PRACTICE' || kind === 'DAILY' || kind === 'REVIEW';
}

/** Questions (and lessons) that may be served: PUBLISHED, plus human/AI-reviewed ones in beta mode (flagged unreviewed). */
export function servableStatuses(): ContentStatus[] {
  return env().CONTENT_BETA_MODE ? ['PUBLISHED', 'HUMAN_REVIEWED', 'AI_REVIEWED'] : ['PUBLISHED'];
}

/** `(v1, v2, …)` with bound parameters — for `x in ${inList(values)}` in raw SQL. */
export function inList(values: readonly (string | number)[]): SQL {
  if (!values.length) return sql`(null)`;
  return sql`(${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Path ids that are not UUIDs can never match a row: answer 404 instead of a database cast error. */
export function assertUuid(v: string): string {
  if (!isUuid(v)) throw new NotFoundException('NOT_FOUND');
  return v;
}

export const paymentRequired = (code: 'LIMIT_REACHED' | 'PREMIUM_REQUIRED') => new HttpException(code, HttpStatus.PAYMENT_REQUIRED);

/** Parses an optional positive integer query parameter, clamped to [1, max]. */
export function intParam(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === 'string' && /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** Escapes LIKE wildcards so a key is matched literally as a prefix. */
export const likePrefix = (key: string) => `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}.%`;

type Req = Request & { user?: SessionUser | null; activeUserChecked?: boolean };

/**
 * Sessions outlive their user row (account deleted, guest merged on another device). Practice writes rows keyed by the
 * user, so stale sessions get a clean 401 instead of a foreign-key error.
 */
@Injectable()
export class PracticeUserGuard implements CanActivate {
  constructor(@InjectDb() private readonly db: Database) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (req.activeUserChecked) return true;
    if (req.user === undefined) req.user = readSession(req);
    const s = req.user;
    if (!s) throw new UnauthorizedException('SESSION_REQUIRED');
    const [u] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.id, s.id), isNull(users.deletedAt))).limit(1);
    if (!u) throw new UnauthorizedException('SESSION_REQUIRED');
    req.activeUserChecked = true;
    return true;
  }
}

/** Fixed-window in-memory limiter keyed per user (a speed bump for expensive or spammable endpoints). */
export class UserLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Throws 429 RATE_LIMITED when the user exceeded the window's budget. */
  hit(userId: string, now = Date.now()): void {
    if (this.hits.size > 10_000) for (const [k, b] of this.hits) if (b.resetAt <= now) this.hits.delete(k);
    let b = this.hits.get(userId);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(userId, b);
    }
    b.count++;
    if (b.count > this.limit) throw new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
  }

  reset(): void {
    this.hits.clear();
  }
}

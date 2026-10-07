import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Type, mixin } from '@nestjs/common';
import type { Request, Response } from 'express';
import { clientIp } from './auth.util';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window in-memory limiter. Good enough for a single API instance; with several instances each one enforces its
 * own window (limits are a speed bump against brute force / email bombing, not a quota).
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private static readonly MAX_KEYS = 50_000;

  /** Counts one hit and reports whether it is still within `limit` for the current window. */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; remaining: number; retryAfterS: number } {
    this.sweep(now);
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    const allowed = b.count <= limit;
    return { allowed, remaining: Math.max(0, limit - b.count), retryAfterS: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }

  /** Current count without incrementing (0 when the window has expired). */
  peek(key: string, now = Date.now()): number {
    const b = this.buckets.get(key);
    return b && b.resetAt > now ? b.count : 0;
  }

  clear(key?: string) {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }

  private sweep(now: number) {
    if (this.buckets.size < 5_000) return;
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    // Under a distributed flood, fail open rather than exhaust memory.
    if (this.buckets.size > RateLimiter.MAX_KEYS) this.buckets.clear();
  }
}

/** Process-wide limiter shared by every guard and service. */
export const rateLimiter = new RateLimiter();

export function tooManyRequests(res: Response | undefined, retryAfterS: number): HttpException {
  res?.setHeader('Retry-After', String(retryAfterS));
  return new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
}

/**
 * Per IP + route limiter: `@UseGuards(RateLimit(10))` → at most 10 requests per minute per client IP on that route.
 * Responds 429 `{ statusCode, message: 'RATE_LIMITED' }` with a Retry-After header.
 */
export function RateLimit(limit: number, windowMs = 60_000, bucket?: string): Type<CanActivate> {
  @Injectable()
  class RateLimitGuard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const http = ctx.switchToHttp();
      const req = http.getRequest<Request>();
      const name = bucket ?? `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`;
      const r = rateLimiter.hit(`${name}|${clientIp(req)}`, limit, windowMs);
      if (!r.allowed) throw tooManyRequests(http.getResponse<Response>(), r.retryAfterS);
      return true;
    }
  }
  return mixin(RateLimitGuard);
}

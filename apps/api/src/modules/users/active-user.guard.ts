import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import { users } from '../../db/schema';
import { readSession, type SessionUser } from '../../common/session';

type Req = Request & { user?: SessionUser | null; activeUserChecked?: boolean };

/**
 * JWTs stay valid after an account is deleted or a guest is merged into an account on another device.
 * Use after UserGuard/RegisteredGuard on personal-data routes: rejects sessions whose user row is gone or soft-deleted.
 */
@Injectable()
export class ActiveUserGuard implements CanActivate {
  constructor(@InjectDb() private readonly db: Database) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (req.activeUserChecked) return true;
    if (req.user === undefined) req.user = readSession(req);
    const s = req.user;
    if (!s) throw new UnauthorizedException('SESSION_REQUIRED');
    const [u] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, s.id), isNull(users.deletedAt)))
      .limit(1);
    if (!u) throw new UnauthorizedException('SESSION_REQUIRED');
    req.activeUserChecked = true;
    return true;
  }
}

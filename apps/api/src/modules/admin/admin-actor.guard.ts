import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { UserRole } from '@ctn/shared';
import { ROLES_KEY } from '../../common/auth.guards';
import { readSession, type SessionUser } from '../../common/session';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { users } from '../../db/schema';
import { isUuid } from './admin.util';

type Req = Request & { user?: SessionUser | null; adminActorChecked?: boolean };

/**
 * Runs after RolesGuard. A session JWT lives for 60 days and carries the role it was signed with, so a demoted or deleted
 * staff account would keep its powers until the cookie expires. Admin routes re-read the role from the database on every
 * request (one indexed lookup) and use that, never the token's copy.
 */
@Injectable()
export class AdminActorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (req.user === undefined) req.user = readSession(req);
    const session = req.user;
    if (!session || session.isGuest || !isUuid(session.id)) throw new UnauthorizedException('SESSION_REQUIRED');

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? ['ADMIN'];
    const [row] = await this.db
      .select({ role: users.role, isGuest: users.isGuest, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1);
    if (!row || row.deletedAt || row.isGuest) throw new UnauthorizedException('SESSION_REQUIRED');
    if (!roles.includes(row.role)) throw new ForbiddenException('FORBIDDEN');
    // Downstream code (@CurrentUser) sees the authoritative role.
    req.user = { ...session, role: row.role };
    req.adminActorChecked = true;
    return true;
  }
}

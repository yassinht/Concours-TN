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

type Req = Request & { user?: SessionUser | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs after RolesGuard on ingestion/AI admin routes. Session JWTs carry the role they were signed with for 60 days, so
 * a demoted or deleted editor would keep uploading documents and spending AI credits until the cookie expires. This
 * guard re-reads the role from the database (one indexed lookup) and exposes the authoritative role downstream.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (req.user === undefined) req.user = readSession(req);
    const session = req.user;
    if (!session || session.isGuest || !UUID_RE.test(session.id)) throw new UnauthorizedException('SESSION_REQUIRED');
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? ['ADMIN'];
    const [row] = await this.db
      .select({ role: users.role, isGuest: users.isGuest, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1);
    if (!row || row.deletedAt || row.isGuest) throw new UnauthorizedException('SESSION_REQUIRED');
    if (!roles.includes(row.role)) throw new ForbiddenException('FORBIDDEN');
    req.user = { ...session, role: row.role };
    return true;
  }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { UserRole } from '@ctn/shared';
import type { Database } from '../db/client';
import { InjectDb } from '../db/db.module';
import { users } from '../db/schema';
import { readSession, SessionUser } from './session';

type ReqWithUser = Request & {
  user?: SessionUser | null;
  /** Set once the session was checked against the users table during this request. */
  sessionValidated?: boolean;
  /** Read by the users module's ActiveUserGuard (kept for its routes) so the row is not fetched twice. */
  activeUserChecked?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessionOf(ctx: ExecutionContext): SessionUser | null {
  const req = ctx.switchToHttp().getRequest<ReqWithUser>();
  if (req.user === undefined) req.user = readSession(req);
  return req.user ?? null;
}

/**
 * A session JWT lives 60 days and carries the role and guest flag it was signed with. Every guarded request re-reads the
 * user row (one primary-key lookup) and rejects tokens of deleted or merged-away accounts and tokens older than the
 * account's token_version (password reset/change, account deletion). Downstream code (@CurrentUser) then sees the
 * authoritative role and guest flag, so a demoted editor loses access immediately.
 */
export async function validatedSession(ctx: ExecutionContext, db: Database): Promise<SessionUser | null> {
  const req = ctx.switchToHttp().getRequest<ReqWithUser>();
  const s = sessionOf(ctx);
  if (!s) return null;
  if (req.sessionValidated) return req.user ?? null;
  if (!UUID_RE.test(s.id)) {
    req.user = null;
    return null;
  }
  const [row] = await db
    .select({ role: users.role, isGuest: users.isGuest, deletedAt: users.deletedAt, tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, s.id))
    .limit(1);
  req.sessionValidated = true;
  if (!row || row.deletedAt || (s.tv ?? 0) !== row.tokenVersion) {
    req.user = null;
    return null;
  }
  req.user = { ...s, role: row.role, isGuest: row.isGuest, tv: row.tokenVersion };
  req.activeUserChecked = true;
  return req.user;
}

/** Requires any live session (guest or registered). Frontend creates a guest session with POST /auth/guest. */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(@InjectDb() private readonly db: Database) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!(await validatedSession(ctx, this.db))) throw new UnauthorizedException('SESSION_REQUIRED');
    return true;
  }
}

/** Requires a registered (non-guest) account. */
@Injectable()
export class RegisteredGuard implements CanActivate {
  constructor(@InjectDb() private readonly db: Database) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const u = await validatedSession(ctx, this.db);
    if (!u) throw new UnauthorizedException('SESSION_REQUIRED');
    if (u.isGuest) throw new UnauthorizedException('REGISTRATION_REQUIRED');
    return true;
  }
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Use with @Roles('ADMIN','EDITOR'). Checks the role stored in the database, not the token's copy. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? ['ADMIN'];
    const u = await validatedSession(ctx, this.db);
    if (!u || u.isGuest) throw new UnauthorizedException('SESSION_REQUIRED');
    if (!roles.includes(u.role)) throw new ForbiddenException('FORBIDDEN');
    return true;
  }
}

/** Current session user (or null when the route is public and no session exists). Validated when a guard ran first. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser | null => sessionOf(ctx));

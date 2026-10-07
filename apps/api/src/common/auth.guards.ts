import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@ctn/shared';
import { readSession, SessionUser } from './session';

type ReqWithUser = Request & { user?: SessionUser | null };

function sessionOf(ctx: ExecutionContext): SessionUser | null {
  const req = ctx.switchToHttp().getRequest<ReqWithUser>();
  if (req.user === undefined) req.user = readSession(req);
  return req.user ?? null;
}

/** Requires any session (guest or registered). Frontend creates a guest session with POST /auth/guest. */
@Injectable()
export class UserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!sessionOf(ctx)) throw new UnauthorizedException('SESSION_REQUIRED');
    return true;
  }
}

/** Requires a registered (non-guest) account. */
@Injectable()
export class RegisteredGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const u = sessionOf(ctx);
    if (!u) throw new UnauthorizedException('SESSION_REQUIRED');
    if (u.isGuest) throw new UnauthorizedException('REGISTRATION_REQUIRED');
    return true;
  }
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Use with @Roles('ADMIN','EDITOR'). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? ['ADMIN'];
    const u = sessionOf(ctx);
    if (!u || u.isGuest) throw new UnauthorizedException('SESSION_REQUIRED');
    if (!roles.includes(u.role)) throw new ForbiddenException('FORBIDDEN');
    return true;
  }
}

/** Current session user (or null when the route is public and no session exists). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser | null => sessionOf(ctx));

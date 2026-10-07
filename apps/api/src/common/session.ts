import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '@ctn/shared';

export const SESSION_COOKIE = 'ctn_session';
const MAX_AGE_S = 60 * 60 * 24 * 60; // 60 days

export interface SessionUser {
  id: string;
  role: UserRole;
  isGuest: boolean;
}

export function signSession(u: SessionUser): string {
  return jwt.sign({ sub: u.id, role: u.role, guest: u.isGuest }, env().JWT_SECRET, { expiresIn: MAX_AGE_S });
}

export function verifySession(token: string): SessionUser | null {
  try {
    const p = jwt.verify(token, env().JWT_SECRET) as { sub: string; role: UserRole; guest: boolean };
    return { id: p.sub, role: p.role, isGuest: !!p.guest };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, u: SessionUser) {
  res.cookie(SESSION_COOKIE, signSession(u), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().COOKIE_SECURE,
    maxAge: MAX_AGE_S * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Reads the session from cookie or `Authorization: Bearer <jwt>` header. */
export function readSession(req: Request): SessionUser | null {
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
  const header = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const token = cookie ?? header;
  return token ? verifySession(token) : null;
}

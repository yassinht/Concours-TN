import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import type { Locale } from '@ctn/shared';
import type { Database } from '../../db/client';
import { env } from '../../config/env';

/** A Drizzle transaction handle (same query API as the database). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

export const BCRYPT_COST = 10;
export const MAGIC_LINK_TTL_MS = 20 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Uppercase A-Z and 2-9 (0/1 excluded so codes survive being read aloud or copied by hand). */
const REFERRAL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_RE = /^[A-Z2-9]{8}$/;

export function generateReferralCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return out;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 32 random bytes, URL-safe. Only the sha256 is stored, so a DB leak never yields usable links. */
export function newOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function asLocale(v: string | null | undefined): Locale {
  return v === 'fr' ? 'fr' : 'ar';
}

/** Postgres error code/constraint, looking through Drizzle's DrizzleQueryError wrapper. */
export function pgError(e: unknown): { code?: string; constraint?: string } {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 4; depth++) {
    const c = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) {
      return { code: c.code, constraint: typeof c.constraint === 'string' ? c.constraint : undefined };
    }
    cur = c.cause;
  }
  return {};
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const p = pgError(e);
  return p.code === '23505' && (!constraint || p.constraint === constraint);
}

/**
 * Client IP for rate limiting. The browser reaches the API through the Next.js `/api` proxy, so the socket address is
 * the web server's; the left-most X-Forwarded-For entry is the real client.
 */
export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return (first && first.length <= 64 ? first : undefined) ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/** Only same-site relative paths are accepted as post-login destinations (prevents open redirects). */
export function safeNextPath(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}

export function appUrl(path: string): string {
  return `${env().APP_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function apiPublicUrl(path: string): string {
  return `${env().API_PUBLIC_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function isProduction(): boolean {
  return env().NODE_ENV === 'production';
}

/** Mirrors the account language into the web app's (non-httpOnly) locale cookie so pages render in the right language. */
export function setLocaleCookie(res: Response, locale: Locale) {
  res.cookie('ctn_lang', locale, { httpOnly: false, sameSite: 'lax', secure: env().COOKIE_SECURE, maxAge: 365 * 86_400_000, path: '/' });
}

/** Real calendar date in YYYY-MM-DD form (rejects 2025-02-30). */
export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

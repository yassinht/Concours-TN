import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Locale } from '@ctn/shared';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import { users } from '../../db/schema';
import type { SessionUser } from '../../common/session';
import { env } from '../../config/env';
import { AlertsTrigger } from './alerts-trigger.service';
import { AuthService } from './auth.service';
import { apiPublicUrl, appUrl, isUniqueViolation, normalizeEmail, safeEqual, safeNextPath, waitAtMost } from './auth.util';
import type { UserRow } from './me.service';

export const OAUTH_STATE_COOKIE = 'ctn_oauth';
const STATE_TTL_MS = 10 * 60_000;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const GoogleUserInfo = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().email().max(200).optional(),
  email_verified: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === 'true'),
  name: z.string().max(300).optional(),
  locale: z.string().max(35).optional(),
});
export type GoogleProfile = z.infer<typeof GoogleUserInfo>;

/** Google sign-in with the plain OAuth2 authorization-code flow (no passport). */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger('GoogleOAuth');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly auth: AuthService,
    private readonly alerts: AlertsTrigger,
  ) {}

  enabled(): boolean {
    const e = env();
    return !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
  }

  private redirectUri(): string {
    return apiPublicUrl('/auth/google/callback');
  }

  /** GET /auth/google — sets the anti-CSRF state cookie and returns Google's consent URL. */
  start(res: Response, next: unknown): string {
    if (!this.enabled()) throw new NotFoundException('GOOGLE_DISABLED');
    const state = randomBytes(24).toString('base64url');
    const nextPath = Buffer.from(safeNextPath(next)).toString('base64url');
    res.cookie(OAUTH_STATE_COOKIE, `${state}.${nextPath}`, {
      httpOnly: true,
      sameSite: 'lax', // must survive the top-level redirect back from accounts.google.com
      secure: env().COOKIE_SECURE,
      maxAge: STATE_TTL_MS,
      path: '/',
    });
    const params = new URLSearchParams({
      client_id: env().GOOGLE_CLIENT_ID as string,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      access_type: 'online',
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /** GET /auth/google/callback — signs the user in and returns where to redirect (never throws after the state check). */
  async callback(req: Request, res: Response, session: SessionUser | null, preferredLocale: Locale | undefined): Promise<string> {
    if (!this.enabled()) throw new NotFoundException('GOOGLE_DISABLED');
    const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    const [expectedState, nextEnc] = typeof raw === 'string' ? raw.split('.') : [];
    const next = nextEnc ? safeNextPath(Buffer.from(nextEnc, 'base64url').toString('utf8')) : '/app';
    const { code, state, error } = req.query as Record<string, unknown>;
    if (typeof error === 'string') return appUrl('/login?error=google_cancelled');
    if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || !safeEqual(state, expectedState)) {
      return appUrl('/login?error=google_state');
    }

    try {
      const profile = await this.fetchProfile(code);
      const { user, created } = await this.resolveUser(profile, session, preferredLocale);
      await this.auth.signInAs(user, session, res);
      if (created) {
        await waitAtMost(this.auth.sendWelcome(user), 2000);
        await this.alerts.run(user.id, 'google-signup');
      }
      return appUrl(next);
    } catch (e) {
      this.logger.warn(`google sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
      return appUrl('/login?error=google_failed');
    }
  }

  private async fetchProfile(code: string): Promise<GoogleProfile> {
    const e = env();
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: e.GOOGLE_CLIENT_ID as string,
        client_secret: e.GOOGLE_CLIENT_SECRET as string,
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new Error(`token exchange HTTP ${tokenRes.status}`);
    const tokens = (await tokenRes.json()) as { access_token?: unknown };
    if (typeof tokens.access_token !== 'string') throw new Error('token exchange: no access_token');

    const infoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!infoRes.ok) throw new Error(`userinfo HTTP ${infoRes.status}`);
    return GoogleUserInfo.parse(await infoRes.json());
  }

  /**
   * Links by google_sub, then by verified email; otherwise upgrades the current guest (keeps its diagnostic) or creates
   * an account. Unverified Google emails are never attached, so nobody can claim someone else's address.
   */
  async resolveUser(p: GoogleProfile, session: SessionUser | null, preferredLocale?: Locale): Promise<{ user: UserRow; created: boolean }> {
    const existing = await this.findLinked(p);
    if (existing) return { user: existing, created: false };

    const email = p.email && p.email_verified ? normalizeEmail(p.email) : null;
    const name = p.name?.trim().slice(0, 120) || null;
    const locale: Locale = preferredLocale ?? (p.locale?.toLowerCase().startsWith('fr') ? 'fr' : 'ar');
    try {
      const guest = session?.isGuest ? await this.auth.activeGuest(session.id) : null;
      if (guest) {
        const [u] = await this.db
          .update(users)
          .set({ isGuest: false, email, name: guest.name ?? name, googleSub: p.sub, emailVerifiedAt: email ? new Date() : null, lastActiveAt: new Date() })
          .where(and(eq(users.id, guest.id), eq(users.isGuest, true), isNull(users.deletedAt)))
          .returning();
        if (u) return { user: u, created: true };
      }
      const user = await this.auth.createUser({ isGuest: false, email, name, googleSub: p.sub, emailVerifiedAt: email ? new Date() : null, locale });
      return { user, created: true };
    } catch (e) {
      // Two callbacks raced (double click): the other one created the account — use it.
      if (isUniqueViolation(e) || e instanceof ConflictException) {
        const again = await this.findLinked(p);
        if (again) return { user: again, created: false };
      }
      throw e;
    }
  }

  private async findLinked(p: GoogleProfile): Promise<UserRow | null> {
    const [bySub] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.googleSub, p.sub), isNull(users.deletedAt)))
      .limit(1);
    if (bySub) return bySub;
    if (!p.email || !p.email_verified) return null;
    const byEmail = await this.auth.findByEmail(p.email);
    if (!byEmail || byEmail.isGuest) return null;
    const [linked] = await this.db
      .update(users)
      .set({ googleSub: p.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() })
      .where(eq(users.id, byEmail.id))
      .returning();
    return linked ?? null;
  }
}

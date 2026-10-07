import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Response } from 'express';
import type { Locale, LoginInput, MeDTO, RegisterInput } from '@ctn/shared';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import { authTokens, referrals, userProfiles, userStats, users } from '../../db/schema';
import { clearSessionCookie, setSessionCookie, type SessionUser } from '../../common/session';
import { MailService } from '../notifications/mail.service';
import { AlertsTrigger } from './alerts-trigger.service';
import {
  BCRYPT_COST, MAGIC_LINK_TTL_MS, REFERRAL_CODE_RE, RESET_TTL_MS, VERIFY_TTL_MS, apiPublicUrl, appUrl, asLocale,
  generateReferralCode, isProduction, isUniqueViolation, newOpaqueToken, normalizeEmail, setLocaleCookie, sha256, waitAtMost,
} from './auth.util';
import { GuestMergeService } from './guest-merge.service';
import { magicLinkMail, passwordChangedMail, resetPasswordMail, verifyEmailMail, welcomeMail, type MailContent } from './mail-templates';
import { MeService, type UserRow } from './me.service';
import { rateLimiter, tooManyRequests } from './rate-limit';

export type TokenKind = 'MAGIC_LINK' | 'RESET' | 'VERIFY';

export interface NewUserValues {
  isGuest: boolean;
  locale: Locale;
  email?: string | null;
  passwordHash?: string | null;
  name?: string | null;
  googleSub?: string | null;
  emailVerifiedAt?: Date | null;
}

const LOGIN_FAILURES_PER_EMAIL = 10;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const EMAIL_SENDS_PER_ADDRESS = 5;
const EMAIL_SEND_WINDOW_MS = 15 * 60_000;

let dummyHash: string | null = null;
/** Compared against when the email is unknown, so response time does not reveal which emails have accounts. */
function getDummyHash(): string {
  return (dummyHash ??= bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_COST));
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly me: MeService,
    private readonly merge: GuestMergeService,
    private readonly mail: MailService,
    private readonly alerts: AlertsTrigger,
  ) {}

  // ───────────── Accounts ─────────────

  /** Creates users + user_profiles + user_stats rows with a unique referral code (retries on the rare collision). */
  async createUser(v: NewUserValues): Promise<UserRow> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          const [u] = await tx
            .insert(users)
            .values({
              isGuest: v.isGuest,
              locale: v.locale,
              email: v.email ?? null,
              passwordHash: v.passwordHash ?? null,
              name: v.name ?? null,
              googleSub: v.googleSub ?? null,
              emailVerifiedAt: v.emailVerifiedAt ?? null,
              referralCode: generateReferralCode(),
              lastActiveAt: new Date(),
            })
            .returning();
          await tx.insert(userProfiles).values({ userId: u.id }).onConflictDoNothing();
          await tx.insert(userStats).values({ userId: u.id }).onConflictDoNothing();
          return u;
        });
      } catch (e) {
        if (isUniqueViolation(e, 'users_referral_code_uq')) continue;
        if (isUniqueViolation(e, 'users_email_uq')) throw new ConflictException('EMAIL_TAKEN');
        throw e;
      }
    }
    throw new InternalServerErrorException('REFERRAL_CODE_EXHAUSTED');
  }

  /** Active account owning this email (case-insensitive). */
  async findByEmail(email: string): Promise<UserRow | null> {
    const [u] = await this.db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${normalizeEmail(email)}`, isNull(users.deletedAt)))
      .limit(1);
    return u ?? null;
  }

  async activeGuest(id: string): Promise<UserRow | null> {
    const [u] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.isGuest, true), isNull(users.deletedAt)))
      .limit(1);
    return u ?? null;
  }

  // ───────────── Sessions ─────────────

  /** POST /auth/guest — reuses a valid session, otherwise creates a guest account so the diagnostic works without signup. */
  async guest(session: SessionUser | null, locale: Locale | undefined, res: Response): Promise<{ user: MeDTO }> {
    if (session) {
      const existing = await this.me.findActive(session.id);
      if (existing && (session.tv ?? 0) === existing.tokenVersion) {
        this.issueSession(res, existing);
        return { user: await this.me.buildFor(existing) };
      }
    }
    const u = await this.createUser({ isGuest: true, locale: locale ?? 'ar' });
    this.issueSession(res, u);
    return { user: await this.me.buildFor(u) };
  }

  /** POST /auth/register — upgrades the current guest in place (keeps its attempts) or creates a new account. */
  async register(session: SessionUser | null, input: RegisterInput, res: Response, fallbackLocale?: Locale): Promise<{ user: MeDTO }> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim().slice(0, 120) || null;
    if (await this.findByEmail(email)) throw new ConflictException('EMAIL_TAKEN');
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    let user: UserRow | undefined;
    const guest = session?.isGuest ? await this.activeGuest(session.id) : null;
    if (guest) {
      try {
        [user] = await this.db
          .update(users)
          .set({ email, passwordHash, name, locale: input.locale ?? asLocale(guest.locale), isGuest: false, lastActiveAt: new Date() })
          .where(and(eq(users.id, guest.id), eq(users.isGuest, true), isNull(users.deletedAt)))
          .returning();
      } catch (e) {
        if (isUniqueViolation(e, 'users_email_uq')) throw new ConflictException('EMAIL_TAKEN');
        throw e;
      }
    }
    user ??= await this.createUser({ isGuest: false, email, passwordHash, name, locale: input.locale ?? fallbackLocale ?? 'ar' });

    await this.applyReferral(user.id, input.referralCode);
    this.issueSession(res, user);
    setLocaleCookie(res, asLocale(user.locale));
    // SMTP can be slow: never hold the signup response for more than a moment.
    await waitAtMost(this.sendWelcome(user), 2000);
    await this.alerts.run(user.id, 'register');
    return { user: await this.me.buildFor(user) };
  }

  /** POST /auth/login — generic INVALID_CREDENTIALS; merges the guest session's activity into the account. */
  async login(session: SessionUser | null, input: LoginInput, res: Response): Promise<{ user: MeDTO }> {
    const email = normalizeEmail(input.email);
    const failKey = `login-fail|${email}`;
    if (rateLimiter.peek(failKey) >= LOGIN_FAILURES_PER_EMAIL) throw tooManyRequests(res, Math.ceil(LOGIN_FAILURE_WINDOW_MS / 1000));

    const u = await this.findByEmail(email);
    const ok = await bcrypt.compare(input.password, u?.passwordHash ?? getDummyHash());
    if (!u || !u.passwordHash || u.isGuest || !ok) {
      rateLimiter.hit(failKey, LOGIN_FAILURES_PER_EMAIL, LOGIN_FAILURE_WINDOW_MS);
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    rateLimiter.clear(failKey);
    return { user: await this.signInAs(u, session, res) };
  }

  logout(res: Response): { ok: true } {
    clearSessionCookie(res);
    return { ok: true };
  }

  /** GET /auth/me — null when signed out or the account is gone; refreshes a stale JWT (role change, upgraded guest). */
  async currentUser(session: SessionUser | null, res: Response): Promise<{ user: MeDTO | null }> {
    if (!session) return { user: null };
    const u = await this.me.findActive(session.id);
    // Revoked: account deleted/merged, or the password changed since this token was signed.
    if (!u || (session.tv ?? 0) !== u.tokenVersion) {
      clearSessionCookie(res);
      return { user: null };
    }
    if (u.role !== session.role || u.isGuest !== session.isGuest) this.issueSession(res, u);
    await this.me.touchLastActive(u.id);
    return { user: await this.me.buildFor(u) };
  }

  /** Signs `u` in on this response, folding the current guest session (if any) into it first. */
  async signInAs(u: UserRow, session: SessionUser | null, res: Response): Promise<MeDTO> {
    let merged = false;
    if (session?.isGuest && session.id !== u.id) {
      try {
        merged = await this.merge.mergeGuestInto(session.id, u.id);
      } catch (e) {
        // Signing in matters more than carrying over a guest diagnostic; the guest row is left untouched (rolled back).
        this.logger.error(`guest merge ${session.id} → ${u.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, u.id));
    this.issueSession(res, u);
    setLocaleCookie(res, asLocale(u.locale));
    if (merged) await this.alerts.run(u.id, 'guest-merge');
    return this.me.buildFor(u);
  }

  issueSession(res: Response, u: Pick<UserRow, 'id' | 'role' | 'isGuest' | 'tokenVersion'>) {
    setSessionCookie(res, { id: u.id, role: u.role, isGuest: u.isGuest, tv: u.tokenVersion });
  }

  // ───────────── Magic link ─────────────

  async requestMagicLink(rawEmail: string): Promise<{ ok: true; devLink?: string }> {
    const email = normalizeEmail(rawEmail);
    // Same answer whether or not the account exists (no email enumeration); per-address cap against inbox flooding.
    if (!rateLimiter.hit(`mail-magic|${email}`, EMAIL_SENDS_PER_ADDRESS, EMAIL_SEND_WINDOW_MS).allowed) return { ok: true };
    const u = await this.findByEmail(email);
    if (!u || u.isGuest || !u.email) return { ok: true };
    const token = await this.createToken(u.id, 'MAGIC_LINK', MAGIC_LINK_TTL_MS);
    const link = apiPublicUrl(`/auth/magic/${token}`);
    await this.safeSend(u.email, magicLinkMail(link, MAGIC_LINK_TTL_MS / 60_000));
    return isProduction() ? { ok: true } : { ok: true, devLink: link };
  }

  /** GET /auth/magic/:token — returns the URL to redirect to (app on success, login page with an error otherwise). */
  async consumeMagicLink(token: string, session: SessionUser | null, res: Response): Promise<string> {
    const row = await this.consumeToken(token, 'MAGIC_LINK');
    if (!row) return appUrl('/login?error=link_invalid');
    let u = await this.me.findActive(row.userId);
    if (!u || u.isGuest) return appUrl('/login?error=link_invalid');
    if (!u.emailVerifiedAt) {
      // Clicking the link proves ownership of the address.
      [u] = await this.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, u.id)).returning();
    }
    await this.signInAs(u, session, res);
    return appUrl('/app');
  }

  // ───────────── Password ─────────────

  async forgotPassword(rawEmail: string): Promise<{ ok: true; devLink?: string }> {
    const email = normalizeEmail(rawEmail);
    if (!rateLimiter.hit(`mail-reset|${email}`, EMAIL_SENDS_PER_ADDRESS, EMAIL_SEND_WINDOW_MS).allowed) return { ok: true };
    const u = await this.findByEmail(email);
    if (!u || u.isGuest || !u.email) return { ok: true };
    const token = await this.createToken(u.id, 'RESET', RESET_TTL_MS);
    const link = appUrl(`/reset?token=${encodeURIComponent(token)}`);
    await this.safeSend(u.email, resetPasswordMail(link, RESET_TTL_MS / 60_000));
    return isProduction() ? { ok: true } : { ok: true, devLink: link };
  }

  async resetPassword(token: string, password: string, session: SessionUser | null, res: Response): Promise<{ user: MeDTO }> {
    const row = await this.consumeToken(token, 'RESET');
    if (!row) throw new BadRequestException('TOKEN_INVALID');
    const u = await this.me.findActive(row.userId);
    if (!u || u.isGuest) throw new BadRequestException('TOKEN_INVALID');
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const [updated] = await this.db
      .update(users)
      // Signs out every other device: their JWTs carry the previous token_version.
      .set({ passwordHash, emailVerifiedAt: u.emailVerifiedAt ?? new Date(), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, u.id))
      .returning();
    await this.revokeTokens(u.id, ['RESET', 'MAGIC_LINK']);
    if (u.email) rateLimiter.clear(`login-fail|${normalizeEmail(u.email)}`);
    return { user: await this.signInAs(updated, session, res) };
  }

  /**
   * Registered users change (or, for Google/magic-link accounts, set) their password. Other devices are signed out
   * (token_version bump); this device gets a fresh session cookie when `res` is given.
   */
  async changePassword(userId: string, currentPassword: string | undefined, newPassword: string, res?: Response): Promise<{ ok: true }> {
    const u = await this.me.findActive(userId);
    if (!u || u.isGuest) throw new UnauthorizedException('REGISTRATION_REQUIRED');
    if (u.passwordHash) {
      const failKey = `pwchange-fail|${u.id}`;
      if (rateLimiter.peek(failKey) >= 5) throw tooManyRequests(undefined, 15 * 60);
      if (!currentPassword || !(await bcrypt.compare(currentPassword, u.passwordHash))) {
        rateLimiter.hit(failKey, 5, 15 * 60_000);
        // 400 (not 401): the session itself is fine, only the confirmation is wrong.
        throw new BadRequestException('INVALID_CREDENTIALS');
      }
      rateLimiter.clear(failKey);
    }
    const [updated] = await this.db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, u.id))
      .returning();
    if (res && updated) this.issueSession(res, updated);
    await this.revokeTokens(u.id, ['RESET', 'MAGIC_LINK']);
    if (u.email) await this.safeSend(u.email, passwordChangedMail());
    return { ok: true };
  }

  // ───────────── Email verification ─────────────

  async sendWelcome(u: UserRow): Promise<void> {
    if (!u.email) return;
    try {
      const verifyUrl = u.emailVerifiedAt ? null : apiPublicUrl(`/auth/verify/${await this.createToken(u.id, 'VERIFY', VERIFY_TTL_MS)}`);
      await this.safeSend(u.email, welcomeMail(u.name, verifyUrl));
    } catch (e) {
      this.logger.warn(`welcome mail for ${u.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async resendVerification(userId: string): Promise<{ ok: true; alreadyVerified?: boolean; devLink?: string }> {
    const u = await this.me.findActive(userId);
    if (!u || u.isGuest || !u.email) throw new UnauthorizedException('REGISTRATION_REQUIRED');
    if (u.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    if (!rateLimiter.hit(`mail-verify|${u.id}`, 3, 60 * 60_000).allowed) return { ok: true };
    const link = apiPublicUrl(`/auth/verify/${await this.createToken(u.id, 'VERIFY', VERIFY_TTL_MS)}`);
    await this.safeSend(u.email, verifyEmailMail(link));
    return isProduction() ? { ok: true } : { ok: true, devLink: link };
  }

  /** GET /auth/verify/:token — marks the email verified; returns where to redirect. */
  async verifyEmail(token: string): Promise<string> {
    const row = await this.consumeToken(token, 'VERIFY');
    if (!row) return appUrl('/app?emailVerified=0');
    await this.db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt), isNull(users.deletedAt)));
    return appUrl('/app?emailVerified=1');
  }

  // ───────────── Helpers ─────────────

  /** Referral codes never fail a registration: unknown/self codes are ignored; the reward is granted later by practice. */
  private async applyReferral(userId: string, rawCode: string | undefined): Promise<void> {
    const code = rawCode?.trim().toUpperCase();
    if (!code || !REFERRAL_CODE_RE.test(code)) return;
    try {
      const [referrer] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.referralCode, code), isNull(users.deletedAt), ne(users.id, userId)))
        .limit(1);
      if (!referrer) return;
      await this.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(referrals)
          .values({ referrerId: referrer.id, referredId: userId })
          .onConflictDoNothing()
          .returning({ id: referrals.id });
        if (inserted.length) {
          await tx.update(users).set({ referredBy: referrer.id }).where(and(eq(users.id, userId), isNull(users.referredBy)));
        }
      });
    } catch (e) {
      this.logger.warn(`referral ${code} for ${userId} not applied: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async createToken(userId: string, kind: TokenKind, ttlMs: number): Promise<string> {
    const { token, hash } = newOpaqueToken();
    await this.db.insert(authTokens).values({ userId, kind, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMs) });
    return token;
  }

  /** Atomically marks a valid token as used (single use) and returns it, or null if unknown/expired/used. */
  private async consumeToken(token: string, kind: TokenKind) {
    if (typeof token !== 'string' || token.length < 10 || token.length > 200) return null;
    const now = new Date();
    const [row] = await this.db
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
      .returning();
    return row ?? null;
  }

  private async revokeTokens(userId: string, kinds: TokenKind[]) {
    await this.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), inArray(authTokens.kind, kinds), isNull(authTokens.usedAt)));
  }

  private async safeSend(to: string, m: MailContent): Promise<void> {
    try {
      await this.mail.send(to, m.subject, m.html, m.text);
    } catch (e) {
      this.logger.warn(`mail "${m.subject}" not sent: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

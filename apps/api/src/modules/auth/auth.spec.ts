import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { CommonModule } from '../../common/common.module';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import {
  attempts, competitionFamilies, competitions, enrollments, follows, organizations, positions, referrals, userStats, users, waitlist,
  xpEvents,
} from '../../db/schema';
import { EntitlementsService } from '../billing/entitlements.service';
import { GrowthModule } from '../growth/growth.module';
import { AlertsService } from '../notifications/alerts.service';
import { MailService } from '../notifications/mail.service';
import { UsersModule } from '../users/users.module';
import { AuthModule } from './auth.module';
import { displayedStreak } from './me.service';
import { RateLimiter, rateLimiter } from './rate-limit';

const alertsMock = {
  matchUser: jest.fn(async (_userId: string) => ({ matched: 0 })),
  matchCompetition: jest.fn(async (_competitionId: string) => ({ matchedUsers: 0, notified: 0 })),
};
const mailMock = { send: jest.fn(async (_to: string, _subject: string, _html: string, _text?: string) => undefined) };
const entitlementsMock = {
  get: jest.fn(async (_userId: string) => ({
    premium: false,
    planCode: null,
    endsAt: null,
    limits: { questionsPerDay: 20, tutorPerDay: 3, mocksTotal: 1, offline: false },
  })),
  consume: jest.fn(async () => ({ allowed: true, remaining: null })),
  canStartMock: jest.fn(async () => true),
  grantDays: jest.fn(async () => undefined),
};

@Global()
@Module({
  providers: [
    { provide: AlertsService, useValue: alertsMock },
    { provide: MailService, useValue: mailMock },
    { provide: EntitlementsService, useValue: entitlementsMock },
  ],
  exports: [AlertsService, MailService, EntitlementsService],
})
class GlobalMocksModule {}

const run = randomBytes(4).toString('hex');
const EMAIL = `auth-${run}@test.concours.tn`;
const PASSWORD = 'correct-horse-42';

describe('auth, users & growth (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let agent: ReturnType<typeof request.agent>;
  let accountId: string;
  let familyA: { id: string; slug: string };
  let familyB: { id: string; slug: string };
  let orgId: string;
  /** Every user row a test creates, so a failing test cannot leave guests behind. */
  const createdUserIds: string[] = [];
  const examDate = `${new Date().getUTCFullYear() + 1}-06-15`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule, CommonModule, GlobalMocksModule, AuthModule, UsersModule, GrowthModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get<Database>(DB);
    agent = request.agent(app.getHttpServer());

    const [org] = await db.insert(organizations).values({ slug: `test-org-${run}`, nameAr: 'منظمة', nameFr: 'Organisation test' }).returning();
    orgId = org.id;
    const [a, b] = await db
      .insert(competitionFamilies)
      .values([
        { slug: `test-douane-${run}`, organizationId: org.id, field: 'CUSTOMS', nameAr: 'الديوانة', nameFr: 'Douane' },
        { slug: `test-police-${run}`, organizationId: org.id, field: 'SECURITY', nameAr: 'الأمن', nameFr: 'Police' },
      ])
      .returning();
    familyA = { id: a.id, slug: a.slug };
    familyB = { id: b.id, slug: b.slug };
    await db.insert(positions).values({ familyId: b.id, slug: 'agent', titleAr: 'عون', titleFr: 'Agent' });
    await db.insert(competitions).values({ familyId: a.id, year: new Date().getUTCFullYear() + 1, status: 'ANNOUNCED', examDate });
  });

  beforeEach(() => {
    rateLimiter.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(users).where(like(users.email, `%-${run}@test.concours.tn`));
      if (accountId) createdUserIds.push(accountId);
      if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
      await db.delete(waitlist).where(like(waitlist.email, `%-${run}@test.concours.tn`));
      await db.delete(competitionFamilies).where(inArray(competitionFamilies.id, [familyA.id, familyB.id]));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await app?.close();
  });

  // ───────────── guest → register → me → logout → login ─────────────

  let guestId: string;

  it('creates a guest session (with profile, stats and a referral code) and reuses it', async () => {
    const r1 = await agent.post('/auth/guest').send({ locale: 'fr' }).expect(200);
    expect(r1.body.user).toMatchObject({ isGuest: true, email: null, locale: 'fr', role: 'USER' });
    expect(r1.body.user.referralCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(r1.body.user.onboarding).toEqual({ hasProfile: false, hasEnrollment: false, diagnosticDone: false });
    expect(r1.body.user.premium).toEqual({ active: false, planCode: null, endsAt: null });
    guestId = r1.body.user.id;
    createdUserIds.push(guestId);

    const r2 = await agent.post('/auth/guest').send({}).expect(200);
    expect(r2.body.user.id).toBe(guestId);

    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, guestId));
    expect(stats).toBeDefined();
  });

  it('registers by upgrading the guest in place (same id, keeps its diagnostic)', async () => {
    await db.insert(attempts).values({ userId: guestId, kind: 'DIAGNOSTIC', questionIds: [], submittedAt: new Date(), score: 0.5, correctCount: 12 });

    const r = await agent.post('/auth/register').send({ email: EMAIL.toUpperCase(), password: PASSWORD, name: ' Amira ' }).expect(200);
    accountId = r.body.user.id;
    expect(accountId).toBe(guestId);
    expect(r.body.user).toMatchObject({ isGuest: false, email: EMAIL, name: 'Amira', locale: 'fr' });
    expect(r.body.user.onboarding.diagnosticDone).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('passwordHash');

    expect(alertsMock.matchUser).toHaveBeenCalledWith(accountId);
    // Welcome mail with an email-confirmation link.
    expect(mailMock.send).toHaveBeenCalledWith(EMAIL, expect.any(String), expect.stringContaining('/auth/verify/'), expect.any(String));
    const [row] = await db.select().from(users).where(eq(users.id, accountId));
    expect(row.isGuest).toBe(false);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('GET /auth/me returns the registered account', async () => {
    const r = await agent.get('/auth/me').expect(200);
    expect(r.body.user).toMatchObject({ id: accountId, isGuest: false, email: EMAIL });
    expect(r.body.user.stats).toEqual({ xp: 0, level: 1, streak: 0 });
    const [row] = await db.select({ lastActiveAt: users.lastActiveAt }).from(users).where(eq(users.id, accountId));
    expect(row.lastActiveAt).toBeInstanceOf(Date);
  });

  it('logout clears the session', async () => {
    await agent.post('/auth/logout').send({}).expect(200, { ok: true });
    const r = await agent.get('/auth/me').expect(200);
    expect(r.body.user).toBeNull();
  });

  it('login merges a new guest session (attempts, XP, enrollments) into the account and deletes the guest', async () => {
    const g = await agent.post('/auth/guest').send({}).expect(200);
    const guest2 = g.body.user.id as string;
    createdUserIds.push(guest2);
    expect(guest2).not.toBe(accountId);
    await db.insert(attempts).values({ userId: guest2, kind: 'PRACTICE', questionIds: [], submittedAt: new Date(), score: 1 });
    await db.insert(xpEvents).values({ userId: guest2, amount: 15, reason: 'test' });
    await db.update(userStats).set({ xpTotal: 15, streakCurrent: 2, streakLongest: 3 }).where(eq(userStats.userId, guest2));
    await agent.post('/me/enrollments').send({ familySlug: familyB.slug }).expect(201);

    const r = await agent.post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    expect(r.body.user.id).toBe(accountId);
    expect(r.body.user.stats.xp).toBe(15);
    expect(r.body.user.onboarding.hasEnrollment).toBe(true);

    const rows = await db.select({ kind: attempts.kind }).from(attempts).where(eq(attempts.userId, accountId));
    expect(rows.map((x) => x.kind).sort()).toEqual(['DIAGNOSTIC', 'PRACTICE']);
    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, accountId));
    expect(stats.streakLongest).toBe(3);
    expect(await db.select().from(users).where(eq(users.id, guest2))).toHaveLength(0);
    const f = await db.select().from(follows).where(and(eq(follows.userId, accountId), eq(follows.familyId, familyB.id)));
    expect(f).toHaveLength(1);
    expect(alertsMock.matchUser).toHaveBeenCalledWith(accountId);
    // the moved enrollment is cleaned up for the following tests
    await db.delete(enrollments).where(eq(enrollments.userId, accountId));
  });

  it('rejects a wrong password (generic 401) and a duplicate email (409)', async () => {
    const bad = await request(app.getHttpServer()).post('/auth/login').send({ email: EMAIL, password: 'wrong-password' }).expect(401);
    expect(bad.body.message).toBe('INVALID_CREDENTIALS');
    const unknown = await request(app.getHttpServer()).post('/auth/login').send({ email: `nobody-${run}@test.concours.tn`, password: 'x' }).expect(401);
    expect(unknown.body.message).toBe('INVALID_CREDENTIALS');

    const dup = await request(app.getHttpServer()).post('/auth/register').send({ email: EMAIL, password: PASSWORD, name: 'Other' }).expect(409);
    expect(dup.body.message).toBe('EMAIL_TAKEN');

    const invalid = await request(app.getHttpServer()).post('/auth/register').send({ email: 'not-an-email', password: 'short' }).expect(400);
    expect(invalid.body.message).toBe('VALIDATION_FAILED');
  });

  it('rate-limits credential endpoints per IP', async () => {
    const server = request(app.getHttpServer());
    for (let i = 0; i < 10; i++) await server.post('/auth/login').send({ email: `rl-${run}@test.concours.tn`, password: 'x' }).expect(401);
    const r = await server.post('/auth/login').send({ email: `rl-${run}@test.concours.tn`, password: 'x' }).expect(429);
    expect(r.body.message).toBe('RATE_LIMITED');
    expect(r.headers['retry-after']).toBeDefined();
  });

  // ───────────── profile ─────────────

  it('updates the profile and re-runs alert matching only when eligibility inputs change', async () => {
    const r = await agent
      .put('/me/profile')
      .send({ name: 'Amira B.', birthDate: '1999-05-01', diplomaLevel: 'LICENCE', specialties: ['Informatique', 'Informatique '], gender: 'F', alertChannels: ['EMAIL'] })
      .expect(200);
    expect(r.body).toMatchObject({
      name: 'Amira B.',
      email: EMAIL,
      birthDate: '1999-05-01',
      diplomaLevel: 'LICENCE',
      specialties: ['Informatique'],
      gender: 'F',
      alertsEnabled: true,
      alertChannels: ['IN_APP', 'EMAIL'],
    });
    expect(alertsMock.matchUser).toHaveBeenCalledTimes(1);
    expect(alertsMock.matchUser).toHaveBeenCalledWith(accountId);

    alertsMock.matchUser.mockClear();
    const r2 = await agent.put('/me/profile').send({ dailyReminderHour: 19, locale: 'ar' }).expect(200);
    expect(r2.body).toMatchObject({ dailyReminderHour: 19, locale: 'ar', birthDate: '1999-05-01' });
    expect(alertsMock.matchUser).not.toHaveBeenCalled();

    await agent.put('/me/profile').send({ alertFields: ['CUSTOMS'] }).expect(200);
    expect(alertsMock.matchUser).toHaveBeenCalledTimes(1);

    const g = await agent.get('/me/profile').expect(200);
    expect(g.body.alertFields).toEqual(['CUSTOMS']);

    const bad = await agent.put('/me/profile').send({ birthDate: '1999-02-30' }).expect(400);
    expect(bad.body.message).toBe('VALIDATION_FAILED');

    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.user.onboarding.hasProfile).toBe(true);
  });

  // ───────────── enrollments ─────────────

  it('upserts enrollments by family, keeps exactly one primary and follows the family', async () => {
    const e1 = await agent.post('/me/enrollments').send({ familySlug: familyA.slug }).expect(201);
    expect(e1.body).toMatchObject({ familySlug: familyA.slug, familyName_fr: 'Douane', isPrimary: true, dailyMinutes: 30, positionSlug: null });
    // prefilled with the announced edition's exam date
    expect(e1.body.targetExamDate).toBe(examDate);
    expect(alertsMock.matchUser).toHaveBeenCalledWith(accountId);

    const e1b = await agent.post('/me/enrollments').send({ familySlug: familyA.slug, dailyMinutes: 60 }).expect(201);
    expect(e1b.body).toMatchObject({ id: e1.body.id, dailyMinutes: 60, isPrimary: true, targetExamDate: examDate });

    const e2 = await agent.post('/me/enrollments').send({ familySlug: familyB.slug, positionSlug: 'agent', isPrimary: true }).expect(201);
    expect(e2.body).toMatchObject({ positionSlug: 'agent', positionTitle_fr: 'Agent', isPrimary: true });

    let list = (await agent.get('/me/enrollments').expect(200)).body as { id: string; isPrimary: boolean; familySlug: string }[];
    expect(list).toHaveLength(2);
    expect(list.filter((e) => e.isPrimary).map((e) => e.familySlug)).toEqual([familyB.slug]);

    const patched = await agent.patch(`/me/enrollments/${e1.body.id}`).send({ isPrimary: true, targetExamDate: null }).expect(200);
    expect(patched.body).toMatchObject({ isPrimary: true, targetExamDate: null, dailyMinutes: 60 });

    const followsList = (await agent.get('/me/follows').expect(200)).body as { familySlug: string }[];
    expect(followsList.map((f) => f.familySlug).sort()).toEqual([familyA.slug, familyB.slug].sort());

    await agent.delete(`/me/enrollments/${e1.body.id}`).expect(200, { ok: true });
    list = (await agent.get('/me/enrollments').expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ familySlug: familyB.slug, isPrimary: true });

    await agent.post('/me/enrollments').send({ familySlug: `missing-${run}` }).expect(404);
    await agent.post('/me/enrollments').send({ familySlug: familyA.slug, positionSlug: 'no-such-position' }).expect(404);
    await agent.delete(`/me/enrollments/${e1.body.id}`).expect(404);
    await agent.patch('/me/enrollments/not-a-uuid').send({ dailyMinutes: 20 }).expect(404);
  });

  // ───────────── referral ─────────────

  it('applies a referral code on registration (reward granted later)', async () => {
    const me = await agent.get('/auth/me').expect(200);
    const code = me.body.user.referralCode as string;
    const friend = request.agent(app.getHttpServer());
    const r = await friend
      .post('/auth/register')
      .send({ email: `friend-${run}@test.concours.tn`, password: PASSWORD, name: 'Friend', referralCode: code.toLowerCase() })
      .expect(200);
    const [ref] = await db.select().from(referrals).where(eq(referrals.referredId, r.body.user.id));
    expect(ref).toMatchObject({ referrerId: accountId, rewardedAt: null });

    const info = await agent.get('/me/referral').expect(200);
    expect(info.body).toMatchObject({ code, invited: 1, rewarded: 0, rewardDays: 7 });
    expect(info.body.link).toMatch(new RegExp(`/register\\?ref=${code}$`));

    // guests cannot use the referral endpoint
    const guest = request.agent(app.getHttpServer());
    await guest.post('/auth/guest').send({}).expect(200);
    const denied = await guest.get('/me/referral').expect(401);
    expect(denied.body.message).toBe('REGISTRATION_REQUIRED');
    createdUserIds.push((await guest.get('/auth/me')).body.user.id as string);
  });

  // ───────────── magic link & password reset ─────────────

  it('magic link signs in exactly once', async () => {
    const browser = request.agent(app.getHttpServer());
    const r = await browser.post('/auth/magic-link').send({ email: EMAIL }).expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.devLink).toMatch(/\/auth\/magic\/[A-Za-z0-9_-]{40,}$/);
    expect(mailMock.send).toHaveBeenCalledTimes(1);
    const path = new URL(r.body.devLink).pathname.replace(/^\/api/, '');

    const ok = await browser.get(path).expect(302);
    expect(ok.headers.location).toMatch(/\/app$/);
    expect(String(ok.headers['set-cookie'])).toContain('ctn_session=');
    const me = await browser.get('/auth/me').expect(200);
    expect(me.body.user.id).toBe(accountId);

    const reused = await request(app.getHttpServer()).get(path).expect(302);
    expect(reused.headers.location).toContain('/login?error=link_invalid');

    // unknown emails get the same answer and no email
    mailMock.send.mockClear();
    const unknown = await browser.post('/auth/magic-link').send({ email: `ghost-${run}@test.concours.tn` }).expect(200);
    expect(unknown.body).toEqual({ ok: true });
    expect(mailMock.send).not.toHaveBeenCalled();
  });

  it('password reset: single-use token, new password works, old one does not', async () => {
    const server = request(app.getHttpServer());
    const f = await server.post('/auth/password/forgot').send({ email: EMAIL }).expect(200);
    const token = new URL(f.body.devLink).searchParams.get('token') as string;
    expect(token.length).toBeGreaterThan(40);

    const NEW_PASSWORD = 'brand-new-password-7';
    const r = await server.post('/auth/password/reset').send({ token, password: NEW_PASSWORD }).expect(200);
    expect(r.body.user.id).toBe(accountId);
    const again = await server.post('/auth/password/reset').send({ token, password: NEW_PASSWORD }).expect(400);
    expect(again.body.message).toBe('TOKEN_INVALID');

    await server.post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(401);
    await server.post('/auth/login').send({ email: EMAIL, password: NEW_PASSWORD }).expect(200);

    // change it back through the authenticated endpoint (current password required)
    await agent.post('/auth/password/change').send({ currentPassword: 'wrong', newPassword: PASSWORD }).expect(400);
    await agent.post('/auth/password/change').send({ currentPassword: NEW_PASSWORD, newPassword: PASSWORD }).expect(200, { ok: true });
    await server.post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
  });

  it('Google sign-in is disabled (404 GOOGLE_DISABLED) without credentials', async () => {
    if (process.env.GOOGLE_CLIENT_ID) return;
    const r = await request(app.getHttpServer()).get('/auth/google').expect(404);
    expect(r.body.message).toBe('GOOGLE_DISABLED');
  });

  // ───────────── growth ─────────────

  it('stores a waitlist entry once per contact + family within 24h', async () => {
    const server = request(app.getHttpServer());
    const body = { email: `wait-${run}@test.concours.tn`, familySlug: 'garde-nationale', willingness: '20', utm: { source: 'tiktok' } };
    await server.post('/waitlist').send(body).expect(200, { ok: true });
    await server.post('/waitlist').send({ ...body, email: body.email.toUpperCase() }).expect(200, { ok: true });
    const rows = await db.select().from(waitlist).where(eq(waitlist.email, body.email));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ familySlug: 'garde-nationale', willingness: '20', utm: { source: 'tiktok' } });

    await server.post('/waitlist').send({ ...body, familySlug: 'douane' }).expect(200);
    expect(await db.select().from(waitlist).where(eq(waitlist.email, body.email))).toHaveLength(2);

    const bad = await server.post('/waitlist').send({ familySlug: 'douane' }).expect(400);
    expect(bad.body.message).toBe('VALIDATION_FAILED');
  });
});

describe('auth helpers', () => {
  it('RateLimiter allows `limit` hits per window', () => {
    const rl = new RateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rl.hit('k', 3, 60_000, t0).allowed).toBe(true);
    const blocked = rl.hit('k', 3, 60_000, t0 + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBe(59);
    expect(rl.hit('k', 3, 60_000, t0 + 60_001).allowed).toBe(true);
    expect(rl.hit('other', 3, 60_000, t0).allowed).toBe(true);
  });

  it('displayedStreak drops a broken streak but honours a freeze', () => {
    expect(displayedStreak(5, '2026-10-06', 0, '2026-10-07')).toBe(5);
    expect(displayedStreak(5, '2026-10-07', 0, '2026-10-07')).toBe(5);
    expect(displayedStreak(5, '2026-10-05', 1, '2026-10-07')).toBe(5);
    expect(displayedStreak(5, '2026-10-05', 0, '2026-10-07')).toBe(0);
    expect(displayedStreak(5, null, 1, '2026-10-07')).toBe(0);
  });
});

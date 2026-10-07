import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import request from 'supertest';

// env() is parsed once and cached: configure Google before any module that reads it is loaded (dynamic imports below).
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

const run = randomBytes(4).toString('hex');

describe('Google OAuth (e2e, Google endpoints stubbed)', () => {
  let app: INestApplication;
  let db: import('../../db/client').Database;
  let schema: typeof import('../../db/schema');
  let orm: typeof import('drizzle-orm');
  let rateLimiter: typeof import('./rate-limit').rateLimiter;
  const realFetch = global.fetch;
  let profile: Record<string, unknown>;
  const fetchCalls: string[] = [];

  beforeAll(async () => {
    const [{ DbModule, DB }, { CommonModule }, { AuthModule }, { AlertsService }, { MailService }, { EntitlementsService }] = await Promise.all([
      import('../../db/db.module'),
      import('../../common/common.module'),
      import('./auth.module'),
      import('../notifications/alerts.service'),
      import('../notifications/mail.service'),
      import('../billing/entitlements.service'),
    ]);
    schema = await import('../../db/schema');
    orm = await import('drizzle-orm');
    rateLimiter = (await import('./rate-limit')).rateLimiter;

    @Global()
    @Module({
      providers: [
        { provide: AlertsService, useValue: { matchUser: jest.fn(async () => ({ matched: 0 })) } },
        { provide: MailService, useValue: { send: jest.fn(async () => undefined) } },
        { provide: EntitlementsService, useValue: { get: jest.fn(async () => ({ premium: false, planCode: null, endsAt: null })) } },
      ],
      exports: [AlertsService, MailService, EntitlementsService],
    })
    class GlobalMocksModule {}

    const ref = await Test.createTestingModule({ imports: [DbModule, CommonModule, GlobalMocksModule, AuthModule] }).compile();
    app = ref.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get(DB);

    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      fetchCalls.push(url);
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(String(init?.body));
        if (body.get('code') !== 'good-code' || body.get('client_secret') !== 'test-client-secret') return new Response('{}', { status: 400 });
        return Response.json({ access_token: 'access-123', token_type: 'Bearer' });
      }
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        const auth = new Headers(init?.headers).get('authorization');
        return auth === 'Bearer access-123' ? Response.json(profile) : new Response('{}', { status: 401 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });

  beforeEach(() => rateLimiter.clear());

  afterAll(async () => {
    global.fetch = realFetch;
    if (db) {
      await db.delete(schema.users).where(orm.like(schema.users.email, `%-${run}@gmail.test`));
      await db.delete(schema.users).where(orm.like(schema.users.googleSub, `sub-${run}-%`));
    }
    await app?.close();
  });

  /** Runs /auth/google → (Google) → /auth/google/callback with the given browser agent. */
  async function signIn(browser: ReturnType<typeof request.agent>, opts: { next?: string; code?: string; tamperState?: boolean } = {}) {
    const start = await browser.get(`/auth/google${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`).expect(302);
    const consent = new URL(start.headers.location);
    expect(consent.origin + consent.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(consent.searchParams.get('client_id')).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(consent.searchParams.get('redirect_uri')).toMatch(/\/auth\/google\/callback$/);
    const state = consent.searchParams.get('state') as string;
    return browser.get(`/auth/google/callback?code=${opts.code ?? 'good-code'}&state=${opts.tamperState ? 'x' + state : state}`).expect(302);
  }

  it('upgrades the current guest into a Google account (keeps the same id) and honours a safe `next`', async () => {
    profile = { sub: `sub-${run}-1`, email: `Lina-${run}@gmail.test`, email_verified: true, name: 'Lina', locale: 'fr' };
    const browser = request.agent(app.getHttpServer());
    const guest = await browser.post('/auth/guest').send({ locale: 'ar' }).expect(200);

    const cb = await signIn(browser, { next: '/app/concours/douane' });
    expect(cb.headers.location).toMatch(/\/app\/concours\/douane$/);
    const me = await browser.get('/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ id: guest.body.user.id, isGuest: false, email: `lina-${run}@gmail.test`, name: 'Lina' });
    const [u] = await db.select().from(schema.users).where(orm.eq(schema.users.id, guest.body.user.id));
    expect(u.googleSub).toBe(`sub-${run}-1`);
    expect(u.emailVerifiedAt).toBeInstanceOf(Date);

    // second sign-in from a fresh browser finds the same account by google_sub; open redirects are refused
    const other = request.agent(app.getHttpServer());
    const again = await signIn(other, { next: '//evil.example/steal' });
    expect(again.headers.location).toMatch(/\/app$/);
    expect((await other.get('/auth/me')).body.user.id).toBe(guest.body.user.id);
  });

  it('links to an existing password account by verified email; ignores unverified emails', async () => {
    const browser = request.agent(app.getHttpServer());
    const reg = await browser.post('/auth/register').send({ email: `omar-${run}@gmail.test`, password: 'password-123', name: 'Omar' }).expect(200);
    await browser.post('/auth/logout').send({}).expect(200);

    profile = { sub: `sub-${run}-2`, email: `omar-${run}@gmail.test`, email_verified: true, name: 'Omar G' };
    await signIn(browser);
    expect((await browser.get('/auth/me')).body.user.id).toBe(reg.body.user.id);

    profile = { sub: `sub-${run}-3`, email: `omar-${run}@gmail.test`, email_verified: false, name: 'Impostor' };
    const fresh = request.agent(app.getHttpServer());
    await signIn(fresh);
    const me = (await fresh.get('/auth/me')).body.user;
    expect(me.id).not.toBe(reg.body.user.id);
    expect(me.email).toBeNull();
  });

  it('rejects a forged state and a failed code exchange without creating a session', async () => {
    profile = { sub: `sub-${run}-4`, email: `x-${run}@gmail.test`, email_verified: true };
    const browser = request.agent(app.getHttpServer());
    const forged = await signIn(browser, { tamperState: true });
    expect(forged.headers.location).toContain('/login?error=google_state');
    const failed = await signIn(browser, { code: 'bad-code' });
    expect(failed.headers.location).toContain('/login?error=google_failed');
    expect((await browser.get('/auth/me')).body.user).toBeNull();
    const cancelled = await browser.get('/auth/google/callback?error=access_denied').expect(302);
    expect(cancelled.headers.location).toContain('error=google_cancelled');
    expect(fetchCalls.filter((u) => u.includes('oauth2.googleapis.com')).length).toBeGreaterThan(0);
  });
});

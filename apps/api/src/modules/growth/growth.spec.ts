import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import { analyticsEvents, users, waitlist } from '../../db/schema';
import { signSession } from '../../common/session';
import { generateReferralCode } from '../auth/auth.util';
import { rateLimiter } from '../auth/rate-limit';
import { GrowthModule } from './growth.module';

const run = randomBytes(4).toString('hex');
const EVENT = `test_event_${run}`;

describe('growth (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const phone = `+2169${String(Date.now()).slice(-7)}`;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [DbModule, GrowthModule] }).compile();
    app = ref.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get<Database>(DB);
  });

  beforeEach(() => rateLimiter.clear());

  afterAll(async () => {
    if (db) {
      await db.delete(analyticsEvents).where(eq(analyticsEvents.name, EVENT));
      await db.delete(waitlist).where(eq(waitlist.phone, phone));
    }
    await app?.close();
  });

  it('records anonymous and signed-in events; a stale session is stored anonymously', async () => {
    const server = request(app.getHttpServer());
    await server.post('/events').send({ name: EVENT, props: { familySlug: 'douane' } }).expect(200, { ok: true });

    const [u] = await db.insert(users).values({ isGuest: true, referralCode: generateReferralCode() }).returning();
    const cookie = `ctn_session=${signSession({ id: u.id, role: 'USER', isGuest: true })}`;
    await server.post('/events').set('Cookie', cookie).send({ name: EVENT }).expect(200);
    const signedIn = await db.select().from(analyticsEvents).where(eq(analyticsEvents.userId, u.id));
    expect(signedIn).toHaveLength(1);
    await db.delete(users).where(eq(users.id, u.id));
    await server.post('/events').set('Cookie', cookie).send({ name: EVENT }).expect(200);

    const rows = await db.select().from(analyticsEvents).where(eq(analyticsEvents.name, EVENT));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => (r.props as Record<string, unknown>).familySlug === 'douane')?.userId).toBeNull();
    // the signed-in event lost its user when the account was deleted (FK set null); the stale one was stored anonymously
    expect(rows.every((r) => r.userId === null)).toBe(true);
  });

  it('validates event names and caps props at 2KB', async () => {
    const server = request(app.getHttpServer());
    await server.post('/events').send({ name: 'x'.repeat(61) }).expect(400);
    await server.post('/events').send({ name: 'bad name!' }).expect(400);
    const big = await server.post('/events').send({ name: EVENT, props: { blob: 'x'.repeat(2100) } }).expect(400);
    expect(big.body.message).toBe('VALIDATION_FAILED');
  });

  it('dedupes waitlist entries by phone + family and validates phones', async () => {
    const server = request(app.getHttpServer());
    await server.post('/waitlist').send({ phone, familySlug: 'protection-civile' }).expect(200, { ok: true });
    await server.post('/waitlist').send({ phone: phone.replace('+216', '+216 '), familySlug: 'protection-civile' }).expect(200);
    expect(await db.select().from(waitlist).where(eq(waitlist.phone, phone))).toHaveLength(1);
    await server.post('/waitlist').send({ phone: 'call me' }).expect(400);
  });
});

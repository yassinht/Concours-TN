import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { FREE_LIMITS } from '@ctn/shared';
import { CommonModule } from '../../common/common.module';
import { tunisToday } from '../../common/dates';
import { SESSION_COOKIE, signSession } from '../../common/session';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import { attempts, auditLogs, payments, plans, promoCodes, subscriptions, usageCounters, users } from '../../db/schema';
import { rateLimiter } from '../auth/rate-limit';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service';
import { BillingModule } from './billing.module';
import { BillingService, verificationMismatch } from './billing.service';
import { discountedAmount, extractUuid, limitsFromFeatures, manualInstructions, planRank, promoRejection, splitName } from './billing.util';
import { EntitlementsService } from './entitlements.service';
import { PaymentsService } from './payments.service';

const notifyMock = {
  notify: jest.fn(async (_userId: string, _input: NotifyInput) => 'n-1' as string | null),
  notifyMany: jest.fn(async (userIds: string[], _input: NotifyInput) => userIds.length),
};

@Global()
@Module({ providers: [{ provide: NotificationsService, useValue: notifyMock }], exports: [NotificationsService] })
class NotificationsMockModule {}

const run = randomBytes(4).toString('hex');
const DAY = 86_400_000;

function expectNear(actual: string | Date | null | undefined, expectedMs: number, toleranceMs = 60_000) {
  expect(actual).toBeTruthy();
  const t = new Date(actual as string | Date).getTime();
  expect(Math.abs(t - expectedMs)).toBeLessThan(toleranceMs);
}

describe('billing (entitlements, payments, checkout)', () => {
  let app: INestApplication;
  let db: Database;
  let ent: EntitlementsService;
  let pay: PaymentsService;
  let billing: BillingService;
  let monthPlan: typeof plans.$inferSelect;
  const createdUsers: string[] = [];
  const createdPromos: string[] = [];
  let seq = 0;

  async function makeUser(opts: { role?: 'USER' | 'ADMIN'; isGuest?: boolean; locale?: string } = {}) {
    seq++;
    const [u] = await db
      .insert(users)
      .values({
        email: opts.isGuest ? null : `billing-${run}-${seq}@test.concours.tn`,
        name: 'Amira Ben Salah',
        role: opts.role ?? 'USER',
        isGuest: opts.isGuest ?? false,
        locale: opts.locale ?? 'fr',
        referralCode: `B${run}${seq}`.toUpperCase().slice(0, 20),
      })
      .returning();
    createdUsers.push(u.id);
    const cookie = `${SESSION_COOKIE}=${signSession({ id: u.id, role: u.role, isGuest: u.isGuest })}`;
    return { id: u.id, cookie };
  }

  async function makePromo(code: string, values: Partial<typeof promoCodes.$inferInsert> = {}) {
    await db.insert(promoCodes).values({ code, percentOff: 25, maxUses: 10, ...values });
    createdPromos.push(code);
    return code;
  }

  async function pendingPayment(userId: string, opts: Partial<typeof payments.$inferInsert> = {}) {
    const [p] = await db
      .insert(payments)
      .values({ userId, planId: monthPlan.id, amountMillimes: monthPlan.priceMillimes, provider: 'MANUAL', status: 'PENDING', ...opts })
      .returning();
    return p;
  }

  async function activeSubs(userId: string) {
    return db.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'ACTIVE')));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule, CommonModule, NotificationsMockModule, BillingModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get<Database>(DB);
    ent = app.get(EntitlementsService);
    pay = app.get(PaymentsService);
    billing = app.get(BillingService);
    [monthPlan] = await db.select().from(plans).where(eq(plans.code, 'PREMIUM_MONTH')).limit(1);
    expect(monthPlan).toBeDefined();
  });

  beforeEach(() => {
    rateLimiter.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (db) {
      if (createdUsers.length) {
        await db.delete(auditLogs).where(inArray(auditLogs.actorId, createdUsers));
        await db.delete(users).where(inArray(users.id, createdUsers));
      }
      if (createdPromos.length) await db.delete(promoCodes).where(inArray(promoCodes.code, createdPromos));
    }
    await app?.close();
  });

  // ───────────── Pure helpers ─────────────

  describe('helpers', () => {
    it('computes discounts in whole millimes and clamps percentages', () => {
      expect(discountedAmount(19_000, 25)).toBe(14_250);
      expect(discountedAmount(19_000, 30)).toBe(13_300);
      expect(discountedAmount(45_000, 0)).toBe(45_000);
      expect(discountedAmount(45_000, 100)).toBe(0);
      expect(discountedAmount(45_000, 150)).toBe(0);
      expect(discountedAmount(45_000, -10)).toBe(45_000);
    });

    it('rejects promos that are inactive, expired or exhausted', () => {
      const base = { code: 'X', percentOff: 10, maxUses: 2, usedCount: 0, expiresAt: null, active: true };
      expect(promoRejection(base)).toBeNull();
      expect(promoRejection(null)).toBe('NOT_FOUND');
      expect(promoRejection({ ...base, active: false })).toBe('INACTIVE');
      expect(promoRejection({ ...base, expiresAt: new Date(Date.now() - 1000) })).toBe('EXPIRED');
      expect(promoRejection({ ...base, usedCount: 2 })).toBe('EXHAUSTED');
      expect(promoRejection({ ...base, maxUses: null, usedCount: 999 })).toBeNull();
    });

    it('extracts our payment id even when a provider appends its own query with "?"', () => {
      const id = '0b7e9a52-3f3c-4a59-9b1e-8f3f8b0c1d2e';
      expect(extractUuid(id)).toBe(id);
      expect(extractUuid(`${id}?payment_id=abc123`)).toBe(id);
      expect(extractUuid([id.toUpperCase()])).toBe(id);
      expect(extractUuid('nope')).toBeNull();
      expect(extractUuid(`x${id}`)).toBeNull();
      expect(extractUuid(undefined)).toBeNull();
    });

    it('maps plan features to limits and ranks plans by generosity', () => {
      expect(limitsFromFeatures('PREMIUM_MONTH', { questions_per_day: null, tutor_per_day: 50, mocks_total: null, offline: true }))
        .toEqual({ questionsPerDay: null, tutorPerDay: 50, mocksTotal: null, offline: true });
      // Missing keys fall back to the shared catalogue.
      expect(limitsFromFeatures('EXAM_PASS', {})).toEqual({ questionsPerDay: null, tutorPerDay: 80, mocksTotal: null, offline: true });
      expect(planRank({ tutor_per_day: 80, questions_per_day: null, mocks_total: null, offline: true }, 59_000))
        .toBeGreaterThan(planRank({ tutor_per_day: 50, questions_per_day: null, mocks_total: null, offline: true }, 19_000));
    });

    it('splits names and writes bilingual manual instructions with the reference', () => {
      expect(splitName('Amira Ben Salah')).toEqual({ firstName: 'Amira', lastName: 'Ben Salah' });
      expect(splitName('Amira')).toEqual({ firstName: 'Amira', lastName: 'Amira' });
      expect(splitName(null).firstName).toBeTruthy();
      const i = manualInstructions({ amountMillimes: 13_300, reference: 'REF-1', d17Number: '22 333 444', rib: '0800 1234', planName_ar: 'ش', planName_fr: 'P' });
      expect(i.instructions_fr).toContain('13.300 DT');
      expect(i.instructions_fr).toContain('REF-1');
      expect(i.instructions_fr).toContain('22 333 444');
      expect(i.instructions_ar).toContain('0800 1234');
      expect(i.instructions_ar).toContain('REF-1');
    });

    it('detects verification mismatches (order id, amount in millimes or dinars)', () => {
      const p = { id: '0b7e9a52-3f3c-4a59-9b1e-8f3f8b0c1d2e', amountMillimes: 19_000 };
      expect(verificationMismatch(p, { status: 'PAID', amountMillimes: 19_000, orderId: p.id })).toBeNull();
      expect(verificationMismatch(p, { status: 'PAID', amountMillimes: 19 })).toBeNull();
      expect(verificationMismatch(p, { status: 'PAID', amountMillimes: 1_000 })).toMatch(/amount/);
      expect(verificationMismatch(p, { status: 'PAID', orderId: '11111111-1111-4111-8111-111111111111' })).toMatch(/order/);
    });
  });

  // ───────────── Entitlements ─────────────

  describe('EntitlementsService', () => {
    it('gives free limits to a user without subscription', async () => {
      const u = await makeUser();
      await expect(ent.get(u.id)).resolves.toEqual({
        premium: false,
        planCode: null,
        endsAt: null,
        limits: {
          questionsPerDay: FREE_LIMITS.questions_per_day,
          tutorPerDay: FREE_LIMITS.tutor_per_day,
          mocksTotal: FREE_LIMITS.mocks_total,
          offline: false,
        },
      });
    });

    it('consumes the free daily question quota and refuses beyond it (Africa/Tunis day)', async () => {
      const u = await makeUser();
      const limit = FREE_LIMITS.questions_per_day;
      for (let i = 1; i <= limit; i++) {
        await expect(ent.consume(u.id, 'questions')).resolves.toEqual({ allowed: true, remaining: limit - i });
      }
      await expect(ent.consume(u.id, 'questions')).resolves.toEqual({ allowed: false, remaining: 0 });
      const [row] = await db.select().from(usageCounters).where(eq(usageCounters.userId, u.id));
      expect(row).toMatchObject({ date: tunisToday(), questions: limit, tutor: 0 });
    });

    it('never lets concurrent requests overspend the tutor quota, supports n > 1 and peeking', async () => {
      const u = await makeUser();
      const results = await Promise.all(Array.from({ length: 8 }, () => ent.consume(u.id, 'tutor')));
      expect(results.filter((r) => r.allowed)).toHaveLength(FREE_LIMITS.tutor_per_day);
      expect(results.filter((r) => !r.allowed).every((r) => r.remaining === 0)).toBe(true);

      const v = await makeUser();
      await expect(ent.consume(v.id, 'questions', 5)).resolves.toEqual({ allowed: true, remaining: 15 });
      await expect(ent.consume(v.id, 'questions', 16)).resolves.toEqual({ allowed: false, remaining: 15 });
      await expect(ent.consume(v.id, 'questions', 0)).resolves.toEqual({ allowed: true, remaining: 15 });
      await expect(ent.consume(v.id, 'questions', 100)).resolves.toEqual({ allowed: false, remaining: 15 });
    });

    it('is unlimited for premium users (still counted) and returns remaining null', async () => {
      const u = await makeUser();
      await ent.grantDays(u.id, 3, 'ADMIN_GRANT');
      const e = await ent.get(u.id);
      expect(e).toMatchObject({ premium: true, planCode: 'PREMIUM_MONTH', limits: { questionsPerDay: null, tutorPerDay: 50, mocksTotal: null, offline: true } });
      for (let i = 0; i < FREE_LIMITS.questions_per_day + 5; i++) {
        await expect(ent.consume(u.id, 'questions')).resolves.toEqual({ allowed: true, remaining: null });
      }
      const [row] = await db.select().from(usageCounters).where(eq(usageCounters.userId, u.id));
      expect(row.questions).toBe(FREE_LIMITS.questions_per_day + 5);
      await expect(ent.consume(u.id, 'tutor')).resolves.toEqual({ allowed: true, remaining: 49 });
    });

    it('lets free users submit one mock in total; premium users unlimited', async () => {
      const u = await makeUser();
      await expect(ent.canStartMock(u.id)).resolves.toBe(true);
      // An unsubmitted mock does not count.
      await db.insert(attempts).values({ userId: u.id, kind: 'MOCK', questionIds: [] });
      await expect(ent.canStartMock(u.id)).resolves.toBe(true);
      await db.insert(attempts).values({ userId: u.id, kind: 'MOCK', questionIds: [], submittedAt: new Date() });
      await expect(ent.canStartMock(u.id)).resolves.toBe(false);
      await ent.grantDays(u.id, 1, 'ADMIN_GRANT');
      await expect(ent.canStartMock(u.id)).resolves.toBe(true);
    });

    it('grantDays creates then extends from the current end, keeping one ACTIVE row', async () => {
      const u = await makeUser();
      const t0 = Date.now();
      await ent.grantDays(u.id, 7, 'REFERRAL');
      let e = await ent.get(u.id);
      expectNear(e.endsAt, t0 + 7 * DAY);
      await ent.grantDays(u.id, 7, 'REFERRAL');
      e = await ent.get(u.id);
      expectNear(e.endsAt, t0 + 14 * DAY);
      const active = await activeSubs(u.id);
      expect(active).toHaveLength(1);
      expect(active[0].source).toBe('REFERRAL');
      const all = await db.select().from(subscriptions).where(eq(subscriptions.userId, u.id));
      expect(all).toHaveLength(2);
      expect(all.filter((s) => s.status === 'EXPIRED')).toHaveLength(1);

      await expect(ent.grantDays(u.id, 0, 'ADMIN_GRANT')).rejects.toThrow('INVALID_DAYS');
      await expect(ent.grantDays(u.id, 5, 'ADMIN_GRANT', 'NOPE')).rejects.toThrow('PLAN_NOT_FOUND');
    });

    it('grantDays restarts from now after a subscription has lapsed', async () => {
      const u = await makeUser();
      await db.insert(subscriptions).values({
        userId: u.id, planId: monthPlan.id, status: 'ACTIVE', startsAt: new Date(Date.now() - 40 * DAY), endsAt: new Date(Date.now() - 10 * DAY),
      });
      await expect(ent.get(u.id)).resolves.toMatchObject({ premium: false });
      const t0 = Date.now();
      await ent.grantDays(u.id, 7, 'ADMIN_GRANT');
      expectNear((await ent.get(u.id)).endsAt, t0 + 7 * DAY);
    });
  });

  // ───────────── PaymentsService ─────────────

  describe('PaymentsService', () => {
    it('markPaid is idempotent: twice (and concurrently) never extends twice; promo counted once', async () => {
      const u = await makeUser();
      const code = await makePromo(`IDEM${run}`.toUpperCase(), { percentOff: 10 });
      const p = await pendingPayment(u.id, { promoCode: code, amountMillimes: discountedAmount(monthPlan.priceMillimes, 10) });
      const t0 = Date.now();
      await Promise.all([pay.markPaid(p.id), pay.markPaid(p.id), pay.markPaid(p.id)]);
      await pay.markPaid(p.id);

      const [paid] = await db.select().from(payments).where(eq(payments.id, p.id));
      expect(paid.status).toBe('PAID');
      expect(paid.paidAt).toBeTruthy();
      const subs = await db.select().from(subscriptions).where(eq(subscriptions.userId, u.id));
      expect(subs).toHaveLength(1);
      expect(subs[0]).toMatchObject({ status: 'ACTIVE', paymentId: p.id, source: 'PAYMENT' });
      expectNear(subs[0].endsAt, t0 + monthPlan.durationDays * DAY);
      const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code));
      expect(promo.usedCount).toBe(1);

      expect(notifyMock.notify).toHaveBeenCalledTimes(1);
      expect(notifyMock.notify).toHaveBeenCalledWith(u.id, expect.objectContaining({ type: 'SUBSCRIPTION', dedupeKey: `payment:${p.id}`, url: '/app/billing' }));
      const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, p.id), eq(auditLogs.action, 'payment.paid')));
      expect(audit).toHaveLength(1);
    });

    it('a second payment extends from the current end (premium user buying again)', async () => {
      const u = await makeUser();
      const t0 = Date.now();
      await pay.markPaid((await pendingPayment(u.id)).id);
      await pay.markPaid((await pendingPayment(u.id)).id);
      const e = await ent.get(u.id);
      expectNear(e.endsAt, t0 + 2 * monthPlan.durationDays * DAY);
      expect(await activeSubs(u.id)).toHaveLength(1);
    });

    it('concurrent grant and payment both count (per-user lock)', async () => {
      const u = await makeUser();
      const p = await pendingPayment(u.id);
      const t0 = Date.now();
      await Promise.all([ent.grantDays(u.id, 7, 'REFERRAL'), pay.markPaid(p.id), ent.grantDays(u.id, 3, 'ADMIN_GRANT')]);
      expectNear((await ent.get(u.id)).endsAt, t0 + (monthPlan.durationDays + 10) * DAY);
      expect(await activeSubs(u.id)).toHaveLength(1);
    });

    it('keeps the more generous plan when extending (exam pass + month)', async () => {
      const u = await makeUser();
      const [pass] = await db.select().from(plans).where(eq(plans.code, 'EXAM_PASS'));
      await pay.markPaid((await pendingPayment(u.id, { planId: pass.id, amountMillimes: pass.priceMillimes })).id);
      await pay.markPaid((await pendingPayment(u.id)).id);
      const e = await ent.get(u.id);
      expect(e.planCode).toBe('EXAM_PASS');
      expect(e.limits.tutorPerDay).toBe(80);
    });

    it('markFailed sets FAILED only from PENDING; a provider-confirmed FAILED payment can still be paid', async () => {
      const u = await makeUser();
      const p = await pendingPayment(u.id, { manualReference: 'D17-123456' });
      await pay.markFailed(p.id, 'WRONG_AMOUNT');
      let [row] = await db.select().from(payments).where(eq(payments.id, p.id));
      expect(row.status).toBe('FAILED');
      expect(row.raw).toMatchObject({ failureReason: 'WRONG_AMOUNT' });
      expect(notifyMock.notify).toHaveBeenCalledWith(u.id, expect.objectContaining({ type: 'SUBSCRIPTION', dedupeKey: `payment-failed:${p.id}` }));

      await pay.markPaid(p.id, { actorId: u.id });
      [row] = await db.select().from(payments).where(eq(payments.id, p.id));
      expect(row.status).toBe('PAID');
      await pay.markFailed(p.id, 'LATE');
      [row] = await db.select().from(payments).where(eq(payments.id, p.id));
      expect(row.status).toBe('PAID');
      expect(await activeSubs(u.id)).toHaveLength(1);

      await expect(pay.markPaid('00000000-0000-4000-8000-000000000000')).rejects.toThrow('NOT_FOUND');
      await expect(pay.markFailed('not-a-uuid')).rejects.toThrow('NOT_FOUND');
    });
  });

  // ───────────── HTTP: plans, promo, checkout ─────────────

  describe('HTTP', () => {
    it('GET /billing/plans lists active plans, FREE first', async () => {
      const r = await request(app.getHttpServer()).get('/billing/plans').expect(200);
      expect(r.body[0]).toMatchObject({ code: 'FREE', priceMillimes: 0 });
      const month = r.body.find((p: { code: string }) => p.code === 'PREMIUM_MONTH');
      expect(month).toMatchObject({ name_ar: expect.any(String), name_fr: expect.any(String), priceMillimes: 19_000, durationDays: 30, period: 'MONTH' });
      expect(month.features).toMatchObject({ questions_per_day: null });
      const prov = await request(app.getHttpServer()).get('/billing/providers').expect(200);
      expect(prov.body).toEqual(expect.arrayContaining([{ code: 'MOCK', available: true }, { code: 'MANUAL', available: true }]));
    });

    it('requires a registered account', async () => {
      const g = await makeUser({ isGuest: true });
      await request(app.getHttpServer()).post('/billing/checkout').send({ planCode: 'PREMIUM_MONTH', provider: 'MOCK' }).expect(401);
      const r = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', g.cookie)
        .send({ planCode: 'PREMIUM_MONTH', provider: 'MOCK' })
        .expect(401);
      expect(r.body.message).toBe('REGISTRATION_REQUIRED');
      await request(app.getHttpServer()).get('/billing/me').set('Cookie', g.cookie).expect(401);
    });

    it('MOCK checkout activates premium immediately and shows up in /billing/me', async () => {
      const u = await makeUser();
      const t0 = Date.now();
      const r = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', u.cookie)
        .send({ planCode: 'PREMIUM_MONTH', provider: 'MOCK' })
        .expect(201);
      expect(r.body).toMatchObject({ provider: 'MOCK', status: 'PAID', amountMillimes: 19_000 });
      expect(r.body.redirectUrl).toBe(`${env().APP_URL}/app/billing/return?status=paid&paymentId=${r.body.paymentId}`);
      // Pre-contract information (Loi 2000-83): plan, duration and TTC price.
      expect(r.body.summary).toMatchObject({
        plan: { code: 'PREMIUM_MONTH', durationDays: 30, name_fr: expect.any(String), name_ar: expect.any(String) },
        priceMillimes: 19_000, amountMillimes: 19_000, currency: 'TND', taxIncluded: true, currentPremiumEndsAt: null,
      });

      const e = await ent.get(u.id);
      expect(e).toMatchObject({ premium: true, planCode: 'PREMIUM_MONTH' });
      expectNear(e.endsAt, t0 + 30 * DAY);

      const me = await request(app.getHttpServer()).get('/billing/me').set('Cookie', u.cookie).expect(200);
      expect(me.body.subscription).toMatchObject({ planCode: 'PREMIUM_MONTH', status: 'ACTIVE', daysLeft: 30 });
      expect(me.body.payments).toHaveLength(1);
      expect(me.body.payments[0]).toMatchObject({ id: r.body.paymentId, status: 'PAID', provider: 'MOCK', planCode: 'PREMIUM_MONTH', amountMillimes: 19_000 });
      expect(me.body.entitlements.premium).toBe(true);
      expect(me.body.usageToday).toEqual({ date: tunisToday(), questions: 0, tutor: 0 });

      // The return URL of an already-paid payment is stable.
      const ret = await request(app.getHttpServer()).get(`/billing/return?paymentId=${r.body.paymentId}`).expect(302);
      expect(ret.headers.location).toBe(`${env().APP_URL}/app/billing/return?status=paid&paymentId=${r.body.paymentId}`);
    });

    it('rejects unknown plans, FREE and unconfigured providers', async () => {
      const u = await makeUser();
      const post = (body: object) => request(app.getHttpServer()).post('/billing/checkout').set('Cookie', u.cookie).send(body);
      expect((await post({ planCode: 'NOPE', provider: 'MOCK' }).expect(404)).body.message).toBe('PLAN_NOT_FOUND');
      expect((await post({ planCode: 'FREE', provider: 'MOCK' }).expect(404)).body.message).toBe('PLAN_NOT_FOUND');
      expect((await post({ planCode: 'PREMIUM_MONTH', provider: 'PAYPAL' }).expect(400)).body.message).toBe('VALIDATION_FAILED');
      const e = env();
      const saved = { k: e.KONNECT_API_KEY, w: e.KONNECT_WALLET_ID, t: e.FLOUCI_APP_TOKEN, s: e.FLOUCI_APP_SECRET };
      e.KONNECT_API_KEY = undefined;
      e.FLOUCI_APP_TOKEN = undefined;
      try {
        expect((await post({ planCode: 'PREMIUM_MONTH', provider: 'KONNECT' }).expect(400)).body.message).toBe('PROVIDER_UNAVAILABLE');
        expect((await post({ planCode: 'PREMIUM_MONTH', provider: 'FLOUCI' }).expect(400)).body.message).toBe('PROVIDER_UNAVAILABLE');
      } finally {
        Object.assign(e, { KONNECT_API_KEY: saved.k, KONNECT_WALLET_ID: saved.w, FLOUCI_APP_TOKEN: saved.t, FLOUCI_APP_SECRET: saved.s });
      }
      const pending = await db.select().from(payments).where(eq(payments.userId, u.id));
      expect(pending).toHaveLength(0);
    });

    it('validates promo codes (case-insensitive, expiry, exhaustion, once per user) and applies the discount at checkout', async () => {
      const u = await makeUser();
      const code = await makePromo(`PROMO${run}`.toUpperCase(), { percentOff: 25, maxUses: 3 });
      const expired = await makePromo(`OLD${run}`.toUpperCase(), { expiresAt: new Date(Date.now() - DAY) });
      const exhausted = await makePromo(`FULL${run}`.toUpperCase(), { maxUses: 1, usedCount: 1 });
      const validate = (c: string, planCode = 'PREMIUM_MONTH') =>
        request(app.getHttpServer()).post('/billing/promo/validate').set('Cookie', u.cookie).send({ code: c, planCode }).expect(200);

      expect((await validate(code.toLowerCase())).body).toEqual({ valid: true, percentOff: 25, amountMillimes: 14_250, priceMillimes: 19_000, reason: null });
      expect((await validate(code, 'PREMIUM_QUARTER')).body).toMatchObject({ valid: true, amountMillimes: 33_750 });
      expect((await validate(expired)).body).toMatchObject({ valid: false, percentOff: 0, amountMillimes: 19_000, reason: 'EXPIRED' });
      expect((await validate(exhausted)).body).toMatchObject({ valid: false, reason: 'EXHAUSTED' });
      expect((await validate('DOESNOTEXIST')).body).toMatchObject({ valid: false, reason: 'NOT_FOUND' });

      const bad = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', u.cookie)
        .send({ planCode: 'PREMIUM_MONTH', provider: 'MOCK', promoCode: expired })
        .expect(400);
      expect(bad.body).toMatchObject({ message: 'PROMO_INVALID', reason: 'EXPIRED' });

      const r = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', u.cookie)
        .send({ planCode: 'PREMIUM_MONTH', provider: 'MOCK', promoCode: ` ${code.toLowerCase()} ` })
        .expect(201);
      expect(r.body).toMatchObject({ amountMillimes: 14_250, status: 'PAID' });
      expect(r.body.summary).toMatchObject({ priceMillimes: 19_000, discountMillimes: 4_750, percentOff: 25, promoCode: code });
      const [row] = await db.select().from(payments).where(eq(payments.id, r.body.paymentId));
      expect(row).toMatchObject({ amountMillimes: 14_250, promoCode: code, status: 'PAID' });
      const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code));
      expect(promo.usedCount).toBe(1);

      expect((await validate(code)).body).toMatchObject({ valid: false, reason: 'ALREADY_USED' });
    });

    it('a 100 % promo activates without any payment provider', async () => {
      const u = await makeUser();
      const code = await makePromo(`GIFT${run}`.toUpperCase(), { percentOff: 100 });
      const r = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', u.cookie)
        .send({ planCode: 'PREMIUM_QUARTER', provider: 'MANUAL', promoCode: code })
        .expect(201);
      expect(r.body).toMatchObject({ status: 'PAID', amountMillimes: 0 });
      await expect(ent.get(u.id)).resolves.toMatchObject({ premium: true, planCode: 'PREMIUM_QUARTER' });
    });

    it('MANUAL: instructions with D17/RIB and reference, reuse, proof notifies admins, admin approval activates', async () => {
      const u = await makeUser();
      const admin = await makeUser({ role: 'ADMIN' });
      const post = () =>
        request(app.getHttpServer()).post('/billing/checkout').set('Cookie', u.cookie).send({ planCode: 'PREMIUM_MONTH', provider: 'MANUAL' }).expect(201);
      const r = await post();
      expect(r.body).toMatchObject({ provider: 'MANUAL', status: 'PENDING', redirectUrl: null, amountMillimes: 19_000, reference: r.body.paymentId });
      expect(r.body.instructions_fr).toContain(env().MANUAL_PAYMENT_D17_NUMBER);
      expect(r.body.instructions_fr).toContain(env().MANUAL_PAYMENT_RIB);
      expect(r.body.instructions_fr).toContain(r.body.paymentId);
      expect(r.body.instructions_ar).toContain(r.body.paymentId);
      expect(r.body.instructions_fr).toContain('19 DT');

      // Clicking again does not create a second pending transfer.
      expect((await post()).body.paymentId).toBe(r.body.paymentId);
      await expect(ent.get(u.id)).resolves.toMatchObject({ premium: false });

      const other = await makeUser();
      await request(app.getHttpServer())
        .post('/billing/manual-proof')
        .set('Cookie', other.cookie)
        .send({ paymentId: r.body.paymentId, reference: 'D17-999' })
        .expect(404);

      await request(app.getHttpServer())
        .post('/billing/manual-proof')
        .set('Cookie', u.cookie)
        .send({ paymentId: r.body.paymentId, reference: ' D17   778899 ' })
        .expect(200, { ok: true });
      const [row] = await db.select().from(payments).where(eq(payments.id, r.body.paymentId));
      expect(row.manualReference).toBe('D17 778899');
      expect(notifyMock.notifyMany).toHaveBeenCalledTimes(1);
      const [adminIds, input] = notifyMock.notifyMany.mock.calls[0];
      expect(adminIds).toContain(admin.id);
      expect(adminIds).not.toContain(u.id);
      expect(input).toMatchObject({ type: 'SYSTEM', url: '/admin/payments?status=PENDING', data: expect.objectContaining({ paymentId: r.body.paymentId }) });

      // Same reference again: no duplicate admin notification.
      await request(app.getHttpServer())
        .post('/billing/manual-proof')
        .set('Cookie', u.cookie)
        .send({ paymentId: r.body.paymentId, reference: 'D17 778899' })
        .expect(200);
      expect(notifyMock.notifyMany).toHaveBeenCalledTimes(1);

      const me = await request(app.getHttpServer()).get('/billing/me').set('Cookie', u.cookie).expect(200);
      expect(me.body.payments[0]).toMatchObject({ status: 'PENDING', manualReference: 'D17 778899', instructions_fr: expect.stringContaining(r.body.paymentId) });

      const ret = await request(app.getHttpServer()).get(`/billing/return?paymentId=${r.body.paymentId}`).expect(302);
      expect(ret.headers.location).toContain('status=pending');

      await pay.markPaid(r.body.paymentId, { actorId: admin.id });
      await expect(ent.get(u.id)).resolves.toMatchObject({ premium: true, planCode: 'PREMIUM_MONTH' });
      const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, r.body.paymentId), eq(auditLogs.action, 'payment.paid')));
      expect(audit[0].actorId).toBe(admin.id);

      await request(app.getHttpServer())
        .post('/billing/manual-proof')
        .set('Cookie', u.cookie)
        .send({ paymentId: r.body.paymentId, reference: 'D17 1' })
        .expect(400);
    });

    it('caps unconfirmed checkouts per user and hour', async () => {
      const u = await makeUser();
      for (let i = 0; i < 6; i++) await pendingPayment(u.id, { provider: 'KONNECT' });
      const r = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', u.cookie)
        .send({ planCode: 'PREMIUM_MONTH', provider: 'MOCK' })
        .expect(429);
      expect(r.body.message).toBe('RATE_LIMITED');
    });
  });

  // ───────────── Providers (HTTP calls mocked) ─────────────

  describe('KONNECT / FLOUCI', () => {
    const saved: Record<string, string | undefined> = {};
    let fetchSpy: jest.SpyInstance;

    beforeAll(() => {
      const e = env();
      for (const k of ['KONNECT_API_KEY', 'KONNECT_WALLET_ID', 'FLOUCI_APP_TOKEN', 'FLOUCI_APP_SECRET'] as const) saved[k] = e[k];
      Object.assign(e, { KONNECT_API_KEY: 'k-test', KONNECT_WALLET_ID: 'wallet-test', FLOUCI_APP_TOKEN: 'f-token', FLOUCI_APP_SECRET: 'f-secret' });
    });
    afterAll(() => Object.assign(env(), saved));
    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch');
    });
    afterEach(() => fetchSpy.mockRestore());

    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

    it('Konnect: init-payment request, webhook re-verified with Konnect, idempotent, return redirect', async () => {
      const u = await makeUser();
      const ref = `kref_${run}_1`;
      fetchSpy.mockImplementationOnce(() => json({ payUrl: 'https://pay.konnect.test/x', paymentRef: ref }));
      const r = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', u.cookie)
        .send({ planCode: 'PREMIUM_MONTH', provider: 'KONNECT' })
        .expect(201);
      expect(r.body).toMatchObject({ provider: 'KONNECT', status: 'PENDING', redirectUrl: 'https://pay.konnect.test/x', amountMillimes: 19_000 });

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${env().KONNECT_API_URL}/payments/init-payment`);
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('k-test');
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({
        receiverWalletId: 'wallet-test', token: 'TND', amount: 19_000, type: 'immediate', lifespan: 30, checkoutForm: false,
        addPaymentFeesToAmount: false, firstName: 'Amira', lastName: 'Ben Salah', email: expect.stringContaining('@test.concours.tn'),
        orderId: r.body.paymentId, webhook: `${env().API_PUBLIC_URL}/billing/webhooks/konnect`, theme: 'light',
        acceptedPaymentMethods: ['wallet', 'bank_card', 'e-DINAR', 'flouci'],
      });
      const [stored] = await db.select().from(payments).where(eq(payments.id, r.body.paymentId));
      expect(stored).toMatchObject({ status: 'PENDING', providerRef: ref });

      // Still pending at Konnect: nothing happens.
      fetchSpy.mockImplementationOnce(() => json({ payment: { status: 'pending', amount: 19_000, orderId: r.body.paymentId } }));
      expect((await request(app.getHttpServer()).get(`/billing/webhooks/konnect?payment_ref=${ref}`).expect(200)).body).toEqual({ ok: true, status: 'PENDING' });
      await expect(ent.get(u.id)).resolves.toMatchObject({ premium: false });

      fetchSpy.mockImplementationOnce(() => json({ payment: { status: 'completed', amount: 19_000, orderId: r.body.paymentId } }));
      const t0 = Date.now();
      expect((await request(app.getHttpServer()).post(`/billing/webhooks/konnect?payment_ref=${ref}`).expect(200)).body).toEqual({ ok: true, status: 'PAID' });
      expect(fetchSpy.mock.calls[2][0]).toBe(`${env().KONNECT_API_URL}/payments/${ref}`);
      expectNear((await ent.get(u.id)).endsAt, t0 + 30 * DAY);

      // Replayed webhook and browser return: no provider call, no second extension.
      const calls = fetchSpy.mock.calls.length;
      await request(app.getHttpServer()).get(`/billing/webhooks/konnect?payment_ref=${ref}`).expect(200);
      const ret = await request(app.getHttpServer()).get(`/billing/return?paymentId=${r.body.paymentId}?payment_ref=${ref}`).expect(302);
      expect(ret.headers.location).toBe(`${env().APP_URL}/app/billing/return?status=paid&paymentId=${r.body.paymentId}`);
      expect(fetchSpy.mock.calls.length).toBe(calls);
      expectNear((await ent.get(u.id)).endsAt, t0 + 30 * DAY);
      expect(await db.select().from(subscriptions).where(eq(subscriptions.userId, u.id))).toHaveLength(1);

      await request(app.getHttpServer()).get('/billing/webhooks/konnect?payment_ref=unknown_ref_123').expect(404);
      await request(app.getHttpServer()).get('/billing/webhooks/konnect?payment_ref=bad%20ref%3B').expect(400);
    });

    it('Konnect: a "completed" answer with the wrong amount is not activated', async () => {
      const u = await makeUser();
      const ref = `kref_${run}_2`;
      const p = await pendingPayment(u.id, { provider: 'KONNECT', providerRef: ref });
      fetchSpy.mockImplementationOnce(() => json({ payment: { status: 'completed', amount: 1_000, orderId: p.id } }));
      expect((await request(app.getHttpServer()).get(`/billing/webhooks/konnect?payment_ref=${ref}`).expect(200)).body.status).toBe('PENDING');
      await expect(ent.get(u.id)).resolves.toMatchObject({ premium: false });
      const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, p.id), eq(auditLogs.action, 'payment.verification_mismatch')));
      expect(audit).toHaveLength(1);
    });

    it('provider errors fail the payment and answer 502 PROVIDER_ERROR', async () => {
      const u = await makeUser();
      fetchSpy.mockImplementationOnce(() => json({ errors: [{ message: 'bad wallet' }] }, 400));
      const r = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', u.cookie)
        .send({ planCode: 'PREMIUM_MONTH', provider: 'KONNECT' })
        .expect(502);
      expect(r.body.message).toBe('PROVIDER_ERROR');
      const [row] = await db.select().from(payments).where(eq(payments.userId, u.id));
      expect(row.status).toBe('FAILED');
    });

    it('Flouci: generate_payment request, return URL verification, failed payments', async () => {
      const u = await makeUser();
      const flouciId = `fl_${run}_1`;
      fetchSpy.mockImplementationOnce(() => json({ result: { success: true, payment_id: flouciId, link: 'https://flouci.test/pay/1' } }));
      const r = await request(app.getHttpServer())
        .post('/billing/checkout')
        .set('Cookie', u.cookie)
        .send({ planCode: 'PREMIUM_QUARTER', provider: 'FLOUCI' })
        .expect(201);
      expect(r.body).toMatchObject({ provider: 'FLOUCI', status: 'PENDING', redirectUrl: 'https://flouci.test/pay/1', amountMillimes: 45_000 });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${env().FLOUCI_API_URL}/generate_payment`);
      expect(JSON.parse(init.body as string)).toMatchObject({
        app_token: 'f-token', app_secret: 'f-secret', amount: '45000', accept_card: 'true', session_timeout_secs: 1200,
        success_link: `${env().API_PUBLIC_URL}/billing/return?paymentId=${r.body.paymentId}`,
        fail_link: `${env().API_PUBLIC_URL}/billing/return?paymentId=${r.body.paymentId}`,
        developer_tracking_id: r.body.paymentId,
      });

      fetchSpy.mockImplementationOnce(() => json({ success: true, result: { status: 'SUCCESS', amount: 45_000 } }));
      const ret = await request(app.getHttpServer()).get(`/billing/return?paymentId=${r.body.paymentId}?payment_id=${flouciId}`).expect(302);
      expect(ret.headers.location).toBe(`${env().APP_URL}/app/billing/return?status=paid&paymentId=${r.body.paymentId}`);
      const [vUrl, vInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(vUrl).toBe(`${env().FLOUCI_API_URL}/verify_payment/${flouciId}`);
      expect(vInit.headers).toMatchObject({ apppublic: 'f-token', appsecret: 'f-secret' });
      await expect(ent.get(u.id)).resolves.toMatchObject({ premium: true, planCode: 'PREMIUM_QUARTER' });

      // A failed Flouci payment, reported by webhook.
      const v = await makeUser();
      const p = await pendingPayment(v.id, { provider: 'FLOUCI', providerRef: `fl_${run}_2` });
      fetchSpy.mockImplementationOnce(() => json({ success: true, result: { status: 'FAILURE' } }));
      expect((await request(app.getHttpServer()).post('/billing/webhooks/flouci').send({ payment_id: `fl_${run}_2` }).expect(200)).body)
        .toEqual({ ok: true, status: 'FAILED' });
      const [row] = await db.select().from(payments).where(eq(payments.id, p.id));
      expect(row.status).toBe('FAILED');
      const failedRet = await request(app.getHttpServer()).get(`/billing/return?paymentId=${p.id}`).expect(302);
      expect(failedRet.headers.location).toContain('status=failed');
      const junk = await request(app.getHttpServer()).get('/billing/return?paymentId=garbage').expect(302);
      expect(junk.headers.location).toBe(`${env().APP_URL}/app/billing/return?status=failed`);
    });

    it('reconciliation verifies recent checkouts and closes stale ones', async () => {
      const u = await makeUser();
      const old = new Date(Date.now() - 30 * 60_000);
      const recent = await pendingPayment(u.id, { provider: 'KONNECT', providerRef: `kref_${run}_rec`, createdAt: old });
      const noRef = await pendingPayment(u.id, { provider: 'KONNECT', createdAt: new Date(Date.now() - 2 * 3_600_000) });
      const stale = await pendingPayment(u.id, { provider: 'FLOUCI', providerRef: `fl_${run}_old`, createdAt: new Date(Date.now() - 80 * 3_600_000) });
      const manualOld = await pendingPayment(u.id, { provider: 'MANUAL', createdAt: new Date(Date.now() - 15 * DAY) });
      const manualWithProof = await pendingPayment(u.id, { provider: 'MANUAL', manualReference: 'D17 1', createdAt: new Date(Date.now() - 15 * DAY) });

      fetchSpy.mockImplementation((input: string | URL | Request) =>
        String(input).includes(`kref_${run}_rec`) ? json({ payment: { status: 'completed', amount: 19_000, orderId: recent.id } }) : json({ payment: { status: 'pending' } }),
      );
      await billing.reconcilePending();
      const rows = await db.select().from(payments).where(eq(payments.userId, u.id));
      const status = (id: string) => rows.find((r) => r.id === id)?.status;
      expect(status(recent.id)).toBe('PAID');
      expect(status(noRef.id)).toBe('FAILED');
      expect(status(stale.id)).toBe('FAILED');
      expect(status(manualOld.id)).toBe('FAILED');
      expect(status(manualWithProof.id)).toBe('PENDING');
      await expect(ent.get(u.id)).resolves.toMatchObject({ premium: true });
      // Abandoned manual checkouts (no proof) are closed silently.
      expect(notifyMock.notify).not.toHaveBeenCalledWith(u.id, expect.objectContaining({ dedupeKey: `payment-failed:${manualOld.id}` }));
    });
  });
});

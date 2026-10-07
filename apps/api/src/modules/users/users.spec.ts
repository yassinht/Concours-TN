import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { CommonModule } from '../../common/common.module';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import {
  auditLogs, competitionFacts, competitionFamilies, organizations, positions, pushSubscriptions, sources, userDocumentChecks, userProfiles, users,
} from '../../db/schema';
import { AuthModule } from '../auth/auth.module';
import { rateLimiter } from '../auth/rate-limit';
import { EntitlementsService } from '../billing/entitlements.service';
import { AlertsService } from '../notifications/alerts.service';
import { MailService } from '../notifications/mail.service';
import { unsubscribeToken, verifyUnsubscribeToken } from './email-preferences';
import { UsersModule } from './users.module';

const alertsMock = { matchUser: jest.fn(async () => ({ matched: 1 })), matchCompetition: jest.fn() };

@Global()
@Module({
  providers: [
    { provide: AlertsService, useValue: alertsMock },
    { provide: MailService, useValue: { send: jest.fn(async () => undefined) } },
    // Not implemented yet on purpose: MeDTO must fall back to the free tier.
    { provide: EntitlementsService, useValue: { get: jest.fn(async () => { throw new Error('NOT_IMPLEMENTED'); }) } },
  ],
  exports: [AlertsService, MailService, EntitlementsService],
})
class GlobalMocksModule {}

const run = randomBytes(4).toString('hex');
const EMAIL = `users-${run}@test.concours.tn`;

describe('users module (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let agent: ReturnType<typeof request.agent>;
  let userId: string;
  const fx: { org?: string; fam?: string; source?: string; generalFact?: string; positionFact?: string; otherFact?: string } = {};
  const famSlug = `users-fam-${run}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DbModule, CommonModule, GlobalMocksModule, AuthModule, UsersModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get<Database>(DB);
    agent = request.agent(app.getHttpServer());

    const [org] = await db.insert(organizations).values({ slug: `users-org-${run}`, nameAr: 'م', nameFr: 'Org' }).returning();
    const [fam] = await db.insert(competitionFamilies).values({ slug: famSlug, organizationId: org.id, field: 'SECURITY', nameAr: 'أمن', nameFr: 'Sécurité' }).returning();
    const [pos] = await db.insert(positions).values({ familyId: fam.id, slug: 'inspecteur', titleAr: 'متفقد', titleFr: 'Inspecteur', orderIndex: 1 }).returning();
    const [src] = await db.insert(sources).values({ title: `Avis ${run}`, url: 'https://www.concours.gov.tn/x', sourceType: 'OFFICIAL', confidence: 'HIGH' }).returning();
    const facts = await db
      .insert(competitionFacts)
      .values([
        { familyId: fam.id, key: 'REQUIRED_DOCUMENT', displayAr: 'نسخة من بطاقة التعريف', displayFr: 'Copie CIN', sourceId: src.id, confidence: 'HIGH', needsVerification: false, orderIndex: 1 },
        { familyId: fam.id, positionId: pos.id, key: 'REQUIRED_DOCUMENT', displayAr: 'شهادة طبية', displayFr: 'Certificat médical', orderIndex: 2 },
        { familyId: fam.id, key: 'PHYSICAL_TEST', displayAr: 'جري', displayFr: 'Course' },
      ])
      .returning();
    Object.assign(fx, { org: org.id, fam: fam.id, source: src.id, generalFact: facts[0].id, positionFact: facts[1].id, otherFact: facts[2].id });

    const r = await agent.post('/auth/register').send({ email: EMAIL, password: 'password-123', name: 'Sami' }).expect(200);
    userId = r.body.user.id;
    expect(r.body.user.premium).toEqual({ active: false, planCode: null, endsAt: null });
  });

  beforeEach(() => {
    rateLimiter.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(users).where(like(users.email, `%-${run}@test.concours.tn`));
      if (userId) await db.delete(users).where(eq(users.id, userId));
      if (fx.fam) await db.delete(competitionFamilies).where(eq(competitionFamilies.id, fx.fam));
      if (fx.source) await db.delete(sources).where(eq(sources.id, fx.source));
      if (fx.org) await db.delete(organizations).where(eq(organizations.id, fx.org));
    }
    await app?.close();
  });

  it('requires a session on /me routes', async () => {
    const r = await request(app.getHttpServer()).get('/me/profile').expect(401);
    expect(r.body.message).toBe('SESSION_REQUIRED');
  });

  it('follows and unfollows a family (following re-runs alert matching)', async () => {
    await agent.post(`/me/follows/${famSlug}`).expect(200, { ok: true });
    expect(alertsMock.matchUser).toHaveBeenCalledWith(userId);
    await agent.post(`/me/follows/${famSlug}`).expect(200, { ok: true });
    const list = await agent.get('/me/follows').expect(200);
    expect(list.body).toEqual([expect.objectContaining({ familySlug: famSlug, familyName_fr: 'Sécurité', field: 'SECURITY' })]);
    await agent.delete(`/me/follows/${famSlug}`).expect(200, { ok: true });
    expect((await agent.get('/me/follows').expect(200)).body).toEqual([]);
    await agent.post(`/me/follows/nope-${run}`).expect(404);
  });

  it('builds the required-documents checklist grouped by position, with provenance and checks', async () => {
    const r1 = await agent.get(`/me/checklist/${famSlug}`).expect(200);
    expect(r1.body).toHaveLength(2);
    const [general, inspecteur] = r1.body;
    expect(general.positionSlug).toBeNull();
    expect(general.items).toEqual([
      expect.objectContaining({
        id: fx.generalFact, key: 'REQUIRED_DOCUMENT', display_fr: 'Copie CIN', checked: false, needsVerification: false, confidence: 'HIGH',
        source: expect.objectContaining({ id: fx.source, sourceType: 'OFFICIAL', url: 'https://www.concours.gov.tn/x' }),
      }),
    ]);
    expect(inspecteur).toMatchObject({ positionSlug: 'inspecteur', positionTitle_fr: 'Inspecteur' });
    expect(inspecteur.items[0]).toMatchObject({ id: fx.positionFact, source: null, needsVerification: true });

    await agent.put(`/me/checklist/${fx.generalFact}`).send({ checked: true }).expect(200, { ok: true });
    await agent.put(`/me/checklist/${fx.generalFact}`).send({ checked: true }).expect(200);
    const r2 = await agent.get(`/me/checklist/${famSlug}`).expect(200);
    expect(r2.body[0].items[0].checked).toBe(true);
    expect(r2.body[1].items[0].checked).toBe(false);

    await agent.put(`/me/checklist/${fx.generalFact}`).send({ checked: false }).expect(200);
    expect(await db.select().from(userDocumentChecks).where(eq(userDocumentChecks.userId, userId))).toHaveLength(0);

    await agent.put(`/me/checklist/${fx.otherFact}`).send({ checked: true }).expect(404);
    await agent.put('/me/checklist/not-a-uuid').send({ checked: true }).expect(404);
    await agent.put(`/me/checklist/${fx.generalFact}`).send({ checked: 'yes' }).expect(400);
    await agent.get(`/me/checklist/nope-${run}`).expect(404);
  });

  it('records, lists and deletes physical training logs (owner only)', async () => {
    const a = await agent.post('/me/physical-logs').send({ testCode: 'run 1000m', value: 245.5, unit: 's', notes: ' morning ' }).expect(201);
    expect(a.body).toMatchObject({ testCode: 'RUN_1000M', value: 245.5, unit: 's', notes: 'morning' });
    const b = await agent.post('/me/physical-logs').send({ testCode: 'PUSHUPS', value: 30, unit: 'rep', loggedAt: '2026-10-01T07:00:00Z' }).expect(201);
    expect(b.body.loggedAt).toBe('2026-10-01T07:00:00.000Z');

    const all = await agent.get('/me/physical-logs').expect(200);
    expect(all.body.map((l: { testCode: string }) => l.testCode)).toEqual(['RUN_1000M', 'PUSHUPS']);
    const runs = await agent.get('/me/physical-logs?testCode=run_1000m').expect(200);
    expect(runs.body).toHaveLength(1);

    await agent.post('/me/physical-logs').send({ testCode: 'RUN', value: 1, unit: 's', loggedAt: '2099-01-01' }).expect(400);
    await agent.post('/me/physical-logs').send({ testCode: '!!', value: 1, unit: 's' }).expect(400);

    const stranger = request.agent(app.getHttpServer());
    await stranger.post('/auth/guest').send({}).expect(200);
    await stranger.delete(`/me/physical-logs/${a.body.id}`).expect(404);
    const strangerId = (await stranger.get('/auth/me')).body.user.id as string;
    await db.delete(users).where(eq(users.id, strangerId));

    await agent.delete(`/me/physical-logs/${a.body.id}`).expect(200, { ok: true });
    expect((await agent.get('/me/physical-logs').expect(200)).body).toHaveLength(1);
  });

  it('unsubscribes from emails with a signed one-click link (no session) and rejects forged tokens', async () => {
    expect(verifyUnsubscribeToken(unsubscribeToken(userId))).toBe(userId);
    const forged = `${Buffer.from(userId).toString('base64url')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();

    const server = request(app.getHttpServer());
    const r = await server.get(`/email/unsubscribe/${forged}`).expect(302);
    expect(r.headers.location).toContain('emailUnsubscribed=0');
    const ok = await server.get(`/email/unsubscribe/${unsubscribeToken(userId)}`).expect(302);
    expect(ok.headers.location).toContain('emailUnsubscribed=1');
    const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    expect(p.alertChannels).toEqual(['IN_APP', 'PUSH']);
    await server.post(`/email/unsubscribe/${unsubscribeToken(userId)}`).expect(200, { ok: true });

    // An unsubscribe token is not a session.
    await server.get('/me/profile').set('Authorization', `Bearer ${unsubscribeToken(userId)}`).expect(401);
  });

  it('exports all personal data without secrets', async () => {
    await agent.put('/me/profile').send({ birthDate: '2001-03-04', phone: '+216 20 123 456' }).expect(200);
    await db.insert(pushSubscriptions).values({ userId, endpoint: `https://push.example/${run}`, p256dh: 'secret-p256dh', auth: 'secret-auth' });
    const r = await agent.get('/me/export').expect(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="concours-tn-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(r.body).toMatchObject({ format: 'concours-tn-export/v1', account: { id: userId, email: EMAIL, phone: '+216 20 123 456' } });
    expect(r.body.profile.birthDate).toBe('2001-03-04');
    expect(r.body.physicalLogs).toHaveLength(1);
    expect(r.body.pushSubscriptions).toEqual([expect.objectContaining({ endpoint: `https://push.example/${run}` })]);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('secret-p256dh');
    expect(text).not.toContain('tokenHash');
  });

  it('deletes the account: anonymised, logged out, contact channels removed, credentials invalid', async () => {
    await agent.delete('/me').send({ confirm: 'nope' }).expect(400);
    const staleCookie = String((await agent.post('/auth/guest').send({}).expect(200)).headers['set-cookie']).split(';')[0];
    const r = await agent.delete('/me').send({ confirm: 'DELETE' }).expect(200, { ok: true });
    expect(String(r.headers['set-cookie'])).toMatch(/ctn_session=;/);

    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u).toMatchObject({ email: null, name: null, phone: null, passwordHash: null });
    expect(u.deletedAt).toBeInstanceOf(Date);
    const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    expect(p).toMatchObject({ birthDate: null, alertsEnabled: false, alertChannels: [] });
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(inArray(auditLogs.entityId, [userId]))).toHaveLength(1);

    const server = request(app.getHttpServer());
    // A JWT issued before the deletion no longer opens personal routes, and /auth/me drops it.
    await server.get('/me/profile').set('Cookie', staleCookie).expect(401);
    const me = await server.get('/auth/me').set('Cookie', staleCookie).expect(200);
    expect(me.body.user).toBeNull();
    await server.post('/auth/login').send({ email: EMAIL, password: 'password-123' }).expect(401);
    // the email can be used again
    const again = await server.post('/auth/register').send({ email: EMAIL, password: 'password-456', name: 'New' }).expect(200);
    expect(again.body.user.id).not.toBe(userId);
    await db.delete(auditLogs).where(eq(auditLogs.entityId, userId));
  });
});

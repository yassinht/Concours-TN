import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import request from 'supertest';
import webpush from 'web-push';
import { CommonModule } from '../../common/common.module';
import { addDays, tunisToday } from '../../common/dates';
import { SESSION_COOKIE, signSession } from '../../common/session';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import {
  alertMatches, competitionFamilies, competitions, emailOutbox, enrollments, follows, notificationDeliveries, notifications,
  organizations, plans, positions, pushSubscriptions, subscriptions, userProfiles, userStats, users, xpEvents,
} from '../../db/schema';
import { GamificationModule } from '../gamification/gamification.module';
import { addDaysIso } from '../gamification/tunis-time';
import { AlertsService } from './alerts.service';
import { NotificationsCron } from './notifications.cron';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';
import { daysAr, formatDate, questionsAr, resolveChannels, safeLink } from './notifications.util';
import { PushService, isAllowedPushEndpoint } from './push.service';

const run = randomBytes(4).toString('hex');
/** Positions of the test family require this nationality: real users (nationality TN) can never match them. */
const NAT = `X${run}`;
const email = (who: string) => `${who}-${run}@test.concours.tn`;

describe('notification helpers', () => {
  it('resolves channels: callers narrow, never widen, user preferences', () => {
    expect([...resolveChannels(['IN_APP', 'EMAIL'])].sort()).toEqual(['EMAIL', 'IN_APP']);
    expect([...resolveChannels(['IN_APP', 'EMAIL'], ['IN_APP', 'PUSH'])]).toEqual(['IN_APP']);
    expect([...resolveChannels(null, ['PUSH'])].sort()).toEqual(['IN_APP', 'PUSH']);
    expect([...resolveChannels([])]).toEqual(['IN_APP']);
  });

  it('keeps only safe links and known push services', () => {
    expect(safeLink('/concours/douane')).toBe('/concours/douane');
    expect(safeLink('https://www.concours.gov.tn/x')).toBe('https://www.concours.gov.tn/x');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('//evil.example/x')).toBeNull();
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false);
  });

  it('writes Arabic day counts with agreement', () => {
    expect([1, 2, 7, 11].map((n) => daysAr(n))).toEqual(['يوم واحد', 'يومان', '7 أيام', '11 يومًا']);
    expect(daysAr(2, true)).toBe('يومين');
    expect(daysAr(100)).toBe('100 يوم');
    expect([1, 2, 5, 11, 100, 103, 250].map(questionsAr)).toEqual(['سؤال واحد', 'سؤالان', '5 أسئلة', '11 سؤالًا', '100 سؤال', '103 أسئلة', '250 سؤالًا']);
    expect(formatDate('2026-10-17')).toBe('17/10/2026');
  });
});

describe('notifications & concours alerts (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let alerts: AlertsService;
  let svc: NotificationsService;
  let cron: NotificationsCron;
  let push: PushService;
  const userIds: string[] = [];
  const u: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F', string> = { A: '', B: '', C: '', D: '', E: '', F: '' };
  const fx: { org?: string; fam?: string; fam2?: string; ed1?: string; draft?: string; ed2?: string; plan?: string } = {};
  const famSlug = `notif-fam-${run}`;
  const today = tunisToday();
  const deadline1 = addDaysIso(today, 10);

  const cookie = (id: string, isGuest = false) => `${SESSION_COOKIE}=${signSession({ id, role: 'USER', isGuest })}`;
  const http = () => request(app.getHttpServer());

  async function createUser(v: {
    key: string; locale: 'ar' | 'fr'; guest?: boolean; verified?: boolean; name?: string;
    profile?: Partial<typeof userProfiles.$inferInsert> | null;
  }): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({
        isGuest: !!v.guest,
        email: v.guest ? null : email(v.key.toLowerCase()),
        name: v.name ?? v.key,
        locale: v.locale,
        emailVerifiedAt: v.verified ? new Date() : null,
        referralCode: `N${run}${v.key}`.toUpperCase(),
      })
      .returning();
    userIds.push(row.id);
    if (v.profile !== null) await db.insert(userProfiles).values({ userId: row.id, nationality: NAT, ...(v.profile ?? {}) });
    return row.id;
  }

  // Concours notifications are scoped to this run's families: other suites running in parallel on the same database may
  // publish OPEN editions (e.g. a family without positions, which matches anyone following its field as "to verify").
  const notifsOf = (userId: string, type?: string) =>
    db.select().from(notifications).where(and(
      eq(notifications.userId, userId),
      type ? eq(notifications.type, type) : undefined,
      type?.startsWith('CONCOURS_') ? like(sql`${notifications.data}->>'familySlug'`, `notif-fam%-${run}`) : undefined,
    ));
  const deliveriesOf = (notificationId: string) =>
    db.select().from(notificationDeliveries).where(eq(notificationDeliveries.notificationId, notificationId));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DbModule, CommonModule, GamificationModule, NotificationsModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get<Database>(DB);
    alerts = app.get(AlertsService);
    svc = app.get(NotificationsService);
    cron = app.get(NotificationsCron);
    push = app.get(PushService);

    const [org] = await db.insert(organizations).values({ slug: `notif-org-${run}`, nameAr: 'الإدارة العامة للديوانة', nameFr: 'Douane' }).returning();
    const [fam] = await db
      .insert(competitionFamilies)
      .values({ slug: famSlug, organizationId: org.id, field: 'CUSTOMS', nameAr: 'الديوانة التجريبية', nameFr: 'Douane test' })
      .returning();
    const [fam2] = await db
      .insert(competitionFamilies)
      .values({ slug: `notif-fam2-${run}`, organizationId: org.id, field: 'HEALTH', nameAr: 'الصحة التجريبية', nameFr: 'Santé test' })
      .returning();
    await db.insert(positions).values([
      {
        familyId: fam.id, slug: 'agent', titleAr: 'عون ديوانة', titleFr: 'Agent des douanes', orderIndex: 1, diplomaLevel: 'BAC',
        eligibility: { min_age: 18, max_age: 30, min_diploma: 'BAC', nationality: NAT }, eligibilityNeedsVerification: false,
      },
      {
        familyId: fam.id, slug: 'inspecteur', titleAr: 'متفقد ديوانة', titleFr: 'Inspecteur des douanes', orderIndex: 2, diplomaLevel: 'LICENCE',
        eligibility: { min_age: 20, max_age: 35, min_diploma: 'LICENCE', nationality: NAT }, eligibilityNeedsVerification: true,
      },
    ]);
    const [ed1] = await db
      .insert(competitions)
      .values({
        familyId: fam.id, year: 2026, status: 'OPEN', registrationOpen: addDaysIso(today, -2), registrationDeadline: deadline1,
        examDate: addDaysIso(today, 40), contentStatus: 'PUBLISHED', needsVerification: false, confidence: 'HIGH',
      })
      .returning();
    const [draft] = await db
      .insert(competitions)
      .values({ familyId: fam.id, year: 2026, status: 'OPEN', registrationDeadline: deadline1, contentStatus: 'DRAFT' })
      .returning();
    Object.assign(fx, { org: org.id, fam: fam.id, fam2: fam2.id, ed1: ed1.id, draft: draft.id });

    // A: eligible for "agent" (26 y, BAC), fr, verified email, wants CUSTOMS alerts by email only.
    u.A = await createUser({ key: 'A', name: 'Amel Ayari', locale: 'fr', verified: true, profile: { birthDate: '2000-05-01', diplomaLevel: 'BAC', alertFields: ['CUSTOMS'], alertChannels: ['IN_APP', 'EMAIL'], dailyReminderHour: 3 } });
    // B: too old for both positions.
    u.B = await createUser({ key: 'B', name: 'Bilel Ben Ali', locale: 'ar', verified: true, profile: { birthDate: '1970-01-01', diplomaLevel: 'LICENCE', alertFields: ['CUSTOMS'] } });
    // C: eligible profile but only wants HEALTH alerts.
    u.C = await createUser({ key: 'C', locale: 'fr', profile: { birthDate: '2001-01-01', diplomaLevel: 'LICENCE', alertFields: ['HEALTH'], dailyReminderHour: 3 } });
    // D: guest without profile who follows the family → PARTIAL match.
    u.D = await createUser({ key: 'D', locale: 'ar', guest: true, profile: null });
    // E: eligible but alerts disabled.
    u.E = await createUser({ key: 'E', locale: 'fr', verified: true, profile: { birthDate: '2001-01-01', diplomaLevel: 'LICENCE', alertFields: ['CUSTOMS'], alertsEnabled: false } });
    // F: enrolled in the family, not eligible (36 y), unverified email.
    u.F = await createUser({ key: 'F', locale: 'fr', profile: { birthDate: '1990-01-01', diplomaLevel: 'BAC', dailyReminderHour: 3 } });

    await db.insert(follows).values({ userId: u.D, familyId: fam.id });
    await db.insert(enrollments).values([
      { userId: u.F, familyId: fam.id },
      { userId: u.C, familyId: fam2.id, targetExamDate: '2099-01-31' },
    ]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (db) {
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
      await db.delete(emailOutbox).where(inArray(emailOutbox.to, ['a', 'b', 'c', 'e', 'f'].map(email)));
      if (fx.plan) await db.delete(plans).where(eq(plans.id, fx.plan));
      if (fx.fam) await db.delete(competitionFamilies).where(inArray(competitionFamilies.id, [fx.fam, fx.fam2 as string]));
      if (fx.org) await db.delete(organizations).where(eq(organizations.id, fx.org));
    }
    await app?.close();
  });

  describe('matchCompetition — notify people when a concours matches their profile', () => {
    it('notifies only the eligible profile and the follower, once per edition', async () => {
      const r = await alerts.matchCompetition(fx.ed1 as string);
      expect(r).toEqual({ matchedUsers: 2, notified: 2 });

      const [a] = await notifsOf(u.A, 'CONCOURS_MATCH');
      expect(a).toMatchObject({
        title: 'Nouveau concours pour votre profil : Douane test',
        url: `/concours/${famSlug}`,
        dedupeKey: `match:${fx.ed1}`,
        readAt: null,
      });
      expect(a.body).toContain('Postes : Agent des douanes');
      expect(a.body).toContain(`Date limite d’inscription : ${formatDate(deadline1)}`);
      expect(a.body).toContain('Votre profil remplit les conditions connues.');
      expect(a.body).toContain('Suivez ce concours');
      expect(a.body).not.toContain('à vérifier');
      expect(a.data).toMatchObject({ competitionId: fx.ed1, familySlug: famSlug, positionSlugs: ['agent'], eligibility: 'ELIGIBLE', rulesUnverified: false });

      const [d] = await notifsOf(u.D, 'CONCOURS_MATCH');
      expect(d.title).toBe('مناظرة جديدة تناسب ملفك: الديوانة التجريبية');
      expect(d.body).toContain('عون ديوانة، متفقد ديوانة');
      expect(d.body).toContain('أكمل ملفك الشخصي');
      expect(d.body).toContain('الشروط للتحقق');
      expect(d.body).not.toContain('تابع المناظرة'); // already follows
      expect(d.data).toMatchObject({ eligibility: 'PARTIAL', rulesUnverified: true });

      for (const id of [u.B, u.C, u.E, u.F]) expect(await notifsOf(id, 'CONCOURS_MATCH')).toHaveLength(0);

      const matches = await db.select().from(alertMatches).where(eq(alertMatches.competitionId, fx.ed1 as string));
      expect(matches.filter((m) => m.userId === u.A)).toHaveLength(1);
      expect(matches.filter((m) => m.userId === u.D)).toHaveLength(2);
      expect(matches.every((m) => m.notificationId)).toBe(true);
      expect(new Set(matches.map((m) => m.userId))).toEqual(new Set([u.A, u.D]));

      const [ed] = await db.select().from(competitions).where(eq(competitions.id, fx.ed1 as string));
      expect(ed.alertsSentAt).toBeInstanceOf(Date);
    });

    it('is idempotent on a second run', async () => {
      const r = await alerts.matchCompetition(fx.ed1 as string);
      expect(r).toEqual({ matchedUsers: 2, notified: 0 });
      expect(await notifsOf(u.A, 'CONCOURS_MATCH')).toHaveLength(1);
      expect(await notifsOf(u.D, 'CONCOURS_MATCH')).toHaveLength(1);
      expect(await db.select().from(alertMatches).where(eq(alertMatches.competitionId, fx.ed1 as string))).toHaveLength(3);
    });

    it('delivers per channel: email (localized, unsubscribe link) for A, push/email skipped for the guest', async () => {
      const [a] = await notifsOf(u.A, 'CONCOURS_MATCH');
      const da = await deliveriesOf(a.id);
      expect(da.map((x) => `${x.channel}:${x.status}`).sort()).toEqual(['EMAIL:SENT', 'IN_APP:SENT']);
      const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.to, email('a')));
      expect(mail.status).toBe('LOGGED');
      expect(mail.subject).toBe('Nouveau concours pour votre profil : Douane test — Concours TN');
      expect(mail.html).toContain('dir="ltr"');
      expect(mail.html).toContain(`http://localhost:3000/concours/${famSlug}`);
      expect(mail.html).toContain('/email/unsubscribe/');
      expect(mail.text).toContain('Voir le concours');
      expect(mail.text).toContain('pas un site officiel');

      const [d] = await notifsOf(u.D, 'CONCOURS_MATCH');
      const dd = await deliveriesOf(d.id);
      expect(dd.map((x) => `${x.channel}:${x.status}:${x.error ?? ''}`).sort()).toEqual([
        'EMAIL:SKIPPED:NO_EMAIL', 'IN_APP:SENT:', 'PUSH:SKIPPED:VAPID_NOT_CONFIGURED',
      ]);
    });

    it('never announces unpublished editions', async () => {
      expect(await alerts.matchCompetition(fx.draft as string)).toEqual({ matchedUsers: 0, notified: 0 });
      expect(await alerts.matchCompetition('not-a-uuid')).toEqual({ matchedUsers: 0, notified: 0 });
      const [draft] = await db.select().from(competitions).where(eq(competitions.id, fx.draft as string));
      expect(draft.alertsSentAt).toBeNull();
    });

    it('matchUser re-evaluates one user after a profile change (new match notified, stale match removed)', async () => {
      await db.update(userProfiles).set({ birthDate: '2002-01-01' }).where(eq(userProfiles.userId, u.B));
      expect((await alerts.matchUser(u.B)).matched).toBeGreaterThanOrEqual(1);
      const [b] = (await notifsOf(u.B, 'CONCOURS_MATCH')).filter((n) => n.dedupeKey === `match:${fx.ed1}`);
      expect(b.title).toBe('مناظرة جديدة تناسب ملفك: الديوانة التجريبية');
      expect(b.body).toContain('ملفك يستوفي الشروط المعروفة.');
      expect(b.body).toContain('عون ديوانة، متفقد ديوانة');

      await db.update(userProfiles).set({ birthDate: '1960-01-01' }).where(eq(userProfiles.userId, u.A));
      await alerts.matchUser(u.A);
      expect(await db.select().from(alertMatches).where(and(eq(alertMatches.userId, u.A), eq(alertMatches.competitionId, fx.ed1 as string)))).toHaveLength(0);
      expect(await notifsOf(u.A, 'CONCOURS_MATCH')).toHaveLength(1); // the inbox keeps history
      await db.update(userProfiles).set({ birthDate: '2000-05-01' }).where(eq(userProfiles.userId, u.A));
      await alerts.matchUser(u.A);
      expect(await notifsOf(u.A, 'CONCOURS_MATCH')).toHaveLength(1); // deduped: no second alert for the same edition

      expect(await alerts.matchUser('nope')).toEqual({ matched: 0 });
    });

    it('GET /me/alerts lists my matches with edition, position and eligibility', async () => {
      const r = await http().get('/me/alerts').set('Cookie', cookie(u.B)).expect(200);
      const mine = r.body.filter((x: { competition: { id: string } }) => x.competition.id === fx.ed1);
      expect(mine.map((x: { positionSlug: string }) => x.positionSlug).sort()).toEqual(['agent', 'inspecteur']);
      expect(mine[0]).toMatchObject({
        competition: {
          id: fx.ed1, familySlug: famSlug, familyName_fr: 'Douane test', field: 'CUSTOMS', status: 'OPEN',
          registrationDeadline: deadline1, needsVerification: false, confidence: 'HIGH', source: null,
        },
        eligibility: { status: 'ELIGIBLE' },
        createdAt: expect.any(String),
      });
      expect(mine.find((x: { positionSlug: string }) => x.positionSlug === 'inspecteur').eligibility.rules_unverified).toBe(true);
      await http().get('/me/alerts').expect(401);
    });

    it('CONCOURS_UPDATE reaches followers, enrolled and matched users once', async () => {
      const summary = { ar: 'تم تأجيل آخر أجل للتسجيل.', fr: 'La date limite a été reportée.' };
      const sent = await alerts.notifyCompetitionUpdate(fx.ed1 as string, summary, 'postponed');
      expect(sent).toBe(4); // A (matched), B (matched), D (follows), F (enrolled)
      expect(await alerts.notifyCompetitionUpdate(fx.ed1 as string, summary, 'postponed')).toBe(0);
      const [f] = await notifsOf(u.F, 'CONCOURS_UPDATE');
      expect(f.title).toBe('Mise à jour : Douane test');
      expect(f.body).toContain('La date limite a été reportée.');
    });
  });

  describe('in-app inbox', () => {
    it('deduplicates by key, drops unsafe links and skips deleted users', async () => {
      const key = `test:${run}`;
      const id = await svc.notify(u.C, { type: 'SYSTEM', title: 'Bonjour', body: 'Test', url: 'javascript:alert(1)', dedupeKey: key });
      expect(id).toEqual(expect.any(String));
      expect(await svc.notify(u.C, { type: 'SYSTEM', title: 'Bonjour', body: 'Test', dedupeKey: key })).toBeNull();
      const [n] = await db.select().from(notifications).where(eq(notifications.id, id as string));
      expect(n.url).toBeNull();

      const ghost = await createUser({ key: 'G', locale: 'fr', profile: null });
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, ghost));
      expect(await svc.notifyMany([u.C, u.E, ghost, 'not-a-uuid', u.C], { type: 'SYSTEM', title: 'Annonce', body: 'Corps' })).toBe(2);
      expect(await notifsOf(ghost)).toHaveLength(0);
    });

    it('lists, counts and marks notifications as read (own notifications only)', async () => {
      const list = await http().get('/me/notifications?limit=5').set('Cookie', cookie(u.D, true)).expect(200);
      expect(list.body.items[0]).toMatchObject({ type: 'CONCOURS_UPDATE', readAt: null, url: `/concours/${famSlug}` });
      expect(list.body.unread).toBe(2);
      const matchId = list.body.items.find((n: { type: string }) => n.type === 'CONCOURS_MATCH').id;

      await http().post(`/me/notifications/${matchId}/read`).set('Cookie', cookie(u.A)).expect(404);
      await http().post('/me/notifications/not-a-uuid/read').set('Cookie', cookie(u.D, true)).expect(404);
      await http().post(`/me/notifications/${matchId}/read`).set('Cookie', cookie(u.D, true)).expect(200, { ok: true });
      await http().post(`/me/notifications/${matchId}/read`).set('Cookie', cookie(u.D, true)).expect(200, { ok: true });
      expect((await http().get('/me/notifications/unread-count').set('Cookie', cookie(u.D, true)).expect(200)).body).toEqual({ unread: 1 });

      const page2 = await http().get(`/me/notifications?limit=1&before=${encodeURIComponent(list.body.items[0].createdAt)}`).set('Cookie', cookie(u.D, true)).expect(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].id).not.toBe(list.body.items[0].id);

      await http().post('/me/notifications/read-all').set('Cookie', cookie(u.D, true)).expect(200, { ok: true });
      expect((await http().get('/me/notifications').set('Cookie', cookie(u.D, true)).expect(200)).body.unread).toBe(0);
      await http().get('/me/notifications?limit=500').set('Cookie', cookie(u.D, true)).expect(400);
      await http().get('/me/notifications').expect(401);
    });
  });

  describe('web push', () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${run}-ok`;
    const goneEndpoint = `https://fcm.googleapis.com/fcm/send/${run}-gone`;
    const keys = { p256dh: 'BOr1x2y3z4w5v6u7t8s9r0q1p2o3n4m5', auth: 'auth-secret-123' };

    it('exposes the VAPID key and manages subscriptions (validated, upserted by endpoint)', async () => {
      expect((await http().get('/push/vapid-public-key').expect(200)).body).toEqual({ key: null });
      await http().post('/push/subscribe').send({ endpoint, keys }).expect(401);
      await http().post('/push/subscribe').set('Cookie', cookie(u.F)).send({ endpoint: 'http://127.0.0.1:4000/x', keys }).expect(400);
      await http().post('/push/subscribe').set('Cookie', cookie(u.F)).send({ endpoint }).expect(400);
      await http().post('/push/subscribe').set('Cookie', cookie(u.F)).send({ endpoint, keys }).expect(200, { ok: true });
      // The same browser signs into another account: the subscription follows the browser.
      await http().post('/push/subscribe').set('Cookie', cookie(u.C)).send({ endpoint, keys }).expect(200, { ok: true });
      let [s] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
      expect(s.userId).toBe(u.C);
      await http().post('/push/unsubscribe').set('Cookie', cookie(u.F)).send({ endpoint }).expect(200, { ok: true });
      [s] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
      expect(s).toBeDefined(); // F cannot remove C's subscription
      await http().post('/push/unsubscribe').set('Cookie', cookie(u.C)).send({ endpoint }).expect(200, { ok: true });
      expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))).toHaveLength(0);
    });

    it('sends to every device, removes expired subscriptions and records the delivery', async () => {
      jest.spyOn(push, 'vapid').mockReturnValue({ publicKey: 'test-public-key', privateKey: 'test-private-key', subject: 'mailto:test@concours.tn' });
      const send = jest.spyOn(webpush, 'sendNotification').mockImplementation(async (sub) => {
        if (sub.endpoint === goneEndpoint) throw Object.assign(new Error('Gone'), { statusCode: 410 });
        return { statusCode: 201, body: '', headers: {} };
      });
      await http().post('/push/subscribe').set('Cookie', cookie(u.F)).send({ endpoint, keys }).expect(200);
      await http().post('/push/subscribe').set('Cookie', cookie(u.F)).send({ endpoint: goneEndpoint, keys }).expect(200);
      expect((await http().get('/push/vapid-public-key').expect(200)).body).toEqual({ key: 'test-public-key' });

      const id = await svc.notify(u.F, { type: 'SYSTEM', title: 'Rappel', body: 'Corps du message', url: '/app' });
      expect(send).toHaveBeenCalledTimes(2);
      const payload = JSON.parse(String(send.mock.calls[0][1]));
      expect(payload).toMatchObject({ title: 'Rappel', body: 'Corps du message', url: '/app', type: 'SYSTEM', id });
      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, u.F));
      expect(subs.map((x) => x.endpoint)).toEqual([endpoint]);
      const d = await deliveriesOf(id as string);
      expect(d.map((x) => `${x.channel}:${x.status}:${x.error ?? ''}`).sort()).toEqual(['EMAIL:SKIPPED:EMAIL_UNVERIFIED', 'IN_APP:SENT:', 'PUSH:SENT:']);

      const t = await http().post('/push/test').set('Cookie', cookie(u.F)).expect(200);
      expect(t.body).toEqual({ ok: true, status: 'SENT', error: null });
      jest.restoreAllMocks();
    });
  });

  describe('scheduled reminders', () => {
    beforeAll(async () => {
      const [ed2] = await db
        .insert(competitions)
        .values({
          familyId: fx.fam as string, year: 2099, status: 'OPEN', registrationOpen: '2099-03-01', registrationDeadline: '2099-03-08',
          examDate: '2099-03-20', contentStatus: 'PUBLISHED', needsVerification: true, alertsSentAt: new Date('2026-01-01T10:00:00Z'),
        })
        .returning();
      fx.ed2 = ed2.id;
    });

    it('sends deadline reminders at D-7, D-2 and D-0 to followers/enrolled users, deduplicated', async () => {
      expect(await cron.runDeadlineReminders('2099-03-01')).toBe(2);
      expect(await cron.runDeadlineReminders('2099-03-01')).toBe(0);
      expect(await cron.runDeadlineReminders('2099-03-03')).toBe(0); // D-5: no reminder
      expect(await cron.runDeadlineReminders('2099-03-06')).toBe(2);
      expect(await cron.runDeadlineReminders('2099-03-08')).toBe(2);

      const d = (await notifsOf(u.D, 'DEADLINE_REMINDER')).filter((n) => n.dedupeKey?.startsWith(`deadline:${fx.ed2}`));
      expect(d.map((n) => n.title).sort()).toEqual([
        'اليوم آخر أجل للتسجيل: الديوانة التجريبية',
        'بقي يومان على آخر أجل للتسجيل: الديوانة التجريبية',
        'بقيت 7 أيام على آخر أجل للتسجيل: الديوانة التجريبية',
      ]);
      expect(d[0].body).toContain('08/03/2099 (تاريخ للتحقق)');
      const f = await notifsOf(u.F, 'DEADLINE_REMINDER');
      expect(f.map((n) => n.title)).toContain('Plus que 7 jours pour s’inscrire : Douane test');
      expect(f.map((n) => n.dedupeKey)).toContain(`deadline:${fx.ed2}:2099-03-08:D7`);
      // Not following: no reminder even though B matched another edition of the family.
      expect(await notifsOf(u.B, 'DEADLINE_REMINDER')).toHaveLength(0);
    });

    it('sends exam reminders at D-7 and D-1, and a "registration opens" update', async () => {
      expect(await cron.runExamReminders('2099-03-13')).toBe(2);
      expect(await cron.runExamReminders('2099-03-13')).toBe(0);
      expect(await cron.runExamReminders('2099-03-19')).toBe(2);
      const titles = (await notifsOf(u.D, 'EXAM_REMINDER')).map((n) => n.title).sort();
      expect(titles).toEqual(['الاختبار بعد 7 أيام: الديوانة التجريبية', 'الاختبار غدًا: الديوانة التجريبية']);

      expect(await cron.runRegistrationOpens('2099-03-01')).toBe(2);
      expect(await cron.runRegistrationOpens('2099-03-01')).toBe(0);
      const [opens] = (await notifsOf(u.F, 'CONCOURS_UPDATE')).filter((n) => n.dedupeKey === `opens:${fx.ed2}:2099-03-01`);
      expect(opens.title).toBe('Inscriptions ouvertes : Douane test');
    });

    it('sends study reminders at the chosen hour to users who have not practised today (push/in-app only)', async () => {
      await db.insert(userStats).values([
        { userId: u.C, streakCurrent: 4, lastActiveDate: '2098-12-31' },
        { userId: u.F, streakCurrent: 1, lastActiveDate: '2099-01-01' }, // already active today
      ]);
      const at = new Date('2099-01-01T02:10:00Z'); // 03:10 in Tunis
      expect(await cron.runStudyReminders(at)).toBeGreaterThanOrEqual(2);
      expect(await cron.runStudyReminders(at)).toBe(0);

      const [a] = await notifsOf(u.A, 'STUDY_REMINDER');
      expect(a).toMatchObject({ title: 'Votre séance du jour vous attend', dedupeKey: 'study:2099-01-01', url: '/app' });
      expect((await deliveriesOf(a.id)).map((x) => x.channel)).toEqual(['IN_APP']); // A allows email, but nudges never email
      const [c] = await notifsOf(u.C, 'STUDY_REMINDER');
      expect(c.body).toContain('J-30 avant Santé test.');
      expect(c.body).toContain('Gardez votre série (4 jours d’affilée)');
      expect(await notifsOf(u.F, 'STUDY_REMINDER')).toHaveLength(0);
    });

    it('warns about streaks at risk at 20:00', async () => {
      await db.insert(userStats).values({ userId: u.B, streakCurrent: 5, streakFreezes: 0, lastActiveDate: '2099-01-31' });
      await db.insert(userStats).values({ userId: u.D, streakCurrent: 3, streakFreezes: 1, lastActiveDate: '2099-01-30' });
      expect(await cron.runStreakAtRisk('2099-02-01')).toBe(2);
      expect(await cron.runStreakAtRisk('2099-02-01')).toBe(0);
      const [b] = await notifsOf(u.B, 'STREAK_AT_RISK');
      expect(b.title).toBe('سلسلتك (5 أيام) في خطر');
      expect(b.body).toContain('قبل منتصف الليل');
      const [d] = await notifsOf(u.D, 'STREAK_AT_RISK');
      expect(d.title).toBe('سلسلتك (3 أيام) في خطر');
    });

    it('expires subscriptions, warns before the end and stays quiet when another subscription runs', async () => {
      const [plan] = await db
        .insert(plans)
        .values({ code: `test-${run}`, nameAr: 'تجريبي', nameFr: 'Test', priceMillimes: 1000, period: 'month', durationDays: 30, features: {} })
        .returning();
      fx.plan = plan.id;
      const now = new Date();
      const sub = (userId: string, endsInMs: number) => ({
        userId, planId: plan.id, status: 'ACTIVE' as const, startsAt: addDays(now, -30), endsAt: new Date(now.getTime() + endsInMs),
      });
      const [expiredA] = await db.insert(subscriptions).values(sub(u.A, -3_600_000)).returning();
      await db.insert(subscriptions).values([sub(u.E, -3_600_000), sub(u.E, 20 * 86_400_000)]);
      const [endingB] = await db.insert(subscriptions).values(sub(u.B, 2 * 86_400_000 - 60_000)).returning();
      await db.insert(subscriptions).values([sub(u.F, 2 * 86_400_000), sub(u.F, 30 * 86_400_000)]);

      const r = await cron.runSubscriptionExpiry(now);
      expect(r.expired).toBeGreaterThanOrEqual(2);
      const [a] = await db.select().from(subscriptions).where(eq(subscriptions.id, expiredA.id));
      expect(a.status).toBe('EXPIRED');
      const [na] = await notifsOf(u.A, 'SUBSCRIPTION');
      expect(na).toMatchObject({ title: 'Votre abonnement Premium a expiré', dedupeKey: `sub-expired:${expiredA.id}`, url: '/app/billing' });
      expect(await notifsOf(u.E, 'SUBSCRIPTION')).toHaveLength(0);
      expect(await db.select().from(subscriptions).where(and(eq(subscriptions.userId, u.E), eq(subscriptions.status, 'ACTIVE')))).toHaveLength(1);

      await cron.runSubscriptionEndingSoon(now);
      await cron.runSubscriptionEndingSoon(now);
      const nb = await notifsOf(u.B, 'SUBSCRIPTION');
      expect(nb).toHaveLength(1);
      expect(nb[0]).toMatchObject({ title: 'اشتراكك ينتهي بعد يومين', dedupeKey: `sub-ending:${endingB.id}` });
      expect(await notifsOf(u.F, 'SUBSCRIPTION')).toHaveLength(0);
      expect(await db.select().from(notifications).where(and(eq(notifications.userId, u.E), isNull(notifications.readAt), eq(notifications.type, 'SUBSCRIPTION')))).toHaveLength(0);
    });

    it('sends a weekly recap to users who practised this week, with the closest followed deadline', async () => {
      await db.insert(xpEvents).values([
        { userId: u.D, amount: 40, reason: 'CORRECT', createdAt: new Date('2099-01-02T10:00:00Z') },
        { userId: u.F, amount: 15, reason: 'ANSWER', createdAt: new Date('2099-01-03T10:00:00Z') },
        { userId: u.C, amount: 99, reason: 'OLD', createdAt: new Date('2098-12-20T10:00:00Z') }, // previous week
      ]);
      const sunday = new Date('2099-01-04T17:00:00Z'); // 18:00 in Tunis
      expect(await cron.runWeeklyDigest(sunday)).toBe(2);
      expect(await cron.runWeeklyDigest(sunday)).toBe(0);
      const [d] = (await notifsOf(u.D, 'SYSTEM')).filter((n) => n.dedupeKey === 'weekly:2099-01-04');
      expect(d.title).toBe('حصيلة أسبوعك');
      expect(d.body).toContain('هذا الأسبوع: 40 XP.');
      expect(d.body).toContain('أقرب آخر أجل للتسجيل: الديوانة التجريبية — 08/03/2099.');
      const [f] = (await notifsOf(u.F, 'SYSTEM')).filter((n) => n.dedupeKey === 'weekly:2099-01-04');
      expect(f.title).toBe('Votre bilan de la semaine');
      expect(f.data).toMatchObject({ kind: 'WEEKLY_DIGEST', xp: 15 });
      expect((await notifsOf(u.C, 'SYSTEM')).filter((n) => n.dedupeKey === 'weekly:2099-01-04')).toHaveLength(0);
    });

    it('purges notifications older than a year and email logs older than 90 days', async () => {
      const now = new Date();
      const [old] = await db
        .insert(notifications)
        .values({ userId: u.C, type: 'SYSTEM', title: 'old', body: 'old', createdAt: new Date(now.getTime() - 400 * 86_400_000) })
        .returning();
      const [recent] = await db.insert(notifications).values({ userId: u.C, type: 'SYSTEM', title: 'recent', body: 'recent' }).returning();
      const [oldMail] = await db
        .insert(emailOutbox)
        .values({ to: email('c'), subject: 'old', html: '<p>old</p>', status: 'LOGGED', createdAt: new Date(now.getTime() - 100 * 86_400_000) })
        .returning();
      const r = await cron.runCleanup(now);
      expect(r.notifications).toBeGreaterThanOrEqual(1);
      expect(r.emails).toBeGreaterThanOrEqual(1);
      expect(await db.select().from(notifications).where(eq(notifications.id, old.id))).toHaveLength(0);
      expect(await db.select().from(notifications).where(eq(notifications.id, recent.id))).toHaveLength(1);
      expect(await db.select().from(emailOutbox).where(eq(emailOutbox.id, oldMail.id))).toHaveLength(0);
    });
  });
});

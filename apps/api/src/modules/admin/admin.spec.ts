import { DynamicModule, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import type { UserRole } from '@ctn/shared';
import { CommonModule } from '../../common/common.module';
import { signSession } from '../../common/session';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import {
  auditLogs, competitionFacts, competitionFamilies, competitions, contentReviews, follows, learningObjectives, organizations, payments, plans, questions, sources,
  syllabusNodes, users,
} from '../../db/schema';
import { EntitlementsService } from '../billing/entitlements.service';
import { PaymentsService } from '../billing/payments.service';
import { AlertsService } from '../notifications/alerts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminModule } from './admin.module';
import { validateQuestionContent } from './question-content';
import { planTransition } from './review.workflow';
import { updateSummary, type EditionSnapshot } from './edition-alerts.service';

const run = randomBytes(4).toString('hex');
const FAMILY = `test-fam-${run}`;
const ORG = `test-org-${run}`;
const TOPIC = `test.admin.${run}`;
const OBJECTIVE = `${TOPIC}.o1`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const alerts = {
  matchCompetition: jest.fn(async () => ({ matchedUsers: 3, notified: 2 })),
  notifyCompetitionUpdate: jest.fn(async () => 5),
  matchUser: jest.fn(async () => ({ matched: 0 })),
};
const notificationsMock = {
  notify: jest.fn(async () => 'notification-id'),
  notifyMany: jest.fn(async (ids: string[]) => ids.length),
};
const paymentsMock = { markPaid: jest.fn(async () => undefined), markFailed: jest.fn(async () => undefined) };
const entitlementsMock = {
  grantDays: jest.fn(async () => undefined),
  get: jest.fn(async () => ({ premium: true, planCode: 'PREMIUM_MONTH', endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), limits: {} })),
};

@Module({})
class CrossModuleMocks {
  static forRoot(): DynamicModule {
    const providers = [
      { provide: AlertsService, useValue: alerts },
      { provide: NotificationsService, useValue: notificationsMock },
      { provide: PaymentsService, useValue: paymentsMock },
      { provide: EntitlementsService, useValue: entitlementsMock },
    ];
    return { module: CrossModuleMocks, global: true, providers, exports: providers.map((p) => p.provide) };
  }
}

describe('admin (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const ids = { admin: '', editor: '', user: '', topic: '', objective: '' };
  const cookies: Record<'admin' | 'editor' | 'user', string> = { admin: '', editor: '', user: '' };
  const createdSources: string[] = [];

  const http = () => request(app.getHttpServer());
  const cookieFor = (id: string, role: UserRole, isGuest = false) => `ctn_session=${signSession({ id, role, isGuest })}`;

  async function makeUser(role: UserRole): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email: `admin-spec-${run}-${role.toLowerCase()}-${randomBytes(3).toString('hex')}@test.local`, name: `${role} ${run}`, role, isGuest: false, referralCode: `T${randomBytes(5).toString('hex').toUpperCase()}` })
      .returning({ id: users.id });
    return u.id;
  }

  async function makeQuestion(status: 'DRAFT' | 'AI_REVIEWED' | 'HUMAN_REVIEWED', origin: 'AUTHORED' | 'AI_GENERATED' = 'AUTHORED'): Promise<string> {
    const [q] = await db
      .insert(questions)
      .values({
        type: 'MCQ_SINGLE', domain: 'FRENCH', language: 'fr', stem: `Question ${run} ${randomBytes(4).toString('hex')} ?`,
        options: [{ id: 'a', text: 'Oui' }, { id: 'b', text: 'Non' }], correct: ['a'], explanation: 'Parce que.', difficulty: 'EASY',
        topicId: ids.topic, origin, status, aiModel: origin === 'AI_GENERATED' ? 'test-model' : null,
      })
      .returning({ id: questions.id });
    return q.id;
  }

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [DbModule, CommonModule, CrossModuleMocks.forRoot(), AdminModule] }).compile();
    app = ref.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get<Database>(DB);

    ids.admin = await makeUser('ADMIN');
    ids.editor = await makeUser('EDITOR');
    ids.user = await makeUser('USER');
    cookies.admin = cookieFor(ids.admin, 'ADMIN');
    cookies.editor = cookieFor(ids.editor, 'EDITOR');
    cookies.user = cookieFor(ids.user, 'USER');

    const [node] = await db
      .insert(syllabusNodes)
      .values({ key: TOPIC, level: 'TOPIC', domain: 'FRENCH', titleAr: 'موضوع اختبار', titleFr: 'Sujet test', scope: 'GENERAL_SKILL' })
      .returning({ id: syllabusNodes.id });
    ids.topic = node.id;
    const [obj] = await db
      .insert(learningObjectives)
      .values({ key: OBJECTIVE, nodeId: node.id, textAr: 'هدف', textFr: 'Objectif' })
      .returning({ id: learningObjectives.id });
    ids.objective = obj.id;
  });

  afterAll(async () => {
    if (db) {
      const staff = [ids.admin, ids.editor, ids.user].filter(Boolean);
      const qIds = ids.topic ? (await db.select({ id: questions.id }).from(questions).where(eq(questions.topicId, ids.topic))).map((r) => r.id) : [];
      if (staff.length) {
        await db.delete(auditLogs).where(inArray(auditLogs.actorId, staff));
        await db.delete(contentReviews).where(inArray(contentReviews.reviewerId, staff));
      }
      if (qIds.length) await db.delete(questions).where(inArray(questions.id, qIds));
      await db.delete(competitionFamilies).where(eq(competitionFamilies.slug, FAMILY));
      await db.delete(organizations).where(eq(organizations.slug, ORG));
      if (ids.topic) await db.delete(syllabusNodes).where(eq(syllabusNodes.id, ids.topic));
      if (createdSources.length) await db.delete(sources).where(inArray(sources.id, createdSources));
      await db.delete(sources).where(like(sources.title, `Source ${run}%`));
      if (staff.length) await db.delete(users).where(inArray(users.id, staff));
    }
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ───────────── Access control ─────────────

  describe('access control', () => {
    it('rejects anonymous (401), guests (401) and normal users (403)', async () => {
      await http().get('/admin/stats').expect(401);
      await http().get('/admin/stats').set('Cookie', cookieFor(ids.user, 'USER', true)).expect(401);
      const res = await http().get('/admin/stats').set('Cookie', cookies.user).expect(403);
      expect(res.body.message).toBe('FORBIDDEN');
      await http().get('/admin/review').set('Cookie', cookies.user).expect(403);
      await http().post('/admin/questions').set('Cookie', cookies.user).send({}).expect(403);
    });

    it('re-reads the role from the database: a token minted before a demotion is refused', async () => {
      await http().get('/admin/stats').set('Cookie', cookieFor(ids.user, 'ADMIN')).expect(403);
    });

    it('keeps user management, payments and broadcast for ADMIN only', async () => {
      await http().get('/admin/users').set('Cookie', cookies.editor).expect(403);
      await http().get('/admin/payments').set('Cookie', cookies.editor).expect(403);
      await http().post('/admin/notifications/broadcast').set('Cookie', cookies.editor).send({ title: 'Hello', body: 'World' }).expect(403);
      await http().get('/admin/users').set('Cookie', cookies.admin).expect(200);
    });

    it('serves the dashboard stats to editors', async () => {
      const res = await http().get('/admin/stats').set('Cookie', cookies.editor).expect(200);
      expect(res.body.users.total).toBeGreaterThanOrEqual(3);
      expect(Object.keys(res.body.content.questions).sort()).toEqual(['AI_REVIEWED', 'ARCHIVED', 'DRAFT', 'HUMAN_REVIEWED', 'PUBLISHED']);
      expect(res.body.funnel).toEqual(expect.objectContaining({ visitors: expect.any(Number), diagnostic: expect.any(Number), registered: expect.any(Number), paid: expect.any(Number) }));
      expect(Array.isArray(res.body.weakTopics)).toBe(true);
      expect(typeof res.body.content.factsNeedingVerification).toBe('number');
      expect(typeof res.body.waitlist).toBe('number');
    });
  });

  // ───────────── Review workflow ─────────────

  describe('review transitions', () => {
    it('cannot publish a DRAFT question; approve then publish works and records the human reviewer', async () => {
      const id = await makeQuestion('DRAFT');
      const refused = await http().post(`/admin/review/question/${id}`).set('Cookie', cookies.editor).send({ action: 'publish' }).expect(409);
      expect(refused.body.message).toBe('INVALID_TRANSITION');
      expect((await db.select().from(questions).where(eq(questions.id, id)))[0].status).toBe('DRAFT');

      const approved = await http().post(`/admin/review/question/${id}`).set('Cookie', cookies.editor).send({ action: 'approve', comment: 'ok' }).expect(200);
      expect(approved.body).toEqual(expect.objectContaining({ from: 'DRAFT', status: 'HUMAN_REVIEWED' }));
      expect(approved.body.item.reviewedBy.id).toBe(ids.editor);

      const published = await http().post(`/admin/review/question/${id}`).set('Cookie', cookies.admin).send({ action: 'publish' }).expect(200);
      expect(published.body.status).toBe('PUBLISHED');
      const [row] = await db.select().from(questions).where(eq(questions.id, id));
      expect(row.status).toBe('PUBLISHED');
      expect(row.reviewedBy).toBe(ids.admin);
      expect(row.reviewedAt).toBeInstanceOf(Date);

      const history = await db.select().from(contentReviews).where(and(eq(contentReviews.entityType, 'question'), eq(contentReviews.entityId, id)));
      expect(history.map((h) => `${h.fromStatus}>${h.toStatus}`).sort()).toEqual(['DRAFT>HUMAN_REVIEWED', 'HUMAN_REVIEWED>PUBLISHED']);
      const logged = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, id), eq(auditLogs.entityType, 'question')));
      expect(logged.map((l) => l.action).sort()).toEqual(['review.approve', 'review.publish']);
    });

    it('approve + publish in one step from AI_REVIEWED records both hops and the reviewer', async () => {
      const id = await makeQuestion('AI_REVIEWED', 'AI_GENERATED');
      await http().post(`/admin/review/question/${id}`).set('Cookie', cookies.editor).send({ action: 'publish' }).expect(200);
      const [row] = await db.select().from(questions).where(eq(questions.id, id));
      expect(row.status).toBe('PUBLISHED');
      expect(row.reviewedBy).toBe(ids.editor);
      const history = await db.select().from(contentReviews).where(and(eq(contentReviews.entityType, 'question'), eq(contentReviews.entityId, id)));
      expect(history).toHaveLength(2);
    });

    it('reject requires a comment and archives AI drafts', async () => {
      const id = await makeQuestion('AI_REVIEWED', 'AI_GENERATED');
      const noComment = await http().post(`/admin/review/question/${id}`).set('Cookie', cookies.editor).send({ action: 'reject' }).expect(400);
      expect(noComment.body.message).toBe('COMMENT_REQUIRED');
      const res = await http().post(`/admin/review/question/${id}`).set('Cookie', cookies.editor).send({ action: 'reject', comment: 'Distracteur ambigu' }).expect(200);
      expect(res.body.status).toBe('ARCHIVED');
      const [review] = await db.select().from(contentReviews).where(and(eq(contentReviews.entityType, 'question'), eq(contentReviews.entityId, id)));
      expect(review.comment).toBe('Distracteur ambigu');
    });

    it('refuses to publish a question whose answer key is broken', async () => {
      const id = await makeQuestion('HUMAN_REVIEWED');
      await db.update(questions).set({ correct: ['z'] }).where(eq(questions.id, id));
      const res = await http().post(`/admin/review/question/${id}`).set('Cookie', cookies.editor).send({ action: 'publish' }).expect(422);
      expect(res.body.message).toBe('QUESTION_INVALID');
    });

    it('lists the queue with full content and applies bulk actions', async () => {
      const a = await makeQuestion('AI_REVIEWED', 'AI_GENERATED');
      const b = await makeQuestion('AI_REVIEWED', 'AI_GENERATED');
      const queue = await http().get('/admin/review?entity=question&limit=200').set('Cookie', cookies.editor).expect(200);
      const item = queue.body.items.find((i: { id: string }) => i.id === a);
      expect(item).toEqual(expect.objectContaining({
        status: 'AI_REVIEWED', correct: ['a'], explanation: 'Parce que.', topic: expect.objectContaining({ key: TOPIC }), ai: { model: 'test-model', promptVersion: null },
      }));
      expect(item.options).toHaveLength(2);

      const bulk = await http().post('/admin/review/questions/bulk').set('Cookie', cookies.editor)
        .send({ ids: [a, b, '00000000-0000-4000-8000-000000000000'], action: 'approve' }).expect(200);
      expect(bulk.body.ok.map((o: { id: string }) => o.id).sort()).toEqual([a, b].sort());
      expect(bulk.body.failed).toEqual([{ id: '00000000-0000-4000-8000-000000000000', error: 'NOT_FOUND' }]);
      await http().post('/admin/review/widget/whatever').set('Cookie', cookies.editor).send({ action: 'approve' }).expect(404);
    });
  });

  // ───────────── Question bank editing ─────────────

  describe('questions CRUD', () => {
    const base = () => ({
      type: 'MCQ_SINGLE', domain: 'FRENCH', language: 'fr', stem: `Quel est le pluriel de « cheval » ? ${run}`,
      options: [{ id: 'a', text: 'chevals' }, { id: 'b', text: 'chevaux' }], correct: ['b'], explanation: 'Les noms en -al font -aux au pluriel.',
      difficulty: 'EASY', topicKey: TOPIC, objectiveKeys: [OBJECTIVE],
    });

    it('validates, creates as HUMAN_REVIEWED, bumps versions on edit and republishes on demand', async () => {
      const bad = await http().post('/admin/questions').set('Cookie', cookies.editor).send({ ...base(), correct: ['c'] }).expect(422);
      expect(bad.body.message).toBe('QUESTION_INVALID');
      await http().post('/admin/questions').set('Cookie', cookies.editor).send({ ...base(), objectiveKeys: ['nope.o1'] }).expect(400);

      const created = await http().post('/admin/questions').set('Cookie', cookies.editor).send(base()).expect(201);
      expect(created.body).toEqual(expect.objectContaining({ status: 'HUMAN_REVIEWED', version: 1, origin: 'AUTHORED' }));
      expect(created.body.reviewedBy.id).toBe(ids.editor);
      const id = created.body.id as string;

      const dupe = await http().post('/admin/questions').set('Cookie', cookies.editor).send(base()).expect(409);
      expect(dupe.body.message).toBe('DUPLICATE_QUESTION');

      const published = await http().patch(`/admin/questions/${id}?publish=true`).set('Cookie', cookies.admin).send({}).expect(200);
      expect(published.body).toEqual(expect.objectContaining({ status: 'PUBLISHED', version: 1, changed: false }));

      const edited = await http().patch(`/admin/questions/${id}`).set('Cookie', cookies.editor).send({ explanation: 'Cheval → chevaux (pluriel en -aux).' }).expect(200);
      expect(edited.body).toEqual(expect.objectContaining({ status: 'HUMAN_REVIEWED', version: 2, changed: true }));
      const hops = await db.select().from(contentReviews).where(and(eq(contentReviews.entityType, 'question'), eq(contentReviews.entityId, id)));
      expect(hops.map((h) => `${h.fromStatus}>${h.toStatus}`)).toEqual(expect.arrayContaining(['PUBLISHED>DRAFT', 'DRAFT>HUMAN_REVIEWED']));

      const list = await http().get(`/admin/questions?topicKey=${TOPIC}&status=HUMAN_REVIEWED`).set('Cookie', cookies.editor).expect(200);
      const row = list.body.items.find((i: { id: string }) => i.id === id);
      expect(row.stats).toEqual({ attempts: 0, correct: 0, accuracy: null, openReports: 0 });
      expect(list.body.counts.HUMAN_REVIEWED).toBeGreaterThanOrEqual(1);

      const detail = await http().get(`/admin/questions/${id}`).set('Cookie', cookies.editor).expect(200);
      expect(detail.body.objectives.map((o: { key: string }) => o.key)).toEqual([OBJECTIVE]);
      expect(detail.body.history.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ───────────── Catalog: families, editions & alerts ─────────────

  describe('editions and alerts', () => {
    let editionId = '';

    it('creates a family and a position', async () => {
      await http().post(`/admin/families/${FAMILY}`).set('Cookie', cookies.editor).send({
        field: 'ADMINISTRATION', organization: { slug: ORG, name_ar: 'هيكل اختبار', name_fr: 'Organisme test' },
        name_ar: 'مناظرة اختبار', name_fr: 'Concours test', status: 'PUBLISHED',
      }).expect(201);
      const pos = await http().post(`/admin/families/${FAMILY}/positions/agent`).set('Cookie', cookies.editor).send({
        title_ar: 'عون إداري', title_fr: 'Agent administratif', diplomaLevel: 'BAC', eligibility: { min_age: 18, max_age: 35, specialties: [] },
      }).expect(201);
      expect(pos.body.eligibility).toEqual({ min_age: 18, max_age: 35 });
      expect(pos.body.eligibilityProvenance.needsVerification).toBe(true);
      const list = await http().get('/admin/families').set('Cookie', cookies.editor).expect(200);
      expect(list.body.find((f: { slug: string }) => f.slug === FAMILY).counts.positions).toBe(1);
    });

    it('an edition created OPEN runs AlertsService.matchCompetition and returns its counts', async () => {
      const res = await http().post('/admin/editions').set('Cookie', cookies.editor).send({
        familySlug: FAMILY, year: 2026, sessionLabel: `Session ${run}`, status: 'OPEN',
        registrationOpen: day(-1), registrationDeadline: day(20), examDate: day(40), positionSlugs: ['agent'],
      }).expect(201);
      editionId = res.body.id;
      expect(alerts.matchCompetition).toHaveBeenCalledWith(editionId);
      expect(res.body.notifications.alerts).toEqual({ matchedUsers: 3, notified: 2 });
      expect(res.body.contentStatus).toBe('PUBLISHED');
      expect(res.body.needsVerification).toBe(true);
    });

    it('a status change to ANNOUNCED triggers matching; EXPECTED does not', async () => {
      const created = await http().post('/admin/editions').set('Cookie', cookies.editor).send({
        familySlug: FAMILY, year: 2027, status: 'EXPECTED', registrationDeadline: day(60),
      }).expect(201);
      expect(alerts.matchCompetition).not.toHaveBeenCalled();
      const patched = await http().patch(`/admin/editions/${created.body.id}`).set('Cookie', cookies.editor).send({ status: 'ANNOUNCED' }).expect(200);
      expect(alerts.matchCompetition).toHaveBeenCalledWith(created.body.id);
      expect(patched.body.notifications.alerts).toEqual({ matchedUsers: 3, notified: 2 });
      const reviews = await db.select().from(contentReviews).where(and(eq(contentReviews.entityType, 'edition'), eq(contentReviews.entityId, created.body.id)));
      expect(reviews.some((r) => r.fromStatus === 'EXPECTED' && r.toStatus === 'ANNOUNCED')).toBe(true);
    });

    it('POST /admin/editions/:id/notify returns the matching counts', async () => {
      const res = await http().post(`/admin/editions/${editionId}/notify`).set('Cookie', cookies.editor).expect(200);
      expect(res.body).toEqual({ matchedUsers: 3, notified: 2 });
      expect(alerts.matchCompetition).toHaveBeenCalledWith(editionId);
    });

    it('moving the deadline of an announced edition notifies followers with the new date', async () => {
      await db.update(competitions).set({ alertsSentAt: new Date() }).where(eq(competitions.id, editionId));
      const newDeadline = day(25);
      const res = await http().patch(`/admin/editions/${editionId}`).set('Cookie', cookies.editor).send({ registrationDeadline: newDeadline }).expect(200);
      expect(alerts.notifyCompetitionUpdate).toHaveBeenCalledTimes(1);
      const [calledId, summary] = alerts.notifyCompetitionUpdate.mock.calls[0] as unknown as [string, { ar: string; fr: string }];
      expect(calledId).toBe(editionId);
      const [y, m, d] = newDeadline.split('-');
      expect(summary.fr).toContain(`${d}/${m}/${y}`);
      expect(res.body.notifications.updateNotified).toBe(5);

      await http().patch(`/admin/editions/${editionId}?notify=false`).set('Cookie', cookies.editor).send({ examDate: day(45) }).expect(200);
      expect(alerts.notifyCompetitionUpdate).toHaveBeenCalledTimes(1);
    });

    it('rejects incoherent dates and unknown positions', async () => {
      const r1 = await http().post('/admin/editions').set('Cookie', cookies.editor).send({ familySlug: FAMILY, year: 2028, status: 'ANNOUNCED', registrationOpen: day(10), registrationDeadline: day(5) }).expect(400);
      expect(r1.body.message).toBe('DATES_ORDER');
      const r2 = await http().post('/admin/editions').set('Cookie', cookies.editor).send({ familySlug: FAMILY, year: 2028, status: 'ANNOUNCED', positionSlugs: ['ghost'] }).expect(400);
      expect(r2.body.message).toBe('UNKNOWN_POSITION');
    });

    it('verifies a fact only against a source', async () => {
      const [fam] = await db.select().from(competitionFamilies).where(eq(competitionFamilies.slug, FAMILY));
      const [fact] = await db.insert(competitionFacts).values({ familyId: fam.id, key: 'REQUIRED_DOCUMENT', displayAr: 'نسخة من بطاقة التعريف', displayFr: 'Copie de la CIN' }).returning();

      const list = await http().get(`/admin/facts?familySlug=${FAMILY}`).set('Cookie', cookies.editor).expect(200);
      expect(list.body.items.some((i: { kind: string; id: string }) => i.kind === 'fact' && i.id === fact.id)).toBe(true);
      expect(list.body.counts.eligibility).toBe(1);

      const noSource = await http().patch(`/admin/facts/fact/${fact.id}`).set('Cookie', cookies.editor).send({ needsVerification: false }).expect(400);
      expect(noSource.body.message).toBe('SOURCE_REQUIRED');

      const src = await http().post('/admin/sources').set('Cookie', cookies.editor)
        .send({ title: `Source ${run} JORT`, url: `https://example.org/${run}`, sourceType: 'OFFICIAL', confidence: 'HIGH' }).expect(201);
      createdSources.push(src.body.id);
      const dupe = await http().post('/admin/sources').set('Cookie', cookies.editor)
        .send({ title: `Source ${run} copy`, url: `https://example.org/${run}`, sourceType: 'OFFICIAL', confidence: 'HIGH' }).expect(409);
      expect(dupe.body.message).toBe('SOURCE_EXISTS');

      const ok = await http().patch(`/admin/facts/fact/${fact.id}`).set('Cookie', cookies.editor)
        .send({ needsVerification: false, sourceId: src.body.id, sourceQuote: 'نسخة من بطاقة التعريف الوطنية', confidence: 'HIGH' }).expect(200);
      expect(ok.body).toEqual(expect.objectContaining({ needsVerification: false, confidence: 'HIGH', sourceQuote: 'نسخة من بطاقة التعريف الوطنية' }));
      expect(ok.body.lastVerifiedAt).not.toBeNull();
      const [s] = await db.select().from(sources).where(eq(sources.id, src.body.id));
      expect(s.lastVerifiedAt).toBeInstanceOf(Date);
    });

    it('validates blueprint sections', async () => {
      const bad = await http().post('/admin/blueprints').set('Cookie', cookies.editor).send({
        familySlug: FAMILY, positionSlug: 'agent', title: 'Écrit', totalMinutes: 60, fidelity: 'APPROXIMATED',
        sections: [{ domain: 'FRENCH', count: 20, minutes: 40 }, { domain: 'LOGIC', count: 10, minutes: 30 }],
      }).expect(400);
      expect(bad.body.message).toBe('INVALID_BLUEPRINT');
      const ok = await http().post('/admin/blueprints').set('Cookie', cookies.editor).send({
        familySlug: FAMILY, positionSlug: 'agent', title: 'Écrit', totalMinutes: 90, fidelity: 'APPROXIMATED',
        sections: [{ domain: 'FRENCH', count: 20, minutes: 40 }, { domain: 'LOGIC', count: 10, minutes: 30 }],
      }).expect(201);
      expect(ok.body.questionCount).toBe(30);
      await http().post('/admin/blueprints').set('Cookie', cookies.editor).send({
        familySlug: FAMILY, positionSlug: 'agent', title: 'Écrit v2', totalMinutes: 90, fidelity: 'APPROXIMATED', sections: [{ domain: 'FRENCH', count: 10, minutes: 20 }],
      }).expect(409);
    });
  });

  // ───────────── Payments, users, broadcast ─────────────

  describe('operations', () => {
    async function makePayment(provider: 'MANUAL' | 'MOCK', status: 'PENDING' | 'PAID' = 'PENDING') {
      const [plan] = await db.select().from(plans).where(eq(plans.code, 'PREMIUM_MONTH'));
      const [p] = await db.insert(payments).values({ userId: ids.user, planId: plan.id, amountMillimes: plan.priceMillimes, provider, status, manualReference: provider === 'MANUAL' ? `D17-${run}` : null }).returning();
      return p.id;
    }

    it('manual payment approval calls PaymentsService.markPaid with the admin as actor', async () => {
      const id = await makePayment('MANUAL');
      await http().post(`/admin/payments/${id}/approve`).set('Cookie', cookies.editor).expect(403);
      const res = await http().post(`/admin/payments/${id}/approve`).set('Cookie', cookies.admin).expect(200);
      expect(paymentsMock.markPaid).toHaveBeenCalledWith(id, { actorId: ids.admin });
      expect(res.body).toEqual(expect.objectContaining({ id, provider: 'MANUAL', manualReference: `D17-${run}` }));

      const mock = await makePayment('MOCK');
      const notManual = await http().post(`/admin/payments/${mock}/approve`).set('Cookie', cookies.admin).expect(400);
      expect(notManual.body.message).toBe('NOT_MANUAL');

      const toReject = await makePayment('MANUAL');
      await http().post(`/admin/payments/${toReject}/reject`).set('Cookie', cookies.admin).send({ reason: 'Référence introuvable' }).expect(200);
      expect(paymentsMock.markFailed).toHaveBeenCalledWith(toReject, 'Référence introuvable');

      const list = await http().get('/admin/payments?provider=MANUAL&status=PENDING').set('Cookie', cookies.admin).expect(200);
      expect(list.body.items.some((p: { id: string }) => p.id === id || p.id === toReject)).toBe(true);
      expect(list.body.items[0].user.email).toContain('@test.local');
    });

    it('grants premium days and protects role changes', async () => {
      const self = await http().patch(`/admin/users/${ids.admin}`).set('Cookie', cookies.admin).send({ role: 'USER' }).expect(400);
      expect(self.body.message).toBe('CANNOT_CHANGE_OWN_ROLE');
      const res = await http().patch(`/admin/users/${ids.user}`).set('Cookie', cookies.admin).send({ grantDays: 14 }).expect(200);
      expect(entitlementsMock.grantDays).toHaveBeenCalledWith(ids.user, 14, 'ADMIN_GRANT', 'PREMIUM_MONTH');
      expect(res.body.granted.days).toBe(14);
      expect(notificationsMock.notify).toHaveBeenCalledWith(ids.user, expect.objectContaining({ type: 'SUBSCRIPTION' }));

      await http().patch(`/admin/users/${ids.editor}`).set('Cookie', cookies.admin).send({ role: 'USER' }).expect(200);
      await http().get('/admin/stats').set('Cookie', cookies.editor).expect(403);
      await http().patch(`/admin/users/${ids.editor}`).set('Cookie', cookies.admin).send({ role: 'EDITOR' }).expect(200);
      await http().get('/admin/stats').set('Cookie', cookies.editor).expect(200);
    });

    it('broadcasts a SYSTEM notification to a family segment (dry run first)', async () => {
      const [fam] = await db.select().from(competitionFamilies).where(eq(competitionFamilies.slug, FAMILY));
      await db.insert(follows).values({ userId: ids.user, familyId: fam.id }).onConflictDoNothing();
      const body = { title: 'Nouvelle session', body: 'Les inscriptions sont ouvertes.', url: `/concours/${FAMILY}`, segment: { familySlug: FAMILY } };

      const dry = await http().post('/admin/notifications/broadcast?dryRun=true').set('Cookie', cookies.admin).send(body).expect(200);
      expect(dry.body).toEqual(expect.objectContaining({ audience: 1, sent: 0, dryRun: true }));
      expect(notificationsMock.notifyMany).not.toHaveBeenCalled();

      const res = await http().post('/admin/notifications/broadcast').set('Cookie', cookies.admin).send(body).expect(200);
      expect(res.body.sent).toBe(1);
      expect(notificationsMock.notifyMany).toHaveBeenCalledWith([ids.user], expect.objectContaining({ type: 'SYSTEM', title: 'Nouvelle session', dedupeKey: expect.stringMatching(/^broadcast:/) }));

      await http().post('/admin/notifications/broadcast').set('Cookie', cookies.admin).send({ ...body, url: 'javascript:alert(1)' }).expect(400);
    });

    it('lists the audit trail, hiding money/accounts from editors', async () => {
      const asAdmin = await http().get('/admin/audit?limit=200').set('Cookie', cookies.admin).expect(200);
      expect(asAdmin.body.items.some((i: { entityType: string }) => i.entityType === 'payment')).toBe(true);
      const asEditor = await http().get('/admin/audit?limit=200').set('Cookie', cookies.editor).expect(200);
      expect(asEditor.body.items.every((i: { entityType: string }) => !['payment', 'user', 'notification'].includes(i.entityType))).toBe(true);
      const waitlist = await http().get('/admin/waitlist').set('Cookie', cookies.admin).expect(200);
      expect(waitlist.body.counts).toEqual(expect.objectContaining({ total: expect.any(Number), byWillingness: expect.any(Object) }));
      await http().get('/admin/waitlist').set('Cookie', cookies.editor).expect(403);
    });
  });
});

// ───────────── Pure rules ─────────────

describe('admin workflow rules', () => {
  it('follows CONTENT_TRANSITIONS', () => {
    expect(() => planTransition('question', 'DRAFT', 'publish', {})).toThrow();
    expect(planTransition('question', 'AI_REVIEWED', 'publish', {}).path).toEqual(['HUMAN_REVIEWED', 'PUBLISHED']);
    expect(planTransition('question', 'HUMAN_REVIEWED', 'reject', { comment: 'x' }).path).toEqual(['DRAFT']);
    expect(planTransition('lesson', 'AI_REVIEWED', 'reject', { comment: 'x', aiGenerated: true }).path).toEqual(['ARCHIVED']);
    expect(planTransition('fact', 'PUBLISHED', 'approve', {})).toEqual({ path: [], needsVerification: false, setsReviewer: true });
    expect(planTransition('edition', 'DRAFT', 'publish', {}).path).toEqual(['HUMAN_REVIEWED', 'PUBLISHED']);
    expect(() => planTransition('edition', 'ARCHIVED', 'approve', {})).toThrow();
  });

  it('checks answer keys against options', () => {
    const opts = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
    expect(validateQuestionContent('MCQ_SINGLE', opts, ['a']).issues).toEqual([]);
    expect(validateQuestionContent('MCQ_SINGLE', opts, ['a', 'b']).issues.length).toBeGreaterThan(0);
    expect(validateQuestionContent('NUMERIC', [], { value: 4, tolerance: 0 }).issues).toEqual([]);
    expect(validateQuestionContent('ORDERING', opts, { order: ['b', 'a'] }).issues).toEqual([]);
    expect(validateQuestionContent('ORDERING', opts, { order: ['b'] }).issues.length).toBeGreaterThan(0);
    const matching = [{ id: 'l1', text: '1', side: 'left' as const }, { id: 'l2', text: '2', side: 'left' as const }, { id: 'r1', text: 'x', side: 'right' as const }, { id: 'r2', text: 'y', side: 'right' as const }];
    expect(validateQuestionContent('MATCHING', matching, { pairs: [['l1', 'r2'], ['l2', 'r1']] }).issues).toEqual([]);
  });

  it('summarises edition changes in both languages', () => {
    const base: EditionSnapshot = {
      id: 'x', familyId: 'f', status: 'ANNOUNCED', contentStatus: 'PUBLISHED', needsVerification: true, registrationOpen: null,
      registrationDeadline: '2026-11-01', examDate: null, positionsCount: null, positionSlugs: [], alertsSentAt: new Date(),
    };
    expect(updateSummary(base, base)).toBeNull();
    const s = updateSummary(base, { ...base, status: 'OPEN', registrationDeadline: '2026-11-15', needsVerification: false });
    expect(s?.fr).toContain('15/11/2026');
    expect(s?.ar).toContain('التسجيل مفتوح');
    expect(s?.fr).toContain('source officielle');
  });
});

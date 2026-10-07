import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { READINESS_LABELS, nextReviewDays, type ReadinessDTO, type TodayPlanDTO } from '@ctn/shared';
import { CommonModule } from '../../common/common.module';
import { addDays, tunisToday } from '../../common/dates';
import { SESSION_COOKIE, signSession } from '../../common/session';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import {
  attemptAnswers, attempts, blueprints, competitionFamilies, competitions, enrollments, familySyllabus, lessons, mastery, organizations,
  positions, questions, readinessSnapshots, studyPlanDays, syllabusNodes, userQuestionState, userStats, users, weaknessEvents,
} from '../../db/schema';
import { GamificationService } from '../gamification/gamification.service';
import { planWeights, sectionSizes, type FamilyTopic } from './curriculum.service';
import { LearningModule } from './learning.module';
import { MasteryService } from './mastery.service';
import { asIndexList, dayOfWeek, detectDone, type PlanItemDTO } from './plan.service';
import { lastDays } from './progress.service';
import { humanizeReason } from './readiness.service';

const gamificationMock = { awardXp: jest.fn(async () => 100) };

@Global()
@Module({ providers: [{ provide: GamificationService, useValue: gamificationMock }], exports: [GamificationService] })
class GlobalMocksModule {}

const run = randomBytes(4).toString('hex');
const MINUTE = 60_000;
const DAY = 86_400_000;

describe('learning helpers (pure)', () => {
  const topic = (id: string, domain: FamilyTopic['domain']): FamilyTopic => ({ id, key: id, domain, titleAr: id, titleFr: id });

  it('sums blueprint sections per domain (minutes when counts are missing)', () => {
    expect(sectionSizes([{ domain: 'FRENCH', count: 10 }, { domain: 'FRENCH', count: 5 }, { domain: 'NOPE', count: 3 }, { domain: 'LOGIC', count: 0 }]))
      .toEqual(new Map([['FRENCH', 15]]));
    expect(sectionSizes([{ domain: 'ARABIC', minutes: 30 }, { domain: 'LOGIC', minutes: 15 }])).toEqual(new Map([['ARABIC', 30], ['LOGIC', 15]]));
    expect(sectionSizes(null)).toEqual(new Map());
  });

  it('weights domains by blueprint, reports exam domains without content, and falls back to equal weights', () => {
    const topics = [topic('a', 'FRENCH'), topic('b', 'FRENCH'), topic('c', 'LOGIC'), topic('d', 'ENGLISH')];
    const withBp = planWeights({ domainSizes: new Map([['FRENCH', 20], ['LOGIC', 10], ['SPECIALTY', 10]]), fidelity: 'OFFICIAL_FORMAT', blueprintId: 'x' }, topics);
    expect(withBp.weights).toEqual([{ domain: 'FRENCH', weight: 20, topicCount: 2 }, { domain: 'LOGIC', weight: 10, topicCount: 1 }]);
    expect(withBp.uncovered).toEqual([{ domain: 'SPECIALTY', share: 0.25 }]);
    expect(withBp.formatOfficial).toBe(true);
    const equal = planWeights({ domainSizes: new Map(), fidelity: null, blueprintId: null }, topics);
    expect(equal.weights.map((w) => [w.domain, w.weight, w.topicCount])).toEqual([['FRENCH', 1, 2], ['ENGLISH', 1, 1], ['LOGIC', 1, 1]]);
    expect(equal.formatOfficial).toBe(false);
  });

  it('detects plan items completed by today\'s activity', () => {
    const items = [
      { kind: 'MISTAKES' as const, questions: 3 },
      { kind: 'REVIEW' as const, questions: 5 },
      { kind: 'LESSON' as const, topicId: 't1' },
      { kind: 'PRACTICE' as const, topicId: 't1', questions: 10 },
      { kind: 'PRACTICE' as const, topicId: 't2', questions: 5 },
      { kind: 'MOCK' as const },
    ];
    expect(detectDone(items, { byTopic: new Map([['t1', 10], ['t2', 4]]), reviewAnswers: 4, mockSubmitted: true })).toEqual(new Set([0, 3, 5]));
    expect(detectDone(items, { byTopic: new Map(), reviewAnswers: 8, mockSubmitted: false })).toEqual(new Set([0, 1]));
  });

  it('humanizes domain codes in readiness reasons, parses stored indices and builds date series', () => {
    expect(humanizeReason({ ar: 'أضعف مادة: NUMERICAL (20%)', fr: 'Matière la plus faible : CULTURE_GENERALE (20 %)' }))
      .toEqual({ ar: 'أضعف مادة: الحساب (20%)', fr: 'Matière la plus faible : Culture générale (20 %)' });
    expect(asIndexList([3, 1, 1, -1, 'x', 2.5])).toEqual([1, 3]);
    expect(asIndexList(null)).toEqual([]);
    expect(dayOfWeek('2026-10-07')).toBe(3);
    const days = lastDays('2026-10-07');
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-09-08');
    expect(days[29]).toBe('2026-10-07');
  });
});

describe('learning API (real DB)', () => {
  let app: INestApplication;
  let db: Database;
  let masterySvc: MasteryService;
  const famSlug = `learn-fam-${run}`;
  const fx = {
    org: '', fam: '', position: '', enrollment: '', frSubject: '', numSubject: '', gram: '', conj: '', pct: '',
    questions: { gram: [] as string[], conj: [] as string[], pct: [] as string[] },
    user1: '', user2: '',
  };
  const nodeIds: string[] = [];
  let cookie1 = '';
  let cookie2 = '';
  const today = tunisToday();
  const examDate = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * DAY).toISOString().slice(0, 10);

  const newUser = async (locale: 'ar' | 'fr') => {
    const [u] = await db
      .insert(users)
      .values({ email: `learn-${randomBytes(5).toString('hex')}-${run}@test.concours.tn`, isGuest: false, locale, referralCode: `L${randomBytes(6).toString('hex').toUpperCase()}` })
      .returning({ id: users.id });
    return { id: u.id, cookie: `${SESSION_COOKIE}=${signSession({ id: u.id, role: 'USER', isGuest: false })}` };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DbModule, CommonModule, GlobalMocksModule, LearningModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get<Database>(DB);
    masterySvc = app.get(MasteryService);

    const [org] = await db.insert(organizations).values({ slug: `learn-org-${run}`, nameAr: 'منظمة', nameFr: 'Org' }).returning();
    const [fam] = await db.insert(competitionFamilies).values({ slug: famSlug, organizationId: org.id, field: 'SECURITY', nameAr: 'مناظرة', nameFr: 'Concours' }).returning();
    const [pos] = await db.insert(positions).values({ familyId: fam.id, slug: 'agent', titleAr: 'عون', titleFr: 'Agent', orderIndex: 1 }).returning();
    await db.insert(blueprints).values({
      positionId: pos.id, title: 'Écrit', totalMinutes: 60, fidelity: 'APPROXIMATED',
      sections: [
        { domain: 'FRENCH', specialtyKey: null, count: 20, minutes: 30 },
        { domain: 'NUMERICAL', specialtyKey: null, count: 10, minutes: 20 },
        { domain: 'SPECIALTY', specialtyKey: 'x', count: 10, minutes: 10 },
      ],
    });
    await db.insert(competitions).values({ familyId: fam.id, year: 2026, status: 'ANNOUNCED', examDate, needsVerification: true });

    const node = async (key: string, level: 'SUBJECT' | 'TOPIC', domain: 'FRENCH' | 'NUMERICAL', titleFr: string, parentId: string | null) => {
      const [n] = await db.insert(syllabusNodes).values({ key, parentId, level, domain, titleAr: `${titleFr} (ar)`, titleFr, scope: 'GENERAL_SKILL' }).returning({ id: syllabusNodes.id });
      nodeIds.push(n.id);
      return n.id;
    };
    fx.frSubject = await node(`lt${run}.fr`, 'SUBJECT', 'FRENCH', 'Français', null);
    fx.gram = await node(`lt${run}.fr.gram`, 'TOPIC', 'FRENCH', 'Grammaire', fx.frSubject);
    fx.conj = await node(`lt${run}.fr.conj`, 'TOPIC', 'FRENCH', 'Conjugaison', fx.frSubject);
    fx.numSubject = await node(`lt${run}.num`, 'SUBJECT', 'NUMERICAL', 'Calcul', null);
    fx.pct = await node(`lt${run}.num.pct`, 'TOPIC', 'NUMERICAL', 'Pourcentages', fx.numSubject);
    await db.insert(familySyllabus).values([{ familyId: fam.id, nodeId: fx.frSubject }, { familyId: fam.id, nodeId: fx.numSubject }]);
    await db.insert(lessons).values({ nodeId: fx.gram, language: 'fr', title: 'Les accords', bodyMd: '## Accords', status: 'PUBLISHED' });

    for (const [k, topicId] of [['gram', fx.gram], ['conj', fx.conj], ['pct', fx.pct]] as const) {
      const rows = await db
        .insert(questions)
        .values(Array.from({ length: 6 }, (_, i) => ({
          type: 'MCQ_SINGLE' as const, domain: topicId === fx.pct ? ('NUMERICAL' as const) : ('FRENCH' as const), language: 'fr', stem: `${k} ${i} ${run}`,
          options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct: ['a'], explanation: 'Parce que A.', difficulty: 'MEDIUM' as const,
          rating: 1000, topicId, origin: 'AUTHORED' as const, status: 'PUBLISHED' as const,
        })))
        .returning({ id: questions.id });
      fx.questions[k] = rows.map((r) => r.id);
    }

    const u1 = await newUser('fr');
    const u2 = await newUser('ar');
    Object.assign(fx, { org: org.id, fam: fam.id, position: pos.id, user1: u1.id, user2: u2.id });
    cookie1 = u1.cookie;
    cookie2 = u2.cookie;
    const [enr] = await db.insert(enrollments).values({ userId: u1.id, familyId: fam.id, positionId: pos.id, dailyMinutes: 120, isPrimary: true }).returning();
    fx.enrollment = enr.id;
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    if (db) {
      const userIds = [fx.user1, fx.user2].filter(Boolean);
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
      const qIds = [...fx.questions.gram, ...fx.questions.conj, ...fx.questions.pct];
      if (qIds.length) await db.delete(questions).where(inArray(questions.id, qIds));
      if (nodeIds.length) await db.delete(syllabusNodes).where(inArray(syllabusNodes.id, nodeIds));
      if (fx.fam) await db.delete(competitionFamilies).where(eq(competitionFamilies.id, fx.fam));
      if (fx.org) await db.delete(organizations).where(eq(organizations.id, fx.org));
    }
    await app?.close();
  });

  const near = (d: Date | null, expected: number) => {
    expect(d).not.toBeNull();
    expect(Math.abs(d!.getTime() - expected)).toBeLessThan(2 * MINUTE);
  };

  it('requires a session', async () => {
    const r = await request(app.getHttpServer()).get('/me/progress').expect(401);
    expect(r.body.message).toBe('SESSION_REQUIRED');
  });

  it('recordAnswer moves ratings (topic, parent at half K, question) and schedules reviews', async () => {
    const qid = fx.questions.gram[0];
    const ref = { questionId: qid, topicId: fx.gram, rating: 1000 };

    const wrong = await masterySvc.recordAnswer(fx.user1, ref, false, 4000);
    expect(wrong.masteryBefore).toBeCloseTo(0.35, 5);
    const [topicAfterWrong] = await db.select().from(mastery).where(and(eq(mastery.userId, fx.user1), eq(mastery.nodeId, fx.gram)));
    const [parentAfterWrong] = await db.select().from(mastery).where(and(eq(mastery.userId, fx.user1), eq(mastery.nodeId, fx.frSubject)));
    expect(topicAfterWrong).toMatchObject({ attempts: 1, correct: 0, streakCorrect: 0 });
    expect(topicAfterWrong.rating).toBeLessThan(950);
    // Parent moves in the same direction by half as much.
    expect(950 - parentAfterWrong.rating).toBeCloseTo((950 - topicAfterWrong.rating) / 2, 2);
    expect(parentAfterWrong.attempts).toBe(1);
    near(topicAfterWrong.nextReviewAt, Date.now() + DAY);

    const [q1] = await db.select().from(questions).where(eq(questions.id, qid));
    expect(q1.rating).toBeGreaterThan(1000);
    expect(q1).toMatchObject({ attemptsCount: 1, correctCount: 0 });
    const [s1] = await db.select().from(userQuestionState).where(and(eq(userQuestionState.userId, fx.user1), eq(userQuestionState.questionId, qid)));
    expect(s1).toMatchObject({ timesSeen: 1, timesWrong: 1, lastCorrect: false });
    near(s1.nextReviewAt, Date.now() + DAY);
    expect(await db.select().from(weaknessEvents).where(and(eq(weaknessEvents.userId, fx.user1), eq(weaknessEvents.questionId, qid)))).toHaveLength(1);

    const fixed = await masterySvc.recordAnswer(fx.user1, ref, true);
    expect(fixed.masteryBefore).toBeCloseTo(wrong.masteryAfter, 5);
    expect(fixed.masteryAfter).toBeGreaterThan(fixed.masteryBefore);
    const [s2] = await db.select().from(userQuestionState).where(and(eq(userQuestionState.userId, fx.user1), eq(userQuestionState.questionId, qid)));
    expect(s2).toMatchObject({ timesSeen: 2, timesWrong: 1, lastCorrect: true });
    near(s2.nextReviewAt, Date.now() + 3 * DAY);
    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, fx.user1));
    expect(stats.mistakesFixed).toBe(1);

    const again = await masterySvc.recordAnswer(fx.user1, ref, true);
    const [s3] = await db.select().from(userQuestionState).where(and(eq(userQuestionState.userId, fx.user1), eq(userQuestionState.questionId, qid)));
    near(s3.nextReviewAt, Date.now() + nextReviewDays(again.masteryAfter, true, 2) * DAY);
    const [topicNow] = await db.select().from(mastery).where(and(eq(mastery.userId, fx.user1), eq(mastery.nodeId, fx.gram)));
    expect(topicNow).toMatchObject({ attempts: 3, correct: 2, streakCorrect: 2 });
    expect(topicNow.rating).toBeGreaterThan(topicAfterWrong.rating);
    expect((await db.select().from(userStats).where(eq(userStats.userId, fx.user1)))[0].mistakesFixed).toBe(1);
    const [q3] = await db.select().from(questions).where(eq(questions.id, qid));
    expect(q3).toMatchObject({ attemptsCount: 3, correctCount: 2 });
    expect(await db.select().from(weaknessEvents).where(eq(weaknessEvents.userId, fx.user1))).toHaveLength(1);

    await expect(masterySvc.recordAnswer(fx.user1, { ...ref, topicId: '00000000-0000-4000-8000-000000000000' }, true)).rejects.toThrow();
  });

  it('generates today\'s plan once, with bilingual items, and awards the daily goal once when everything is done', async () => {
    // A pending mistake on another topic feeds the MISTAKES item.
    await masterySvc.recordAnswer(fx.user1, { questionId: fx.questions.pct[0], topicId: fx.pct, rating: 1000 }, false);

    const r1 = await request(app.getHttpServer()).get('/me/plan/today').set('Cookie', cookie1).expect(200);
    const plan: Omit<TodayPlanDTO, 'items'> & { items: PlanItemDTO[] } = r1.body;
    expect(plan).toMatchObject({ date: today, enrollmentId: fx.enrollment, familySlug: famSlug, daysToExam: 60 });
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.items.every((i) => i.done === false && !('familyId' in i))).toBe(true);
    const practice = plan.items.filter((i) => i.kind === 'PRACTICE');
    expect(practice.length).toBeGreaterThan(0);
    for (const p of practice) {
      expect([fx.gram, fx.conj, fx.pct]).toContain(p.topicId);
      expect(p.topicKey).toMatch(new RegExp(`^lt${run}\\.`));
      expect(p.title).toBe(p.title_fr); // user locale is fr
      expect(p.questions).toBeGreaterThan(0);
    }
    const mistakes = plan.items.find((i) => i.kind === 'MISTAKES');
    expect(mistakes).toMatchObject({ title: 'Revoir mes erreurs', title_ar: 'مراجعة أخطائي' });
    expect(mistakes!.questions).toBeGreaterThanOrEqual(1);
    // LESSON items only for topics that have a lesson.
    for (const l of plan.items.filter((i) => i.kind === 'LESSON')) expect(l.topicId).toBe(fx.gram);

    const stored = await db.select().from(studyPlanDays).where(and(eq(studyPlanDays.userId, fx.user1), eq(studyPlanDays.date, today)));
    expect(stored).toHaveLength(1);
    expect(stored[0].enrollmentId).toBe(fx.enrollment);
    expect(stored[0].items as unknown[]).toHaveLength(plan.items.length);

    const r2 = await request(app.getHttpServer()).get('/me/plan/today').set('Cookie', cookie1).expect(200);
    expect(r2.body).toEqual(plan);

    await request(app.getHttpServer()).post('/me/plan/today/abc/done').set('Cookie', cookie1).expect(400);
    await request(app.getHttpServer()).post('/me/plan/today/999/done').set('Cookie', cookie1).expect(400);
    await request(app.getHttpServer()).post(`/me/plan/today/${plan.items.length}/done`).set('Cookie', cookie1).expect(404);

    let last: TodayPlanDTO | null = null;
    for (let i = 0; i < plan.items.length; i++) {
      const r = await request(app.getHttpServer()).post(`/me/plan/today/${i}/done`).set('Cookie', cookie1).expect(200);
      last = r.body;
      expect(last!.items[i].done).toBe(true);
      expect(gamificationMock.awardXp).toHaveBeenCalledTimes(i === plan.items.length - 1 ? 1 : 0);
    }
    expect(last!.items.every((i) => i.done)).toBe(true);
    expect(gamificationMock.awardXp).toHaveBeenCalledWith(fx.user1, 20, 'DAILY_GOAL', fx.fam);
    await request(app.getHttpServer()).post('/me/plan/today/0/done').set('Cookie', cookie1).expect(200);
    expect(gamificationMock.awardXp).toHaveBeenCalledTimes(1);

    // Progress is never thrown away by asking for the plan of another family.
    await request(app.getHttpServer()).get(`/me/plan/today?familySlug=nope-${run}`).set('Cookie', cookie1).expect(404);
  });

  it('computes readiness with blueprint weights, readable reasons and a daily snapshot', async () => {
    const r = await request(app.getHttpServer()).get(`/me/readiness/${famSlug}`).set('Cookie', cookie1).expect(200);
    const body: ReadinessDTO & { topicTitles: Record<string, { ar: string; fr: string; key: string }> } = r.body;
    expect(body.familySlug).toBe(famSlug);
    for (const k of ['overall', 'preparation', 'coverage'] as const) {
      expect(body[k]).toBeGreaterThanOrEqual(0);
      expect(body[k]).toBeLessThanOrEqual(100);
    }
    expect(READINESS_LABELS).toContain(body.label);
    expect(body.byDomain.map((d) => [d.domain, d.weight])).toEqual([['FRENCH', 20], ['NUMERICAL', 10]]);
    expect(body.topicTitles[fx.gram]).toEqual({ ar: 'Grammaire (ar)', fr: 'Grammaire', key: `lt${run}.fr.gram` });
    expect(Object.keys(body.topicTitles).sort()).toEqual([fx.gram, fx.conj, fx.pct].sort());
    expect(body.priorities.length).toBeGreaterThan(0);
    expect(body.disclaimer.fr).toMatch(/pas une prédiction/);
    const fr = body.reasons.map((x) => x.fr).join('\n');
    expect(fr).toMatch(/Aucun examen blanc/);
    expect(fr).toMatch(/Pondération estimée/);
    expect(fr).toMatch(/« Spécialité » \(25 % de l’examen\)/);
    expect(fr).not.toMatch(/\bFRENCH\b|\bNUMERICAL\b/);
    expect(body.history).toEqual([{ date: today, preparation: body.preparation }]);

    // A submitted mock exam feeds readiness; the snapshot of the day is updated, not duplicated.
    await db.insert(attempts).values({ userId: fx.user1, kind: 'MOCK', familyId: fx.fam, questionIds: [], submittedAt: new Date(), score: 0.9, correctCount: 9 });
    const r2 = await request(app.getHttpServer()).get(`/me/readiness/${famSlug}`).set('Cookie', cookie1).expect(200);
    expect(r2.body.reasons.map((x: { fr: string }) => x.fr).join('\n')).not.toMatch(/Aucun examen blanc/);
    expect(r2.body.preparation).toBeGreaterThan(body.preparation);
    expect(r2.body.history).toEqual([{ date: today, preparation: r2.body.preparation }]);
    const snaps = await db.select().from(readinessSnapshots).where(and(eq(readinessSnapshots.userId, fx.user1), eq(readinessSnapshots.familyId, fx.fam)));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ date: today, preparation: r2.body.preparation, label: r2.body.label });

    await request(app.getHttpServer()).get(`/me/readiness/nope-${run}`).set('Cookie', cookie1).expect(404);
  });

  it('plans for the last practised family when not enrolled, and ticks items done by today\'s activity', async () => {
    const [att0] = await db.insert(attempts).values({ userId: fx.user2, kind: 'DIAGNOSTIC', familyId: fx.fam, questionIds: [], submittedAt: new Date() }).returning();
    expect(att0).toBeDefined();
    const r1 = await request(app.getHttpServer()).get('/me/plan/today').set('Cookie', cookie2).expect(200);
    expect(r1.body).toMatchObject({ familySlug: famSlug, enrollmentId: null, daysToExam: 60 });
    const items: PlanItemDTO[] = r1.body.items;
    const idx = items.findIndex((i) => i.kind === 'PRACTICE');
    expect(idx).toBeGreaterThanOrEqual(0);
    const target = items[idx];
    expect(target.title).toBe(target.title_ar); // user locale is ar
    const pool = target.topicId === fx.gram ? fx.questions.gram : target.topicId === fx.conj ? fx.questions.conj : fx.questions.pct;

    // Answer target.questions questions on that topic today (several attempts: a question appears once per attempt).
    let remaining = target.questions!;
    while (remaining > 0) {
      const batch = pool.slice(0, Math.min(remaining, pool.length));
      const [att] = await db.insert(attempts).values({ userId: fx.user2, kind: 'PRACTICE', familyId: fx.fam, questionIds: batch }).returning();
      await db.insert(attemptAnswers).values(batch.map((questionId, i) => ({ attemptId: att.id, questionId, answer: ['a'], isCorrect: i % 2 === 0 })));
      remaining -= batch.length;
    }
    const r2 = await request(app.getHttpServer()).get('/me/plan/today').set('Cookie', cookie2).expect(200);
    expect(r2.body.items[idx].done).toBe(true);
    expect(r2.body.items.filter((i: { done: boolean }) => i.done)).toHaveLength(1);
  });

  it('reports progress: totals, accuracy by domain, a 30-day series and topic mastery (weakest first)', async () => {
    await masterySvc.recordAnswer(fx.user2, { questionId: fx.questions.pct[1], topicId: fx.pct, rating: 1000 }, true);
    await masterySvc.recordAnswer(fx.user2, { questionId: fx.questions.conj[1], topicId: fx.conj, rating: 1000 }, false);

    const answers = await db
      .select({ isCorrect: attemptAnswers.isCorrect })
      .from(attemptAnswers)
      .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
      .where(eq(attempts.userId, fx.user2));
    const correct = answers.filter((a) => a.isCorrect).length;

    const r = await request(app.getHttpServer()).get('/me/progress').set('Cookie', cookie2).expect(200);
    expect(r.body.totals).toEqual({ answered: answers.length, correct, accuracy: Math.round((correct / answers.length) * 1000) / 1000, studyDays: 1 });
    expect(r.body.byDomain.reduce((a: number, d: { answered: number }) => a + d.answered, 0)).toBe(answers.length);
    expect(r.body.last30d).toHaveLength(30);
    expect(r.body.last30d[29]).toEqual({ date: today, answered: answers.length, correct });
    expect(r.body.last30d[0]).toEqual({ date: lastDays(today)[0], answered: 0, correct: 0 });
    const keys = r.body.mastery.map((m: { key: string }) => m.key);
    expect(keys).toEqual([`lt${run}.fr.conj`, `lt${run}.num.pct`]); // topics only (no subject rows), weakest first
    expect(r.body.mastery[0]).toMatchObject({ title_fr: 'Conjugaison', title_ar: 'Conjugaison (ar)', domain: 'FRENCH', attempts: 1 });
    expect(r.body.mastery[0].mastery).toBeLessThan(r.body.mastery[1].mastery);
  });

  it('keeps the review schedule consistent when a question is answered wrong again after a fix', async () => {
    const qid = fx.questions.conj[2];
    const ref = { questionId: qid, topicId: fx.conj, rating: 1000 };
    await masterySvc.recordAnswer(fx.user2, ref, false);
    await masterySvc.recordAnswer(fx.user2, ref, true);
    await masterySvc.recordAnswer(fx.user2, ref, false);
    const [s] = await db.select().from(userQuestionState).where(and(eq(userQuestionState.userId, fx.user2), eq(userQuestionState.questionId, qid)));
    expect(s).toMatchObject({ timesSeen: 3, timesWrong: 2, lastCorrect: false });
    near(s.nextReviewAt, addDays(new Date(), 1).getTime());
    expect((await db.select().from(userStats).where(eq(userStats.userId, fx.user2)))[0].mistakesFixed).toBe(1);
  });
});

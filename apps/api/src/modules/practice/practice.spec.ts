import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { XP, type AttemptResultDTO, type AttemptSessionDTO, type Domain, type QuestionDTO } from '@ctn/shared';
import { CommonModule } from '../../common/common.module';
import { tunisToday } from '../../common/dates';
import { SESSION_COOKIE, signSession } from '../../common/session';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import {
  attempts, blueprints, competitionFamilies, enrollments, familySyllabus, lessons, organizations, positions, questionReports, questions,
  referrals, syllabusNodes, usageCounters, users,
} from '../../db/schema';
import { EntitlementsService, type Entitlements } from '../billing/entitlements.service';
import { GamificationService } from '../gamification/gamification.service';
import { MasteryService } from '../learning/mastery.service';
import { ReadinessService } from '../learning/readiness.service';
import { PracticeModule } from './practice.module';
import { arrangeOptions, sourceLabelOf, toQuestionDTO, type QuestionRow } from './question.mapper';
import { percentileOf, summarize, type GradedItem } from './result';
import {
  allocateWithCaps, apportion, bucketOf, difficultyPattern, pickAdaptive, pickBalanced, pickSpread, seededRng, type Candidate,
} from './selection';

// ───────────── Pure helpers ─────────────

const cand = (over: Partial<Candidate>): Candidate => ({
  id: over.id ?? randomUUID(), topicId: 't1', domain: 'LOGIC', difficulty: 'MEDIUM', rating: 1000, userRating: null,
  timesSeen: 0, lastCorrect: null, recent: false, ...over,
});

describe('practice selection (pure)', () => {
  it('apportions by largest remainder and always sums to the total', () => {
    const m = apportion(24, [{ key: 'CG', weight: 2 }, { key: 'LO', weight: 1 }]);
    expect([m.get('CG'), m.get('LO')]).toEqual([16, 8]);
    const odd = apportion(24, [{ key: 'a', weight: 6 }, { key: 'b', weight: 3 }, { key: 'c', weight: 2 }]);
    expect([odd.get('a'), odd.get('b'), odd.get('c')]).toEqual([13, 7, 4]);
    expect(apportion(5, [{ key: 'x', weight: 0 }]).get('x')).toBe(0);
  });

  it('redistributes the overflow of capped keys', () => {
    const m = allocateWithCaps(10, [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }], new Map([['a', 2], ['b', 20]]));
    expect([m.get('a'), m.get('b')]).toEqual([2, 8]);
    const short = allocateWithCaps(10, [{ key: 'a', weight: 1 }], new Map([['a', 3]]));
    expect(short.get('a')).toBe(3);
  });

  it('plans a 25/50/25 difficulty mix, rotated by offset', () => {
    const p = difficultyPattern(24);
    expect(p.filter((b) => b === 'EASY')).toHaveLength(6);
    expect(p.filter((b) => b === 'MEDIUM')).toHaveLength(12);
    expect(p.filter((b) => b === 'HARD')).toHaveLength(6);
    expect(difficultyPattern(2, 0)).toEqual(['MEDIUM', 'EASY']);
    expect(difficultyPattern(2, 3)).toEqual(['HARD', 'MEDIUM']);
    expect(bucketOf('EXPERT')).toBe('HARD');
  });

  it('pickBalanced honours difficulty slots and avoids questions answered in the last 24h', () => {
    const rng = seededRng('x');
    const pool = [
      cand({ id: 'e1', difficulty: 'EASY' }), cand({ id: 'e2', difficulty: 'EASY', recent: true }),
      cand({ id: 'm1', difficulty: 'MEDIUM' }), cand({ id: 'h1', difficulty: 'HARD', recent: true }), cand({ id: 'h2', difficulty: 'EXPERT' }),
    ];
    const got = pickBalanced(pool, ['EASY', 'HARD', 'MEDIUM'], rng).map((c) => c.id);
    expect(got).toEqual(['e1', 'h2', 'm1']);
    // A recent question is used only when nothing fresh is left.
    expect(pickBalanced(pool, ['EASY', 'EASY', 'EASY', 'EASY', 'EASY'], rng).map((c) => c.id).slice(-2).sort()).toEqual(['e2', 'h1']);
  });

  it('pickAdaptive prefers ratings close to the user and unseen over already-mastered questions', () => {
    const pool = [
      cand({ id: 'far', rating: 1400, userRating: 1000 }),
      cand({ id: 'close-seen', rating: 1005, userRating: 1000, timesSeen: 3, lastCorrect: true }),
      cand({ id: 'close', rating: 990, userRating: 1000 }),
      cand({ id: 'wrong', rating: 1030, userRating: 1000, timesSeen: 1, lastCorrect: false }),
    ];
    const ids = pickAdaptive(pool, 3, () => 0).map((c) => c.id);
    expect(ids).toEqual(['close', 'wrong', 'close-seen']);
  });

  it('pickSpread covers every topic before repeating one', () => {
    const pool = [
      ...Array.from({ length: 5 }, (_, i) => cand({ id: `a${i}`, topicId: 'A' })),
      cand({ id: 'b0', topicId: 'B' }), cand({ id: 'c0', topicId: 'C' }),
    ];
    const ids = pickSpread(pool, 3, seededRng('s')).map((c) => c.topicId).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
  });
});

describe('practice scoring & mapping (pure)', () => {
  const item = (topicKey: string, domain: Domain, answered: boolean, isCorrect: boolean): GradedItem => ({
    questionId: randomUUID(), domain, topicKey, topicTitleAr: topicKey, topicTitleFr: topicKey, answered, isCorrect, timeMs: 10_000,
  });

  it('summarize: unanswered count in score not in accuracy; topics judged on ≥2 answers', () => {
    const s = summarize([
      item('weak', 'LOGIC', true, false), item('weak', 'LOGIC', true, false), item('weak', 'LOGIC', true, true),
      item('strong', 'ARABIC', true, true), item('strong', 'ARABIC', true, true),
      item('single', 'ARABIC', true, false), item('skipped', 'ARABIC', false, false),
    ]);
    expect(s.total).toBe(7);
    expect(s.correctCount).toBe(3);
    expect(s.score).toBe(43);
    expect(s.accuracy).toBe(50);
    expect(s.weakTopics.map((t) => t.key)).toEqual(['weak']);
    expect(s.strongTopics.map((t) => t.key)).toEqual(['strong']);
    expect(s.byDomain).toEqual([
      { domain: 'ARABIC', correct: 2, total: 4, score: 50 },
      { domain: 'LOGIC', correct: 1, total: 3, score: 33 },
    ]);
    expect(s.avgTimeS).toBe(10);
  });

  it('percentile needs at least 5 other attempts', () => {
    expect(percentileOf(2, 0, 4)).toBeNull();
    expect(percentileOf(3, 2, 10)).toBe(40);
  });

  const row = (over: Partial<QuestionRow> = {}): QuestionRow => ({
    id: randomUUID(), type: 'MCQ_SINGLE', domain: 'LOGIC', language: 'fr', stem: 'Q?',
    options: [{ id: 'a', text: 'A', isCorrect: true }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }],
    correct: ['a'], explanation: 'why', difficulty: 'MEDIUM', rating: 1000, topicId: randomUUID(), topicKey: 'lo.x',
    topicTitleAr: 'م', topicTitleFr: 'T', origin: 'PAST_EXAM_REWRITTEN', year: 2019, status: 'AI_REVIEWED', pastExamTitle: null, ...over,
  });

  it('toQuestionDTO hides the answer unless revealed and strips option extras', () => {
    const hidden = toQuestionDTO(row());
    expect(hidden).not.toHaveProperty('correct');
    expect(hidden).not.toHaveProperty('explanation');
    expect(hidden.options[0]).toEqual({ id: 'a', text: 'A' });
    expect(hidden.unreviewed).toBe(true);
    expect(hidden.sourceLabel).toContain('2019');
    const shown = toQuestionDTO(row({ status: 'PUBLISHED' }), { reveal: true, bookmarked: true });
    expect(shown).toEqual(expect.objectContaining({ correct: ['a'], explanation: 'why', unreviewed: false, bookmarked: true }));
    expect(sourceLabelOf('AUTHORED', null, 'Concours 2018')).toBe('Concours 2018');
  });

  it('arrangeOptions is deterministic, keeps positional options, never shows ORDERING solved', () => {
    const opts = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, text: id.toUpperCase() }));
    const one = arrangeOptions('MCQ_SINGLE', opts, ['a'], 's1').map((o) => o.id);
    expect(arrangeOptions('MCQ_SINGLE', opts, ['a'], 's1').map((o) => o.id)).toEqual(one);
    expect([...one].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    const positional = [...opts.slice(0, 3), { id: 'd', text: 'a et b' }];
    expect(arrangeOptions('MCQ_SINGLE', positional, ['d'], 's1')).toEqual(positional);
    for (let i = 0; i < 30; i++) {
      const order = arrangeOptions('ORDERING', opts, { order: ['a', 'b', 'c', 'd', 'e'] }, `seed${i}`).map((o) => o.id);
      expect(order.join('')).not.toBe('abcde');
    }
    expect(arrangeOptions('TRUE_FALSE', opts.slice(0, 2), ['a'], 's')).toEqual(opts.slice(0, 2));
  });
});

// ───────────── API (real DB) ─────────────

const FREE: Entitlements = { premium: false, planCode: null, endsAt: null, limits: { questionsPerDay: 20, tutorPerDay: 3, mocksTotal: 1, offline: false } };
const PREMIUM: Entitlements = { premium: true, planCode: 'PREMIUM_MONTH', endsAt: null, limits: { questionsPerDay: null, tutorPerDay: 50, mocksTotal: null, offline: true } };

let db: Database;

/** Fake learning: maintains user_question_state like the real MasteryService so mistakes/review can be exercised. */
const mastery = {
  recordAnswer: jest.fn(async (userId: string, q: { questionId: string }, isCorrect: boolean) => {
    await db.execute(sql`
      insert into user_question_state (user_id, question_id, times_seen, times_wrong, last_correct, last_answered_at, next_review_at)
      values (${userId}, ${q.questionId}, 1, ${isCorrect ? 0 : 1}, ${isCorrect}, now(), now() + interval '1 day')
      on conflict (user_id, question_id) do update set times_seen = user_question_state.times_seen + 1,
        times_wrong = user_question_state.times_wrong + ${isCorrect ? 0 : 1}, last_correct = excluded.last_correct,
        last_answered_at = now(), next_review_at = excluded.next_review_at`);
    return { masteryBefore: 0.35, masteryAfter: isCorrect ? 0.4 : 0.3 };
  }),
};
const readinessResult = {
  overall: 40, preparation: 36, coverage: 10, label: 'NOT_READY', byDomain: [], reasons: [], priorities: [],
  disclaimer: { ar: 'م', fr: 'd' }, familySlug: 'x', topicTitles: {}, history: [],
};
const readiness = { forFamily: jest.fn(async () => readinessResult) };
const gamification = {
  awardXp: jest.fn(async () => 100),
  touchStreak: jest.fn(async () => 1),
  checkBadges: jest.fn(async (): Promise<string[]> => []),
  incrementAnswered: jest.fn(async () => undefined),
};
const entitlements = {
  get: jest.fn(async (): Promise<Entitlements> => FREE),
  consume: jest.fn(async () => ({ allowed: true, remaining: 19 as number | null })),
  canStartMock: jest.fn(async () => true),
  grantDays: jest.fn(async () => undefined),
};

@Global()
@Module({
  providers: [
    { provide: MasteryService, useValue: mastery },
    { provide: ReadinessService, useValue: readiness },
    { provide: GamificationService, useValue: gamification },
    { provide: EntitlementsService, useValue: entitlements },
  ],
  exports: [MasteryService, ReadinessService, GamificationService, EntitlementsService],
})
class FakeGlobalsModule {}

describe('practice API (real DB)', () => {
  let app: INestApplication;
  const sfx = randomBytes(5).toString('hex');
  const familySlug = `t-practice-${sfx}`;
  const keys = { cg: `t${sfx}.cg`, cgA: `t${sfx}.cg.a`, cgB: `t${sfx}.cg.b`, lo: `t${sfx}.lo`, loA: `t${sfx}.lo.a`, spec: `t${sfx}.spec`, specX: `t${sfx}.spec.x` };
  const nodeIds: Record<string, string> = {};
  const questionIds: string[] = [];
  const hiddenIds: string[] = []; // expired + draft: must never be served
  const userIds: string[] = [];
  let orgId: string;
  let familyId: string;
  const domainOf = new Map<string, Domain>();

  const http = () => request(app.getHttpServer());

  async function newUser(over: Partial<typeof users.$inferInsert> = {}): Promise<{ id: string; cookie: string }> {
    const [u] = await db
      .insert(users)
      .values({ email: `practice-${randomBytes(6).toString('hex')}@test.local`, isGuest: false, referralCode: `P${randomBytes(6).toString('hex').toUpperCase()}`, ...over })
      .returning({ id: users.id, isGuest: users.isGuest });
    userIds.push(u.id);
    return { id: u.id, cookie: `${SESSION_COOKIE}=${signSession({ id: u.id, role: 'USER', isGuest: u.isGuest })}` };
  }

  const start = (cookie: string, body: Record<string, unknown>) => http().post('/attempts').set('Cookie', cookie).send(body);
  const answer = (cookie: string, id: string, questionId: string, ans: unknown) =>
    http().post(`/attempts/${id}/answers`).set('Cookie', cookie).send({ questionId, answer: ans, timeMs: 4000 });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DbModule, CommonModule, FakeGlobalsModule, PracticeModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    db = moduleRef.get<Database>(DB);

    const [org] = await db.insert(organizations).values({ slug: `t-org-${sfx}`, nameAr: 'منظمة', nameFr: 'Org' }).returning({ id: organizations.id });
    orgId = org.id;
    const [fam] = await db
      .insert(competitionFamilies)
      .values({ slug: familySlug, organizationId: orgId, field: 'SECURITY', nameAr: 'مناظرة اختبار', nameFr: 'Concours test', status: 'PUBLISHED' })
      .returning({ id: competitionFamilies.id });
    familyId = fam.id;

    const node = async (key: string, level: 'SUBJECT' | 'UNIT' | 'TOPIC', domain: Domain, parentKey?: string) => {
      const [n] = await db
        .insert(syllabusNodes)
        .values({ key, level, domain, titleAr: `عنوان ${key}`, titleFr: `Titre ${key}`, scope: 'GENERAL_SKILL', parentId: parentKey ? nodeIds[parentKey] : null, status: 'PUBLISHED' })
        .returning({ id: syllabusNodes.id });
      nodeIds[key] = n.id;
    };
    await node(keys.cg, 'SUBJECT', 'CULTURE_GENERALE');
    await node(keys.cgA, 'TOPIC', 'CULTURE_GENERALE', keys.cg);
    await node(keys.cgB, 'TOPIC', 'CULTURE_GENERALE', keys.cg);
    await node(keys.lo, 'SUBJECT', 'LOGIC');
    await node(keys.loA, 'TOPIC', 'LOGIC', keys.lo);
    await node(keys.specX, 'UNIT', 'SPECIALTY');
    await db.insert(familySyllabus).values([keys.cg, keys.lo, keys.specX].map((k) => ({ familyId, nodeId: nodeIds[k], weight: 1 })));

    const [posA] = await db.insert(positions).values({ familyId, slug: 'pos-a', titleAr: 'أ', titleFr: 'A', orderIndex: 0 }).returning({ id: positions.id });
    const [posB] = await db.insert(positions).values({ familyId, slug: 'pos-b', titleAr: 'ب', titleFr: 'B', orderIndex: 1 }).returning({ id: positions.id });
    await db.insert(blueprints).values([
      {
        positionId: posA.id, title: 'A', totalMinutes: 30, fidelity: 'APPROXIMATED',
        sections: [
          { domain: 'CULTURE_GENERALE', specialtyKey: null, count: 6, minutes: 15 },
          { domain: 'LOGIC', specialtyKey: null, count: 3, minutes: 10 },
          // No node has this exact key: matched as a prefix (t….spec.x).
          { domain: 'SPECIALTY', specialtyKey: keys.spec, count: 2, minutes: 5 },
        ],
      },
      { positionId: posB.id, title: 'B', totalMinutes: 20, fidelity: 'OFFICIAL_FORMAT', sections: [{ domain: 'LOGIC', specialtyKey: null, count: 15, minutes: 20 }] },
    ]);

    const qs: (typeof questions.$inferInsert)[] = [];
    const mk = (topicKey: string, domain: Domain, difficulty: 'EASY' | 'MEDIUM' | 'HARD', n: number) => {
      for (let i = 0; i < n; i++) {
        qs.push({
          type: 'MCQ_SINGLE', domain, language: 'fr', stem: `${topicKey} ${difficulty} ${i}?`,
          options: [{ id: 'a', text: 'Bonne' }, { id: 'b', text: 'Mauvaise' }, { id: 'c', text: 'Autre' }, { id: 'd', text: 'Encore' }],
          correct: ['a'], explanation: `Parce que ${i}`, difficulty, topicId: nodeIds[topicKey], origin: 'AUTHORED', status: 'PUBLISHED',
          rating: difficulty === 'EASY' ? 900 : difficulty === 'MEDIUM' ? 1000 : 1100,
        });
      }
    };
    mk(keys.cgA, 'CULTURE_GENERALE', 'EASY', 4); mk(keys.cgA, 'CULTURE_GENERALE', 'MEDIUM', 5); mk(keys.cgA, 'CULTURE_GENERALE', 'HARD', 3);
    mk(keys.cgB, 'CULTURE_GENERALE', 'EASY', 4); mk(keys.cgB, 'CULTURE_GENERALE', 'MEDIUM', 5); mk(keys.cgB, 'CULTURE_GENERALE', 'HARD', 3);
    mk(keys.loA, 'LOGIC', 'EASY', 3); mk(keys.loA, 'LOGIC', 'MEDIUM', 6); mk(keys.loA, 'LOGIC', 'HARD', 3);
    mk(keys.specX, 'SPECIALTY', 'MEDIUM', 5);
    const inserted = await db.insert(questions).values(qs).returning({ id: questions.id, domain: questions.domain });
    for (const q of inserted) {
      questionIds.push(q.id);
      domainOf.set(q.id, q.domain);
    }
    const hidden = await db
      .insert(questions)
      .values([
        { ...qs[0], stem: 'expired', validUntil: '2020-01-01' },
        { ...qs[0], stem: 'draft', status: 'DRAFT' },
      ])
      .returning({ id: questions.id });
    hiddenIds.push(...hidden.map((h) => h.id));
    await db.insert(lessons).values({ nodeId: nodeIds[keys.cgA], language: 'fr', title: 'Leçon test', bodyMd: '## Test', status: 'PUBLISHED' });
  });

  afterAll(async () => {
    if (db) {
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
      const allQ = [...questionIds, ...hiddenIds];
      if (allQ.length) await db.delete(questions).where(inArray(questions.id, allQ));
      const nIds = Object.values(nodeIds);
      if (nIds.length) await db.delete(syllabusNodes).where(inArray(syllabusNodes.id, nIds));
      if (familyId) await db.delete(competitionFamilies).where(eq(competitionFamilies.id, familyId));
      if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    entitlements.get.mockImplementation(async () => FREE);
    entitlements.consume.mockImplementation(async () => ({ allowed: true, remaining: 19 }));
    entitlements.canStartMock.mockImplementation(async () => true);
  });

  const countBy = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [f(x)]: (m[f(x)] ?? 0) + 1 }), {});

  it('requires a session', async () => {
    await http().post('/attempts').send({ kind: 'PRACTICE' }).expect(401);
  });

  it('DIAGNOSTIC: exam mode hides answers, follows blueprint shares, submit returns the full result', async () => {
    const me = await newUser();
    const res = await start(me.cookie, { kind: 'DIAGNOSTIC', familySlug }).expect(201);
    const s = res.body as AttemptSessionDTO;
    expect(s.mode).toBe('exam');
    expect(s.familySlug).toBe(familySlug);
    expect(s.positionSlug).toBe('pos-a');
    expect(s.questions).toHaveLength(24);
    for (const q of s.questions) {
      expect(q).not.toHaveProperty('correct');
      expect(q).not.toHaveProperty('explanation');
      expect(hiddenIds).not.toContain(q.id);
    }
    // Blueprint pos-a: CG 6 / LOGIC 3 / SPECIALTY 2 → 13 / 7 / 4 of 24.
    expect(countBy(s.questions, (q) => q.domain)).toEqual({ CULTURE_GENERALE: 13, LOGIC: 7, SPECIALTY: 4 });
    const diff = countBy(s.questions, (q) => q.difficulty);
    expect(diff.MEDIUM).toBeGreaterThanOrEqual(10);
    expect(diff.EASY).toBeGreaterThanOrEqual(4);
    expect(diff.HARD).toBeGreaterThanOrEqual(4);

    // Re-starting resumes the open diagnostic instead of creating another one.
    const again = await start(me.cookie, { kind: 'DIAGNOSTIC', familySlug }).expect(201);
    expect(again.body.id).toBe(s.id);

    const first = s.questions[0].id;
    const saved = await answer(me.cookie, s.id, first, ['b']).expect(200);
    expect(saved.body).toEqual({ saved: true });
    await answer(me.cookie, s.id, first, ['a']).expect(200); // exam answers can change until submit
    // Answer 12 questions: 8 right, 4 wrong.
    for (const [i, q] of s.questions.slice(1, 12).entries()) await answer(me.cookie, s.id, q.id, i < 7 ? ['a'] : ['c']).expect(200);

    const mid = await http().get(`/attempts/${s.id}`).set('Cookie', me.cookie).expect(200);
    expect(mid.body.answered[first]).toEqual(['a']);
    expect((mid.body as AttemptSessionDTO).questions.every((q) => !('correct' in q))).toBe(true);
    expect(mastery.recordAnswer).not.toHaveBeenCalled();

    const sub = await http().post(`/attempts/${s.id}/submit`).set('Cookie', me.cookie).expect(200);
    const r = sub.body as AttemptResultDTO;
    expect(r).toEqual(expect.objectContaining({ id: s.id, kind: 'DIAGNOSTIC', total: 24, correctCount: 8, score: 33, accuracy: 67 }));
    expect(r.review).toHaveLength(24);
    expect(r.review.every((x) => Array.isArray(x.question.correct) && typeof x.question.explanation === 'string')).toBe(true);
    expect(r.review.find((x) => x.question.id === first)).toEqual(expect.objectContaining({ answer: ['a'], isCorrect: true }));
    expect(r.byDomain.reduce((a, d) => a + d.total, 0)).toBe(24);
    expect(r.readiness).toEqual(expect.objectContaining({ overall: 40 }));
    expect(r.xpGained).toBe(12 * XP.ANSWER + 8 * XP.CORRECT);
    expect(r.percentile).toBeNull();
    expect(mastery.recordAnswer).toHaveBeenCalledTimes(12);
    expect(readiness.forFamily).toHaveBeenCalledWith(me.id, familyId);
    expect(gamification.checkBadges).toHaveBeenCalled();

    // Idempotent: a second submit returns the stored result without re-recording mastery.
    const again2 = await http().post(`/attempts/${s.id}/submit`).set('Cookie', me.cookie).expect(200);
    expect(again2.body.score).toBe(33);
    expect(mastery.recordAnswer).toHaveBeenCalledTimes(12);
    const got = await http().get(`/attempts/${s.id}`).set('Cookie', me.cookie).expect(200);
    expect(got.body.result).toEqual(expect.objectContaining({ id: s.id, score: 33, xpGained: r.xpGained }));
    expect(got.body.result.review).toHaveLength(24);
    const closed = await answer(me.cookie, s.id, first, ['b']).expect(409);
    expect(closed.body.message).toBe('ATTEMPT_CLOSED');

    const [row] = await db.select({ score: attempts.score }).from(attempts).where(eq(attempts.id, s.id));
    expect(row.score).toBeCloseTo(8 / 24, 3);
    const hist = await http().get('/attempts?kind=DIAGNOSTIC').set('Cookie', me.cookie).expect(200);
    expect(hist.body[0]).toEqual(expect.objectContaining({ id: s.id, kind: 'DIAGNOSTIC', familySlug, score: 33, total: 24 }));
    await http().get('/attempts?kind=NOPE').set('Cookie', me.cookie).expect(400);
  });

  it('PRACTICE: instant feedback, first answer final, XP and limit consumption', async () => {
    const me = await newUser();
    const res = await start(me.cookie, { kind: 'PRACTICE', topicKey: keys.cgA, count: 5 }).expect(201);
    const s = res.body as AttemptSessionDTO;
    expect(s.mode).toBe('instant');
    expect(s.questions).toHaveLength(5);
    expect(s.questions.every((q) => q.topicKey === keys.cgA && !('correct' in q))).toBe(true);

    const q = s.questions[0];
    const fb = await answer(me.cookie, s.id, q.id, ['a']).expect(200);
    expect(fb.body).toEqual(expect.objectContaining({ saved: true, isCorrect: true, correct: ['a'], explanation: expect.any(String), xpGained: XP.ANSWER + XP.CORRECT, limitReached: false }));
    expect(entitlements.consume).toHaveBeenCalledWith(me.id, 'questions');
    expect(mastery.recordAnswer).toHaveBeenCalledWith(me.id, expect.objectContaining({ questionId: q.id }), true, 4000);
    expect(gamification.awardXp).toHaveBeenCalledWith(me.id, XP.ANSWER + XP.CORRECT, 'CORRECT', null);

    const replay = await answer(me.cookie, s.id, q.id, ['b']).expect(200);
    expect(replay.body).toEqual(expect.objectContaining({ isCorrect: true, xpGained: 0 }));
    expect(entitlements.consume).toHaveBeenCalledTimes(1);

    const wrong = await answer(me.cookie, s.id, s.questions[1].id, ['c']).expect(200);
    expect(wrong.body).toEqual(expect.objectContaining({ isCorrect: false, correct: ['a'], xpGained: XP.ANSWER }));

    const session = await http().get(`/attempts/${s.id}`).set('Cookie', me.cookie).expect(200);
    const qs = session.body.questions as QuestionDTO[];
    expect(qs.find((x) => x.id === q.id)?.correct).toEqual(['a']);
    expect(qs.find((x) => x.id === s.questions[2].id)).not.toHaveProperty('correct');
    expect(session.body.results).toEqual({ [q.id]: true, [s.questions[1].id]: false });

    const other = await start(me.cookie, { kind: 'PRACTICE', topicKey: keys.cgA, count: 5 }).expect(201);
    expect(other.body.id).not.toBe(s.id);

    const result = await http().post(`/attempts/${s.id}/submit`).set('Cookie', me.cookie).expect(200);
    expect(result.body).toEqual(expect.objectContaining({ total: 5, correctCount: 1, answeredCount: 2, accuracy: 50, xpGained: 2 * XP.ANSWER + XP.CORRECT }));
    expect(mastery.recordAnswer).toHaveBeenCalledTimes(2);

    await start(me.cookie, { kind: 'PRACTICE', topicKey: 'does.not.exist' }).expect(404);
    const outside = await answer(me.cookie, other.body.id, hiddenIds[0], ['a']).expect(400);
    expect(outside.body.message).toBe('QUESTION_NOT_IN_ATTEMPT');
  });

  it('enforces ownership with 404 everywhere', async () => {
    const owner = await newUser();
    const intruder = await newUser({ isGuest: true, email: null });
    const s = (await start(owner.cookie, { kind: 'PRACTICE', topicKey: keys.loA, count: 3 }).expect(201)).body as AttemptSessionDTO;
    await http().get(`/attempts/${s.id}`).set('Cookie', intruder.cookie).expect(404);
    await answer(intruder.cookie, s.id, s.questions[0].id, ['a']).expect(404);
    await http().post(`/attempts/${s.id}/submit`).set('Cookie', intruder.cookie).expect(404);
    await http().get('/attempts/not-a-uuid').set('Cookie', owner.cookie).expect(404);
    const list = await http().get('/attempts').set('Cookie', intruder.cookie).expect(200);
    expect(list.body).toEqual([]);
    expect(mastery.recordAnswer).not.toHaveBeenCalled();
  });

  it('free daily limit: 402 LIMIT_REACHED on answer and at start once exhausted', async () => {
    const me = await newUser();
    const s = (await start(me.cookie, { kind: 'PRACTICE', topicKey: keys.cgB, count: 3 }).expect(201)).body as AttemptSessionDTO;
    entitlements.consume.mockImplementation(async () => ({ allowed: false, remaining: 0 }));
    const blocked = await answer(me.cookie, s.id, s.questions[0].id, ['a']).expect(402);
    expect(blocked.body.message).toBe('LIMIT_REACHED');
    expect(mastery.recordAnswer).not.toHaveBeenCalled();

    await db.insert(usageCounters).values({ userId: me.id, date: tunisToday(), questions: 20 });
    const atStart = await start(me.cookie, { kind: 'PRACTICE', topicKey: keys.cgB }).expect(402);
    expect(atStart.body.message).toBe('LIMIT_REACHED');
    // The diagnostic is never limited.
    await start(me.cookie, { kind: 'DIAGNOSTIC', familySlug }).expect(201);
  });

  it('MOCK: premium gate, blueprint sections with shortfall, expiry closes answers and GET auto-submits', async () => {
    const me = await newUser();
    entitlements.canStartMock.mockImplementation(async () => false);
    const gated = await start(me.cookie, { kind: 'MOCK', familySlug }).expect(402);
    expect(gated.body.message).toBe('PREMIUM_REQUIRED');

    entitlements.canStartMock.mockImplementation(async () => true);
    const before = Date.now();
    const s = (await start(me.cookie, { kind: 'MOCK', familySlug }).expect(201)).body as AttemptSessionDTO & { sections: { served: number; count: number }[] };
    expect(s.mode).toBe('exam');
    expect(s.durationMinutes).toBe(30);
    expect(s.blueprintFidelity).toBe('APPROXIMATED');
    expect(s.questions).toHaveLength(11);
    expect(Date.parse(s.expiresAt!) - before).toBeGreaterThanOrEqual(30 * 60_000 - 5000);
    expect(s.sections.map((x) => [x.count, x.served])).toEqual([[6, 6], [3, 3], [2, 2]]);
    expect(s.questions.slice(9).every((q) => q.domain === 'SPECIALTY')).toBe(true);
    expect(s.questions.every((q) => !('correct' in q))).toBe(true);

    // Reloading resumes the running mock (no second mock consumed).
    const resumed = await start(me.cookie, { kind: 'MOCK', familySlug }).expect(201);
    expect(resumed.body.id).toBe(s.id);

    await answer(me.cookie, s.id, s.questions[0].id, ['a']).expect(200);
    await db.update(attempts).set({ expiresAt: sql`now() - interval '5 minutes'` }).where(eq(attempts.id, s.id));
    const late = await answer(me.cookie, s.id, s.questions[1].id, ['a']).expect(409);
    expect(late.body.message).toBe('ATTEMPT_CLOSED');

    const auto = await http().get(`/attempts/${s.id}`).set('Cookie', me.cookie).expect(200);
    expect(auto.body.result).toEqual(expect.objectContaining({ id: s.id, kind: 'MOCK', total: 11, correctCount: 1, percentile: null }));
    expect(auto.body.result.xpGained).toBe(XP.ANSWER + XP.CORRECT + XP.MOCK_DONE);
    expect(gamification.awardXp).toHaveBeenCalledWith(me.id, XP.MOCK_DONE, 'MOCK_DONE', familyId);
    const [row] = await db.select({ submittedAt: attempts.submittedAt, durationS: attempts.durationS }).from(attempts).where(eq(attempts.id, s.id));
    expect(row.submittedAt).not.toBeNull();
    expect(row.durationS).toBeLessThanOrEqual(60);

    // pos-b asks 15 LOGIC questions, only 12 exist: 3 filled from the family pool and reported.
    const b = (await start(me.cookie, { kind: 'MOCK', familySlug, positionSlug: 'pos-b' }).expect(201)).body as AttemptSessionDTO & { shortfall: number; sections: { served: number; filled: number }[] };
    expect(b.questions).toHaveLength(15);
    expect(b.blueprintFidelity).toBe('OFFICIAL_FORMAT');
    expect(b.shortfall).toBe(3);
    expect(b.sections[0]).toEqual(expect.objectContaining({ served: 12, filled: 3 }));
    const bRes = await http().post(`/attempts/${b.id}/submit`).set('Cookie', me.cookie).expect(200);
    expect(bRes.body.shortfall).toBe(3);
    await start(me.cookie, { kind: 'MOCK', familySlug, positionSlug: 'nope' }).expect(404);
  });

  it('REVIEW and mistakes notebook serve previously wrong questions with their answers', async () => {
    const me = await newUser();
    await start(me.cookie, { kind: 'REVIEW' }).expect(404);
    const s = (await start(me.cookie, { kind: 'PRACTICE', topicKey: keys.loA, count: 3 }).expect(201)).body as AttemptSessionDTO;
    const missed = s.questions[0].id;
    await answer(me.cookie, s.id, missed, ['d']).expect(200);

    const mistakes = await http().get('/me/mistakes').set('Cookie', me.cookie).expect(200);
    expect(mistakes.body).toHaveLength(1);
    expect(mistakes.body[0]).toEqual(expect.objectContaining({ timesWrong: 1, fixed: false, lastAnsweredAt: expect.any(String) }));
    expect(mistakes.body[0].question).toEqual(expect.objectContaining({ id: missed, correct: ['a'], explanation: expect.any(String) }));

    const review = (await start(me.cookie, { kind: 'REVIEW' }).expect(201)).body as AttemptSessionDTO;
    expect(review.mode).toBe('instant');
    expect(review.questions.map((q) => q.id)).toEqual([missed]);
    const fixed = await answer(me.cookie, review.id, missed, ['a']).expect(200);
    expect(fixed.body.xpGained).toBe(XP.ANSWER + XP.CORRECT + XP.MISTAKE_FIXED);
    expect(gamification.awardXp).toHaveBeenCalledWith(me.id, XP.MISTAKE_FIXED, 'MISTAKE_FIXED', null);
    const after = await http().get('/me/mistakes').set('Cookie', me.cookie).expect(200);
    expect(after.body[0].fixed).toBe(true);
  });

  it('bookmarks and question reports', async () => {
    const me = await newUser();
    const qid = questionIds[0];
    await http().post(`/me/bookmarks/${qid}`).set('Cookie', me.cookie).expect(200, { ok: true });
    let list = await http().get('/me/bookmarks').set('Cookie', me.cookie).expect(200);
    expect(list.body.map((q: QuestionDTO) => q.id)).toEqual([qid]);
    expect(list.body[0]).toEqual(expect.objectContaining({ bookmarked: true }));
    expect(list.body[0]).not.toHaveProperty('correct'); // never answered: no spoiler
    await http().delete(`/me/bookmarks/${qid}`).set('Cookie', me.cookie).expect(200, { ok: true });
    list = await http().get('/me/bookmarks').set('Cookie', me.cookie).expect(200);
    expect(list.body).toEqual([]);
    await http().post(`/me/bookmarks/${randomUUID()}`).set('Cookie', me.cookie).expect(404);

    await http().post(`/questions/${qid}/report`).set('Cookie', me.cookie).send({ reason: 'TYPO' }).expect(200, { ok: true });
    await http().post(`/questions/${qid}/report`).set('Cookie', me.cookie).send({ reason: 'WRONG_ANSWER', comment: '  b est juste  ' }).expect(200);
    const reports = await db.select().from(questionReports).where(and(eq(questionReports.questionId, qid), eq(questionReports.userId, me.id)));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(expect.objectContaining({ reason: 'WRONG_ANSWER', comment: 'b est juste', status: 'OPEN' }));
    await http().post(`/questions/${qid}/report`).set('Cookie', me.cookie).send({ reason: 'NOPE' }).expect(400);
    await http().post(`/questions/${randomUUID()}/report`).set('Cookie', me.cookie).send({ reason: 'TYPO' }).expect(404);
  });

  it('exam answers stay hidden in the notebook while the exam is open', async () => {
    const me = await newUser();
    const p = (await start(me.cookie, { kind: 'PRACTICE', topicKey: keys.cgA, count: 3 }).expect(201)).body as AttemptSessionDTO;
    await answer(me.cookie, p.id, p.questions[0].id, ['d']).expect(200);
    await db.insert(attempts).values({ userId: me.id, kind: 'DIAGNOSTIC', familyId, questionIds: [p.questions[0].id], result: { meta: {} } });
    const m = await http().get('/me/mistakes').set('Cookie', me.cookie).expect(200);
    expect(m.body[0].question.id).toBe(p.questions[0].id);
    expect(m.body[0].question).not.toHaveProperty('correct');
  });

  it('offline pack is premium-only and ships answers + lessons', async () => {
    const me = await newUser();
    const denied = await http().get(`/offline/pack/${familySlug}`).set('Cookie', me.cookie).expect(402);
    expect(denied.body.message).toBe('PREMIUM_REQUIRED');
    entitlements.get.mockImplementation(async () => PREMIUM);
    const pack = await http().get(`/offline/pack/${familySlug}`).set('Cookie', me.cookie).expect(200);
    expect(pack.body.familySlug).toBe(familySlug);
    expect(pack.body.questions).toHaveLength(questionIds.length);
    expect(pack.body.questions.every((q: QuestionDTO) => Array.isArray(q.correct) && !!q.explanation && !hiddenIds.includes(q.id))).toBe(true);
    expect(pack.body.lessons).toEqual([expect.objectContaining({ title: 'Leçon test', topicKey: keys.cgA, unreviewed: false })]);
    await http().get('/offline/pack/unknown-family-x').set('Cookie', me.cookie).expect(404);
  });

  it('rewards the referral once when the referred user completes a diagnostic', async () => {
    const referrer = await newUser();
    const referred = await newUser();
    const [ref] = await db.insert(referrals).values({ referrerId: referrer.id, referredId: referred.id }).returning({ id: referrals.id });
    const s = (await start(referred.cookie, { kind: 'DIAGNOSTIC', familySlug }).expect(201)).body as AttemptSessionDTO;
    await http().post(`/attempts/${s.id}/submit`).set('Cookie', referred.cookie).expect(200);
    expect(entitlements.grantDays).toHaveBeenCalledWith(referred.id, 7, 'REFERRAL');
    expect(entitlements.grantDays).toHaveBeenCalledWith(referrer.id, 7, 'REFERRAL');
    const [row] = await db.select({ rewardedAt: referrals.rewardedAt }).from(referrals).where(eq(referrals.id, ref.id));
    expect(row.rewardedAt).not.toBeNull();

    entitlements.grantDays.mockClear();
    const s2 = (await start(referred.cookie, { kind: 'DIAGNOSTIC', familySlug }).expect(201)).body as AttemptSessionDTO;
    await http().post(`/attempts/${s2.id}/submit`).set('Cookie', referred.cookie).expect(200);
    expect(entitlements.grantDays).not.toHaveBeenCalled();

    // Guests are not rewarded until they register.
    const guest = await newUser({ isGuest: true, email: null });
    await db.insert(referrals).values({ referrerId: referrer.id, referredId: guest.id });
    const g = (await start(guest.cookie, { kind: 'DIAGNOSTIC', familySlug }).expect(201)).body as AttemptSessionDTO;
    await http().post(`/attempts/${g.id}/submit`).set('Cookie', guest.cookie).expect(200);
    expect(entitlements.grantDays).not.toHaveBeenCalled();
  });

  it('gamification failures never break answering or submitting', async () => {
    const me = await newUser();
    gamification.awardXp.mockRejectedValueOnce(new Error('boom'));
    gamification.checkBadges.mockRejectedValue(new Error('boom'));
    readiness.forFamily.mockRejectedValueOnce(new Error('boom'));
    const s = (await start(me.cookie, { kind: 'PRACTICE', familySlug, count: 4 }).expect(201)).body as AttemptSessionDTO;
    expect(s.familySlug).toBe(familySlug);
    const fb = await answer(me.cookie, s.id, s.questions[0].id, ['a']).expect(200);
    expect(fb.body).toEqual(expect.objectContaining({ isCorrect: true, xpGained: 0 }));
    const r = await http().post(`/attempts/${s.id}/submit`).set('Cookie', me.cookie).expect(200);
    expect(r.body).toEqual(expect.objectContaining({ readiness: null, newBadges: [] }));
    gamification.checkBadges.mockImplementation(async () => []);
  });

  it('PRACTICE on a domain stays inside the enrolled family and is attributed to it', async () => {
    const me = await newUser();
    await db.insert(enrollments).values({ userId: me.id, familyId, isPrimary: true });
    const s = (await start(me.cookie, { kind: 'PRACTICE', domain: 'SPECIALTY', count: 30 }).expect(201)).body as AttemptSessionDTO;
    expect(s.familySlug).toBe(familySlug);
    expect(s.questions).toHaveLength(5);
    expect(s.questions.every((q) => q.topicKey === keys.specX)).toBe(true);
  });

  it('DAILY uses the topics of today\'s plan', async () => {
    const me = await newUser();
    await db.execute(sql`
      insert into study_plan_days (user_id, date, items)
      values (${me.id}, ${tunisToday()}, ${JSON.stringify([{ kind: 'PRACTICE', topicId: nodeIds[keys.loA], title: 'x', questions: 4, minutes: 4 }])}::jsonb)`);
    const s = (await start(me.cookie, { kind: 'DAILY' }).expect(201)).body as AttemptSessionDTO;
    expect(s.mode).toBe('instant');
    expect(s.questions).toHaveLength(4);
    expect(s.questions.every((q) => q.topicKey === keys.loA)).toBe(true);
  });
});

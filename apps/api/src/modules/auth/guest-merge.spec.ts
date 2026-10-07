import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import {
  alertMatches, attemptAnswers, attempts, competitionFacts, competitionFamilies, competitions, enrollments, follows, mastery,
  notifications, organizations, physicalLogs, questions, readinessSnapshots, studyPlanDays, syllabusNodes, usageCounters,
  userBadges, userDocumentChecks, userProfiles, userQuestionState, userStats, users, xpEvents,
} from '../../db/schema';
import { generateReferralCode } from './auth.util';
import { GuestMergeService } from './guest-merge.service';

const run = randomBytes(4).toString('hex');

describe('GuestMergeService', () => {
  let db: Database;
  let merge: GuestMergeService;
  let close: () => Promise<void>;
  const ids: { org?: string; fam?: string; famB?: string; node?: string; node2?: string; q1?: string; q2?: string } = {};

  async function newUser(isGuest: boolean, extra: Partial<typeof users.$inferInsert> = {}) {
    const [u] = await db.insert(users).values({ isGuest, referralCode: generateReferralCode(), ...extra }).returning();
    await db.insert(userProfiles).values({ userId: u.id });
    await db.insert(userStats).values({ userId: u.id });
    return u.id;
  }

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [DbModule], providers: [GuestMergeService] }).compile();
    const app = ref.createNestApplication({ logger: ['error'] });
    await app.init();
    close = () => app.close();
    db = app.get<Database>(DB);
    merge = app.get(GuestMergeService);

    const [org] = await db.insert(organizations).values({ slug: `merge-org-${run}`, nameAr: 'م', nameFr: 'O' }).returning();
    const [fam, famB] = await db
      .insert(competitionFamilies)
      .values([
        { slug: `merge-fam-${run}`, organizationId: org.id, field: 'CUSTOMS', nameAr: 'د', nameFr: 'D' },
        { slug: `merge-famb-${run}`, organizationId: org.id, field: 'HEALTH', nameAr: 'ص', nameFr: 'S' },
      ])
      .returning();
    const [node, node2] = await db
      .insert(syllabusNodes)
      .values([
        { key: `merge.topic.${run}`, level: 'TOPIC', domain: 'LOGIC', titleAr: 'م', titleFr: 'T', scope: 'GENERAL_SKILL' },
        { key: `merge.topic2.${run}`, level: 'TOPIC', domain: 'LOGIC', titleAr: 'م', titleFr: 'T2', scope: 'GENERAL_SKILL' },
      ])
      .returning();
    const qBase = { type: 'MCQ_SINGLE' as const, domain: 'LOGIC' as const, language: 'fr', options: [], correct: ['a'], explanation: 'x', difficulty: 'EASY' as const, topicId: node.id, origin: 'AUTHORED' as const };
    const [q1, q2] = await db.insert(questions).values([{ ...qBase, stem: `q1 ${run}` }, { ...qBase, stem: `q2 ${run}` }]).returning();
    Object.assign(ids, { org: org.id, fam: fam.id, famB: famB.id, node: node.id, node2: node2.id, q1: q1.id, q2: q2.id });
  });

  afterAll(async () => {
    if (db && ids.org) {
      await db.delete(questions).where(inArray(questions.id, [ids.q1!, ids.q2!]));
      await db.delete(syllabusNodes).where(inArray(syllabusNodes.id, [ids.node!, ids.node2!]));
      await db.delete(competitionFamilies).where(inArray(competitionFamilies.id, [ids.fam!, ids.famB!]));
      await db.delete(organizations).where(eq(organizations.id, ids.org));
    }
    await close?.();
  });

  it('moves every kind of activity, resolving conflicts, then deletes the guest', async () => {
    const account = await newUser(false, { email: `merge-${run}@test.concours.tn` });
    const guest = await newUser(true);
    try {
      const [comp] = await db.insert(competitions).values({ familyId: ids.fam!, year: 2027, status: 'OPEN' }).returning();
      const [fact] = await db
        .insert(competitionFacts)
        .values({ familyId: ids.fam!, key: 'REQUIRED_DOCUMENT', displayAr: 'ب', displayFr: 'CIN' })
        .returning();

      // Account already has some state.
      await db.insert(mastery).values([
        { userId: account, nodeId: ids.node!, rating: 1000, attempts: 2, correct: 1 },
        { userId: account, nodeId: ids.node2!, rating: 1100, attempts: 9, correct: 8 },
      ]);
      await db.insert(userQuestionState).values({ userId: account, questionId: ids.q1!, timesSeen: 1, timesWrong: 1, lastCorrect: false, lastAnsweredAt: new Date('2026-01-01'), bookmarked: false });
      await db.update(userStats).set({ xpTotal: 100, streakCurrent: 1, streakLongest: 10, questionsAnswered: 50 }).where(eq(userStats.userId, account));
      await db.insert(enrollments).values({ userId: account, familyId: ids.fam!, isPrimary: true, dailyMinutes: 45 });
      await db.insert(usageCounters).values({ userId: account, date: '2026-10-07', questions: 5, tutor: 1 });
      await db.update(userProfiles).set({ diplomaLevel: 'BAC' }).where(eq(userProfiles.userId, account));
      await db.insert(notifications).values({ userId: account, type: 'CONCOURS_MATCH', title: 't', body: 'b', dedupeKey: `match:${comp.id}:x` });

      // Guest activity.
      const [att] = await db.insert(attempts).values({ userId: guest, kind: 'DIAGNOSTIC', questionIds: [ids.q1!, ids.q2!], submittedAt: new Date() }).returning();
      await db.insert(attemptAnswers).values({ attemptId: att.id, questionId: ids.q1!, answer: ['a'], isCorrect: true });
      await db.insert(mastery).values([
        { userId: guest, nodeId: ids.node!, rating: 1200, attempts: 6, correct: 5 }, // more attempts → wins
        { userId: guest, nodeId: ids.node2!, rating: 800, attempts: 1, correct: 0 }, // fewer → dropped
      ]);
      await db.insert(userQuestionState).values([
        { userId: guest, questionId: ids.q1!, timesSeen: 2, timesWrong: 0, lastCorrect: true, lastAnsweredAt: new Date('2026-10-01'), bookmarked: true },
        { userId: guest, questionId: ids.q2!, timesSeen: 1, timesWrong: 1, lastCorrect: false, lastAnsweredAt: new Date('2026-10-01') },
      ]);
      await db.insert(xpEvents).values({ userId: guest, amount: 30, reason: 'diag' });
      await db.update(userStats).set({ xpTotal: 30, streakCurrent: 3, streakLongest: 3, questionsAnswered: 24 }).where(eq(userStats.userId, guest));
      await db.insert(userBadges).values({ userId: guest, code: 'FIRST_STEP' });
      await db.insert(enrollments).values([
        { userId: guest, familyId: ids.fam!, isPrimary: true, dailyMinutes: 10 }, // conflicts with the account's → dropped
        { userId: guest, familyId: ids.famB!, isPrimary: false, dailyMinutes: 20 },
      ]);
      await db.insert(follows).values([{ userId: guest, familyId: ids.fam! }, { userId: guest, familyId: ids.famB! }]);
      await db.insert(usageCounters).values({ userId: guest, date: '2026-10-07', questions: 7, tutor: 2 });
      await db.insert(studyPlanDays).values({ userId: guest, date: '2026-10-07', items: [] });
      await db.insert(readinessSnapshots).values({ userId: guest, familyId: ids.fam!, date: '2026-10-07', preparation: 40, overall: 35, coverage: 50, label: 'NOT_READY' });
      await db.insert(userDocumentChecks).values({ userId: guest, factId: fact.id });
      await db.insert(physicalLogs).values({ userId: guest, testCode: 'RUN_1000M', value: 240, unit: 's' });
      await db.update(userProfiles).set({ birthDate: '2000-01-01', diplomaLevel: 'LICENCE', specialties: ['Droit'] }).where(eq(userProfiles.userId, guest));
      await db.insert(notifications).values([
        { userId: guest, type: 'CONCOURS_MATCH', title: 't', body: 'b', dedupeKey: `match:${comp.id}:x` }, // duplicate → dropped
        { userId: guest, type: 'SYSTEM', title: 'hello', body: 'b' },
      ]);
      await db.insert(alertMatches).values({ userId: guest, competitionId: comp.id, eligibility: { status: 'ELIGIBLE' } });

      await expect(merge.mergeGuestInto(guest, account)).resolves.toBe(true);

      expect(await db.select().from(users).where(eq(users.id, guest))).toHaveLength(0);
      const [a] = await db.select().from(attempts).where(eq(attempts.id, att.id));
      expect(a.userId).toBe(account);
      expect(await db.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, att.id))).toHaveLength(1);

      const m = await db.select().from(mastery).where(eq(mastery.userId, account));
      const byNode = Object.fromEntries(m.map((r) => [r.nodeId, r]));
      expect(byNode[ids.node!]).toMatchObject({ attempts: 6, rating: 1200 });
      expect(byNode[ids.node2!]).toMatchObject({ attempts: 9, rating: 1100 });

      const uqs = await db.select().from(userQuestionState).where(eq(userQuestionState.userId, account));
      const s1 = uqs.find((r) => r.questionId === ids.q1)!;
      expect(s1).toMatchObject({ timesSeen: 3, timesWrong: 1, lastCorrect: true, bookmarked: true });
      expect(s1.lastAnsweredAt?.toISOString().slice(0, 10)).toBe('2026-10-01');
      expect(uqs.find((r) => r.questionId === ids.q2)).toMatchObject({ timesSeen: 1, timesWrong: 1 });

      const [st] = await db.select().from(userStats).where(eq(userStats.userId, account));
      expect(st).toMatchObject({ xpTotal: 130, streakCurrent: 3, streakLongest: 10, questionsAnswered: 74 });
      expect(await db.select().from(xpEvents).where(eq(xpEvents.userId, account))).toHaveLength(1);
      expect(await db.select().from(userBadges).where(eq(userBadges.userId, account))).toHaveLength(1);

      const en = await db.select().from(enrollments).where(eq(enrollments.userId, account));
      expect(en).toHaveLength(2);
      expect(en.find((e) => e.familyId === ids.fam)).toMatchObject({ dailyMinutes: 45, isPrimary: true });
      expect(en.find((e) => e.familyId === ids.famB)).toMatchObject({ dailyMinutes: 20, isPrimary: false });
      expect(await db.select().from(follows).where(eq(follows.userId, account))).toHaveLength(2);

      const [uc] = await db.select().from(usageCounters).where(eq(usageCounters.userId, account));
      expect(uc).toMatchObject({ questions: 12, tutor: 3 });
      expect(await db.select().from(studyPlanDays).where(eq(studyPlanDays.userId, account))).toHaveLength(1);
      expect(await db.select().from(readinessSnapshots).where(eq(readinessSnapshots.userId, account))).toHaveLength(1);
      expect(await db.select().from(userDocumentChecks).where(eq(userDocumentChecks.userId, account))).toHaveLength(1);
      expect(await db.select().from(physicalLogs).where(eq(physicalLogs.userId, account))).toHaveLength(1);
      expect(await db.select().from(notifications).where(eq(notifications.userId, account))).toHaveLength(2);
      expect(await db.select().from(alertMatches).where(eq(alertMatches.userId, account))).toHaveLength(1);

      const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, account));
      expect(p).toMatchObject({ birthDate: '2000-01-01', diplomaLevel: 'BAC', specialties: ['Droit'] });
    } finally {
      await db.delete(users).where(inArray(users.id, [account, guest]));
    }
  });

  it('never merges or deletes a registered account, and deletes an idle guest without moving anything', async () => {
    const a = await newUser(false);
    const b = await newUser(false);
    const idle = await newUser(true);
    try {
      await expect(merge.mergeGuestInto(b, a)).resolves.toBe(false);
      expect(await db.select().from(users).where(eq(users.id, b))).toHaveLength(1);
      await expect(merge.mergeGuestInto(a, a)).resolves.toBe(false);

      await expect(merge.mergeGuestInto(idle, a)).resolves.toBe(false);
      expect(await db.select().from(users).where(eq(users.id, idle))).toHaveLength(0);
    } finally {
      await db.delete(users).where(inArray(users.id, [a, b, idle]));
    }
  });
});

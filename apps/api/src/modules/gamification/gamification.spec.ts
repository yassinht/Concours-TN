import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { XP, levelFromXp } from '@ctn/shared';
import { CommonModule } from '../../common/common.module';
import { tunisToday } from '../../common/dates';
import { SESSION_COOKIE, signSession } from '../../common/session';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import { attempts, competitionFamilies, organizations, userBadges, userStats, users, xpEvents } from '../../db/schema';
import { GamificationModule } from './gamification.module';
import { GamificationService } from './gamification.service';
import { displayedStreak, freezesAfter, leaderboardName, rankRows } from './gamification.util';
import { addDaysIso, tunisMidnightUtc, tunisParts, tunisWeekStartUtc } from './tunis-time';

const run = randomBytes(4).toString('hex');

describe('gamification helpers', () => {
  it('computes Africa/Tunis calendar boundaries', () => {
    // 23:30 UTC on Oct 7 is already Oct 8 in Tunis (UTC+1).
    expect(tunisParts(new Date('2026-10-07T23:30:00Z'))).toMatchObject({ date: '2026-10-08', hour: 0, weekday: 4 });
    expect(tunisMidnightUtc('2026-10-08').toISOString()).toBe('2026-10-07T23:00:00.000Z');
    // Wednesday 2026-10-07 → week starts Monday 2026-10-05 00:00 Tunis.
    expect(tunisWeekStartUtc(new Date('2026-10-07T12:00:00Z')).toISOString()).toBe('2026-10-04T23:00:00.000Z');
    // Sunday late evening still belongs to the same week; Monday 00:30 Tunis starts a new one.
    expect(tunisWeekStartUtc(new Date('2026-10-11T22:00:00Z')).toISOString()).toBe('2026-10-04T23:00:00.000Z');
    expect(tunisWeekStartUtc(new Date('2026-10-11T23:30:00Z')).toISOString()).toBe('2026-10-11T23:00:00.000Z');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('formats leaderboard names without leaking full names', () => {
    expect(leaderboardName('Amira Ben Salah')).toBe('Amira S.');
    expect(leaderboardName('  Sami  ')).toBe('Sami');
    expect(leaderboardName('محمد علي')).toBe('محمد ع.');
    expect(leaderboardName(null)).toBe('Candidat · مترشح');
  });

  it('ranks ties together and shows broken streaks as 0', () => {
    expect(rankRows([{ xp: 50 }, { xp: 40 }, { xp: 40 }, { xp: 10 }]).map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(displayedStreak(5, '2026-10-06', 0, '2026-10-07')).toBe(5);
    expect(displayedStreak(5, '2026-10-05', 1, '2026-10-07')).toBe(5);
    expect(displayedStreak(5, '2026-10-05', 0, '2026-10-07')).toBe(0);
    expect(freezesAfter(6, 7, 1)).toBe(2);
    expect(freezesAfter(6, 7, 3)).toBe(3);
    expect(freezesAfter(7, 1, 1)).toBe(1);
  });
});

describe('gamification (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let svc: GamificationService;
  const ids: string[] = [];
  const fx: { org?: string; fam?: string; famSlug: string; board?: string; boardSlug: string } = {
    famSlug: `gami-fam-${run}`,
    boardSlug: `gami-board-${run}`,
  };

  const newUser = async (name: string | null, isGuest = false) => {
    const [u] = await db
      .insert(users)
      .values({
        name,
        isGuest,
        email: isGuest ? null : `${name?.split(' ')[0].toLowerCase() ?? 'x'}-${ids.length}-${run}@test.concours.tn`,
        referralCode: `G${run}${ids.length}`.toUpperCase().slice(0, 12),
      })
      .returning();
    ids.push(u.id);
    return u.id;
  };
  const cookie = (id: string, isGuest = false) => `${SESSION_COOKIE}=${signSession({ id, role: 'USER', isGuest })}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DbModule, CommonModule, GamificationModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    app.use(cookieParser());
    await app.init();
    db = app.get<Database>(DB);
    svc = app.get(GamificationService);
    const [org] = await db.insert(organizations).values({ slug: `gami-org-${run}`, nameAr: 'م', nameFr: 'Org' }).returning();
    const [fam] = await db
      .insert(competitionFamilies)
      .values({ slug: fx.famSlug, organizationId: org.id, field: 'CUSTOMS', nameAr: 'ديوانة', nameFr: 'Douane' })
      .returning();
    const [board] = await db
      .insert(competitionFamilies)
      .values({ slug: fx.boardSlug, organizationId: org.id, field: 'SECURITY', nameAr: 'أمن', nameFr: 'Sécurité' })
      .returning();
    fx.org = org.id;
    fx.fam = fam.id;
    fx.board = board.id;
  });

  afterAll(async () => {
    if (db) {
      if (ids.length) await db.delete(users).where(inArray(users.id, ids));
      if (fx.fam) await db.delete(competitionFamilies).where(inArray(competitionFamilies.id, [fx.fam, fx.board ?? fx.fam]));
      if (fx.org) await db.delete(organizations).where(eq(organizations.id, fx.org));
    }
    await app?.close();
  });

  it('awards XP into xp_events and user_stats, ignoring zero amounts and never going below 0', async () => {
    const u = await newUser('Amira Ben Salah');
    expect(await svc.awardXp(u, XP.ANSWER + XP.CORRECT, 'CORRECT', fx.fam)).toBe(3);
    expect(await svc.awardXp(u, XP.MOCK_DONE, 'MOCK_DONE')).toBe(53);
    expect(await svc.awardXp(u, 0, 'NOOP')).toBe(53);
    const events = await db.select().from(xpEvents).where(eq(xpEvents.userId, u));
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.reason === 'CORRECT')?.familyId).toBe(fx.fam);
    expect(await svc.awardXp(u, -1000, 'CORRECTION')).toBe(0);
  });

  it('keeps a daily streak with freezes and a 7-day milestone bonus', async () => {
    const u = await newUser('Sami');
    const day = (n: number) => addDaysIso('2026-09-01', n);
    expect(await svc.touchStreak(u, day(0))).toBe(1);
    expect(await svc.touchStreak(u, day(0))).toBe(1); // same day counts once
    for (let i = 1; i < 7; i++) expect(await svc.touchStreak(u, day(i))).toBe(i + 1);
    let [s] = await db.select().from(userStats).where(eq(userStats.userId, u));
    expect(s).toMatchObject({ streakCurrent: 7, streakLongest: 7, streakFreezes: 2, lastActiveDate: day(6) });

    // One missed day is bridged by a freeze; an older date never resets the streak.
    expect(await svc.touchStreak(u, day(8))).toBe(8);
    expect(await svc.touchStreak(u, day(3))).toBe(8);
    [s] = await db.select().from(userStats).where(eq(userStats.userId, u));
    expect(s.streakFreezes).toBe(1);

    // Two missed days break it.
    expect(await svc.touchStreak(u, day(11))).toBe(1);
    [s] = await db.select().from(userStats).where(eq(userStats.userId, u));
    expect(s).toMatchObject({ streakCurrent: 1, streakLongest: 8 });
  });

  it('counts concurrent touches of the same day once', async () => {
    const u = await newUser('Concurrent');
    await svc.touchStreak(u, '2026-09-01');
    const results = await Promise.all(Array.from({ length: 5 }, () => svc.touchStreak(u, '2026-09-02')));
    expect(results.every((r) => r === 2)).toBe(true);
    const [s] = await db.select().from(userStats).where(eq(userStats.userId, u));
    expect(s.streakCurrent).toBe(2);
  });

  it('awards badges once, from stats and attempts', async () => {
    const u = await newUser('Badge Hunter');
    expect(await svc.checkBadges(u)).toEqual([]);

    await svc.incrementAnswered(u, 99);
    expect(await svc.checkBadges(u)).toEqual([]);
    await svc.incrementAnswered(u, 1);
    await svc.incrementAnswered(u, 0);
    await db.update(userStats).set({ streakLongest: 7, mistakesFixed: 50 }).where(eq(userStats.userId, u));
    await db.insert(attempts).values([
      { userId: u, kind: 'DIAGNOSTIC', questionIds: [], submittedAt: new Date(), score: 0.4 },
      { userId: u, kind: 'MOCK', questionIds: [], submittedAt: new Date(), score: 0.8 },
      { userId: u, kind: 'MOCK', questionIds: [], score: 1 }, // never submitted: does not count
    ]);
    expect(await svc.checkBadges(u)).toEqual(['FIRST_STEP', 'STREAK_7', 'Q_100', 'FIRST_MOCK', 'MOCK_80', 'MISTAKE_HUNTER']);
    expect(await svc.checkBadges(u)).toEqual([]);
    const owned = await db.select().from(userBadges).where(eq(userBadges.userId, u));
    expect(owned).toHaveLength(6);

    const v = await newUser('Low Mock');
    await db.insert(attempts).values({ userId: v, kind: 'MOCK', questionIds: [], submittedAt: new Date(), score: 0.79 });
    expect(await svc.checkBadges(v)).toEqual(['FIRST_MOCK']);
  });

  it('GET /me/gamification returns level, streak, badges and today XP', async () => {
    const u = await newUser('Leila Trabelsi');
    await svc.awardXp(u, 20, 'DAILY_GOAL');
    await svc.awardXp(u, 3, 'CORRECT');
    // XP from yesterday (Tunis) does not count toward today's goal.
    await db.insert(xpEvents).values({ userId: u, amount: 100, reason: 'OLD', createdAt: new Date(tunisMidnightUtc(tunisToday()).getTime() - 60_000) });
    await db.update(userStats).set({ xpTotal: 123 }).where(eq(userStats.userId, u));
    await svc.touchStreak(u);
    await db.insert(userBadges).values({ userId: u, code: 'FIRST_STEP' });

    const r = await request(app.getHttpServer()).get('/me/gamification').set('Cookie', cookie(u)).expect(200);
    const lvl = levelFromXp(123);
    expect(r.body).toEqual({
      xp: 123,
      level: lvl.level,
      levelProgress: { current: lvl.current, next: lvl.next },
      streak: { current: 1, longest: 1, freezes: 1 },
      badges: [{ code: 'FIRST_STEP', awardedAt: expect.any(String) }],
      todayXp: 23,
      dailyGoalXp: 30,
    });
    await request(app.getHttpServer()).get('/me/gamification').expect(401);
  });

  it('GET /leaderboard ranks registered users of a family this week, with my rank', async () => {
    const a = await newUser('Ahmed Kefi');
    const b = await newUser('Basma Jaziri');
    const c = await newUser('Chokri Mansour');
    const guest = await newUser(null, true);
    const gone = await newUser('Deleted User');
    await svc.awardXp(a, 30, 'CORRECT', fx.board);
    await svc.awardXp(b, 50, 'CORRECT', fx.board);
    await svc.awardXp(c, 10, 'CORRECT', fx.board);
    await svc.awardXp(c, 500, 'CORRECT'); // other family / no family: not in this scope
    await svc.awardXp(guest, 999, 'CORRECT', fx.board);
    await svc.awardXp(gone, 999, 'CORRECT', fx.board);
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone));
    // Last week's XP is outside the weekly window.
    await db.insert(xpEvents).values({ userId: a, familyId: fx.board, amount: 1000, reason: 'OLD', createdAt: new Date(tunisWeekStartUtc().getTime() - 1000) });

    const r = await request(app.getHttpServer()).get(`/leaderboard?familySlug=${fx.boardSlug}&period=week`).set('Cookie', cookie(c)).expect(200);
    expect(r.body).toEqual({
      period: 'week',
      familySlug: fx.boardSlug,
      top: [
        { rank: 1, name: 'Basma J.', xp: 50, isMe: false },
        { rank: 2, name: 'Ahmed K.', xp: 30, isMe: false },
        { rank: 3, name: 'Chokri M.', xp: 10, isMe: true },
      ],
      me: { rank: 3, xp: 10 },
    });

    const all = await request(app.getHttpServer()).get(`/leaderboard?familySlug=${fx.boardSlug}&period=all`).set('Cookie', cookie(c)).expect(200);
    expect(all.body.top.map((t: { name: string }) => t.name)).toEqual(['Ahmed K.', 'Basma J.', 'Chokri M.']);

    const asGuest = await request(app.getHttpServer()).get(`/leaderboard?familySlug=${fx.boardSlug}`).set('Cookie', cookie(guest, true)).expect(200);
    expect(asGuest.body.period).toBe('week');
    expect(asGuest.body.me).toBeNull();
    expect(asGuest.body.top.some((t: { isMe: boolean }) => t.isMe)).toBe(false);

    // Global all-time board: my rank is consistent with the totals.
    const global = await request(app.getHttpServer()).get('/leaderboard?period=all').set('Cookie', cookie(c)).expect(200);
    expect(global.body.me).toEqual({ rank: expect.any(Number), xp: 510 });
    expect(global.body.top.length).toBeLessThanOrEqual(20);

    await request(app.getHttpServer()).get(`/leaderboard?familySlug=nope-${run}`).set('Cookie', cookie(c)).expect(404);
    await request(app.getHttpServer()).get('/leaderboard?period=year').set('Cookie', cookie(c)).expect(400);
    const stale = await db.select().from(users).where(and(eq(users.id, gone)));
    expect(stale[0].deletedAt).toBeInstanceOf(Date);
    await request(app.getHttpServer()).get('/leaderboard').set('Cookie', cookie(gone)).expect(401);
  });
});

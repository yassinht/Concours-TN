import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { EditionDTO, FamilyDetailDTO, FamilySummaryDTO, SyllabusNodeDTO } from '@ctn/shared';
import { CommonModule } from '../../common/common.module';
import { SESSION_COOKIE, signSession } from '../../common/session';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import { competitionFamilies, competitions, lessons, mastery, syllabusNodes, userProfiles, users } from '../../db/schema';
import { tunisToday } from '../../common/dates';
import { EditionStatusJob } from './edition-status.job';
import { runSeed } from '../../db/seed';
import { CatalogModule } from './catalog.module';
import { effectiveStatus, foldText, likePattern, pickNextEdition } from './catalog.util';
import { editionsToIcs } from './ics';

const edition = (over: Partial<EditionDTO>): EditionDTO => ({
  id: over.id ?? randomBytes(4).toString('hex'), familySlug: 'f', familyName_ar: 'ع', familyName_fr: 'F', field: 'SECURITY', year: 2026,
  sessionLabel: null, status: 'EXPECTED', registrationOpen: null, registrationDeadline: null, examDate: null, positionsCount: null,
  candidatesCount: null, positionSlugs: [], announcementUrl: null, source: null, confidence: 'LOW', needsVerification: true, ...over,
});

describe('catalog helpers (pure)', () => {
  const today = '2026-10-07';

  it('pickNextEdition prefers OPEN, then upcoming ANNOUNCED/EXPECTED, else most recent', () => {
    const past = edition({ id: 'past', status: 'EXAM_DONE', year: 2025, examDate: '2025-04-13' });
    const expected = edition({ id: 'exp', status: 'EXPECTED', year: 2027, examDate: '2027-03-01' });
    const announced = edition({ id: 'ann', status: 'ANNOUNCED', year: 2026, examDate: '2026-12-01' });
    const open = edition({ id: 'open', status: 'OPEN', registrationDeadline: '2026-10-20' });
    expect(pickNextEdition([past, expected, announced, open], today)?.id).toBe('open');
    expect(pickNextEdition([past, expected, announced], today)?.id).toBe('ann');
    expect(pickNextEdition([past, expected], today)?.id).toBe('exp');
    expect(pickNextEdition([past, edition({ id: 'old', status: 'RESULTS', year: 2019 })], today)?.id).toBe('past');
    expect(pickNextEdition([], today)).toBeNull();
  });

  it('effectiveStatus closes stale OPEN editions and opens ANNOUNCED ones whose window started', () => {
    expect(effectiveStatus({ status: 'OPEN', registrationOpen: null, registrationDeadline: '2026-10-01' }, today)).toBe('CLOSED');
    expect(effectiveStatus({ status: 'ANNOUNCED', registrationOpen: '2026-10-01', registrationDeadline: '2026-10-30' }, today)).toBe('OPEN');
    expect(effectiveStatus({ status: 'EXPECTED', registrationOpen: '2026-10-01', registrationDeadline: '2026-10-30' }, today)).toBe('EXPECTED');
  });

  it('folds Arabic letter variants, diacritics and French accents for search', () => {
    expect(foldText('الأمْن')).toBe(foldText('الامن'));
    expect(foldText('Sûreté Générale')).toBe('surete generale');
    expect(likePattern('a')).toBeNull();
    expect(likePattern('50%_x')).toBe('%50\\%\\_x%');
  });

  it('renders a valid iCalendar feed with folded lines and an unverified label', () => {
    const ics = editionsToIcs(
      [edition({ id: 'e1', registrationDeadline: '2026-10-20', examDate: '2026-11-15', familyName_ar: 'مناظرة '.repeat(20), needsVerification: true })],
      'http://localhost:3000',
      new Date('2026-10-07T10:00:00Z'),
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261020');
    expect(ics).toContain('UID:e1-exam@concours-tn');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
    expect(ics.replace(/\r\n /g, '')).toContain('À vérifier');
  });
});

describe('catalog API (real DB)', () => {
  let app: INestApplication;
  let db: Database;
  let families: FamilySummaryDTO[];
  let userId: string;
  let cookie: string;
  const createdLessonIds: string[] = [];
  const createdEditionIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DbModule, CommonModule, CatalogModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    db = moduleRef.get<Database>(DB);

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(competitionFamilies);
    if (n === 0) await runSeed(db);

    const [u] = await db
      .insert(users)
      .values({ email: `catalog-${randomBytes(6).toString('hex')}@test.local`, isGuest: false, referralCode: `T${randomBytes(6).toString('hex').toUpperCase()}` })
      .returning({ id: users.id });
    userId = u.id;
    cookie = `${SESSION_COOKIE}=${signSession({ id: userId, role: 'USER', isGuest: false })}`;
  });

  afterAll(async () => {
    for (const id of createdLessonIds) await db.delete(lessons).where(eq(lessons.id, id));
    for (const id of createdEditionIds) await db.delete(competitions).where(eq(competitions.id, id));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await app?.close();
  });

  it('GET /catalog/families returns a non-empty, sorted, cacheable list', async () => {
    const res = await request(app.getHttpServer()).get('/catalog/families').expect(200);
    families = res.body;
    expect(Array.isArray(families)).toBe(true);
    expect(families.length).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const f = families[0];
    expect(f).toEqual(expect.objectContaining({ slug: expect.any(String), field: expect.any(String), name_ar: expect.any(String), name_fr: expect.any(String) }));
    expect(f.organization.slug).toEqual(expect.any(String));
    expect(typeof f.positionsCount).toBe('number');
    expect(typeof f.questionCount).toBe('number');
    // Open editions come first.
    const firstNotOpen = families.findIndex((x) => x.nextEdition?.status !== 'OPEN');
    if (firstNotOpen >= 0) expect(families.slice(firstNotOpen).every((x) => x.nextEdition?.status !== 'OPEN')).toBe(true);
  });

  it('filters families by field and rejects an invalid field', async () => {
    const field = families[0].field;
    const res = await request(app.getHttpServer()).get(`/catalog/families?field=${field}`).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((x: FamilySummaryDTO) => x.field === field)).toBe(true);
    await request(app.getHttpServer()).get('/catalog/families?field=NOPE').expect(400);
  });

  it('GET /catalog/families/:slug returns positions with provenance everywhere', async () => {
    const withPositions = families.find((f) => f.positionsCount > 0)!;
    const res = await request(app.getHttpServer()).get(`/catalog/families/${withPositions.slug}`).expect(200);
    const d: FamilyDetailDTO = res.body;
    expect(d.slug).toBe(withPositions.slug);
    expect(d.positions.length).toBeGreaterThan(0);
    const provenanceShape = expect.objectContaining({ confidence: expect.stringMatching(/^(HIGH|MEDIUM|LOW)$/), needsVerification: expect.any(Boolean) });
    for (const p of d.positions) {
      expect(p.eligibility).toEqual(provenanceShape);
      expect('source' in p.eligibility).toBe(true);
      p.phases.forEach((x) => expect(x).toEqual(provenanceShape));
      p.subjects.forEach((x) => expect(x).toEqual(provenanceShape));
      [...p.physicalTests, ...p.requiredDocuments].forEach((x) => expect(x).toEqual(expect.objectContaining({ id: expect.any(String), display_fr: expect.any(String), confidence: expect.any(String) })));
    }
    d.editions.forEach((e) => expect(e).toEqual(provenanceShape));
    expect(d.editions.length).toBeGreaterThan(0);
    expect(Array.isArray(d.sources)).toBe(true);
    expect(Array.isArray(d.syllabus)).toBe(true);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const sourced = d.editions.find((e) => e.source);
    if (sourced) expect(d.sources.some((s) => s.id === sourced.source!.id)).toBe(true);
  });

  it('returns 404 NOT_FOUND for an unknown family', async () => {
    const res = await request(app.getHttpServer()).get('/catalog/families/does-not-exist').expect(404);
    expect(res.body.message).toBe('NOT_FOUND');
  });

  it('POST /catalog/eligibility returns a result per position (explicit profile)', async () => {
    const slug = families.find((f) => f.positionsCount > 0)!.slug;
    const res = await request(app.getHttpServer())
      .post('/catalog/eligibility')
      .send({ familySlug: slug, profile: { birthDate: '1940-01-01', gender: 'M', diplomaLevel: 'NONE' } })
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const r of res.body) {
      expect(r).toEqual(expect.objectContaining({ positionSlug: expect.any(String), title_ar: expect.any(String), title_fr: expect.any(String) }));
      expect(['ELIGIBLE', 'NOT_ELIGIBLE', 'PARTIAL']).toContain(r.result.status);
      expect(r.provenance).toEqual(expect.objectContaining({ confidence: expect.any(String), needsVerification: expect.any(Boolean) }));
    }
    // Any failed known rule (an 86-year-old fails every max_age, a candidate without diploma every diploma rule) makes the
    // position NOT_ELIGIBLE; real rules may only set min_age, so the age check itself can pass.
    type R = { result: { status: string; checks: { code: string; status: string }[] } };
    for (const r of res.body as R[]) {
      const failed = r.result.checks.some((c) => c.status === 'FAIL');
      expect(r.result.status === 'NOT_ELIGIBLE').toBe(failed);
      const age = r.result.checks.find((c) => c.code === 'AGE');
      if (age) expect(['OK', 'FAIL']).toContain(age.status);
    }
  });

  it('POST /catalog/eligibility uses the saved profile of a logged-in user', async () => {
    const slug = families.find((f) => f.positionsCount > 0)!.slug;
    await db.insert(userProfiles).values({ userId, birthDate: '1940-01-01', gender: 'M', diplomaLevel: 'NONE' }).onConflictDoNothing();
    const anon = await request(app.getHttpServer()).post('/catalog/eligibility').send({ familySlug: slug }).expect(200);
    const mine = await request(app.getHttpServer()).post('/catalog/eligibility').set('Cookie', cookie).send({ familySlug: slug }).expect(200);
    // Anonymous: no profile data → nothing can FAIL. Logged in: the saved (old, no diploma) profile is used.
    expect(anon.body.every((r: { result: { status: string } }) => r.result.status !== 'NOT_ELIGIBLE')).toBe(true);
    const hasRules = mine.body.some((r: { result: { checks: unknown[] } }) => r.result.checks.length > 0);
    if (hasRules) expect(mine.body.some((r: { result: { status: string } }) => r.result.status === 'NOT_ELIGIBLE')).toBe(true);
  });

  it('POST /catalog/eligibility validates input and unknown positions', async () => {
    await request(app.getHttpServer()).post('/catalog/eligibility').send({}).expect(400);
    const slug = families[0].slug;
    await request(app.getHttpServer()).post('/catalog/eligibility').send({ familySlug: slug, positionSlug: 'nope' }).expect(404);
  });

  it('POST /catalog/eligibility/scan ranks families for a profile', async () => {
    const res = await request(app.getHttpServer())
      .post('/catalog/eligibility/scan')
      .send({ profile: { birthDate: '2004-01-15', gender: 'M', diplomaLevel: 'BAC', heightCm: 180, maritalStatus: 'SINGLE' } })
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    const rank = { ELIGIBLE: 0, PARTIAL: 1, NOT_ELIGIBLE: 2 } as const;
    const ranks = res.body.map((x: { best: keyof typeof rank }) => rank[x.best]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('GET /catalog/syllabus/:slug returns a nested tree with counts, and mastery for a session', async () => {
    const slug = families.find((f) => f.positionsCount > 0)!.slug;
    const anon = await request(app.getHttpServer()).get(`/catalog/syllabus/${slug}`).expect(200);
    const tree: SyllabusNodeDTO[] = anon.body;
    expect(tree.length).toBeGreaterThan(0);
    const withChildren = tree.find((n) => n.children && n.children.length > 0)!;
    expect(withChildren).toBeDefined();
    expect(withChildren.children!.every((c) => c.parentKey === withChildren.key)).toBe(true);
    expect(typeof withChildren.questionCount).toBe('number');
    expect(withChildren.mastery).toBeUndefined();

    const topic = withChildren.children![0];
    const [node] = await db.select({ id: syllabusNodes.id }).from(syllabusNodes).where(eq(syllabusNodes.key, topic.key));
    await db.insert(mastery).values({ userId, nodeId: node.id, rating: 1150, attempts: 20, correct: 16 }).onConflictDoNothing();
    const mine = await request(app.getHttpServer()).get(`/catalog/syllabus/${slug}`).set('Cookie', cookie).expect(200);
    expect(mine.headers['cache-control']).toBe('private, no-cache');
    const myRoot = (mine.body as SyllabusNodeDTO[]).find((n) => n.key === withChildren.key)!;
    const myTopic = myRoot.children!.find((c) => c.key === topic.key)!;
    expect(myTopic.mastery).toBeGreaterThan(0.5);
    expect(myRoot.mastery).toBe(myTopic.mastery);
    await request(app.getHttpServer()).get('/catalog/syllabus/does-not-exist').expect(404);
  });

  it('GET /catalog/lessons/:topicKey returns beta lessons flagged unreviewed', async () => {
    const [topic] = await db.select({ id: syllabusNodes.id, key: syllabusNodes.key }).from(syllabusNodes).where(and(eq(syllabusNodes.level, 'TOPIC'))).limit(1);
    const [l] = await db
      .insert(lessons)
      .values({ nodeId: topic.id, language: 'fr', title: `Test ${randomBytes(3).toString('hex')}`, bodyMd: '## Test', status: 'AI_REVIEWED' })
      .returning({ id: lessons.id });
    createdLessonIds.push(l.id);
    const res = await request(app.getHttpServer()).get(`/catalog/lessons/${topic.key}?lang=fr`).expect(200);
    expect(res.body.topic.key).toBe(topic.key);
    expect(res.body.topic.hasLesson).toBe(process.env.CONTENT_BETA_MODE !== 'false');
    if (process.env.CONTENT_BETA_MODE !== 'false') {
      expect(res.body.lessons.find((x: { id: string }) => x.id === l.id)).toEqual(expect.objectContaining({ unreviewed: true, estMinutes: 10 }));
    }
    await request(app.getHttpServer()).get('/catalog/lessons/unknown.topic').expect(404);
  });

  it('GET /catalog/editions returns calendar entries and an .ics feed', async () => {
    const res = await request(app.getHttpServer()).get('/catalog/editions?from=2000-01-01&to=2100-01-01').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toEqual(expect.objectContaining({ id: expect.any(String), familySlug: expect.any(String), status: expect.any(String), confidence: expect.any(String) }));
    const filtered = await request(app.getHttpServer()).get('/catalog/editions?status=OPEN,ANNOUNCED').expect(200);
    expect(filtered.body.every((e: EditionDTO) => e.status === 'OPEN' || e.status === 'ANNOUNCED')).toBe(true);
    await request(app.getHttpServer()).get('/catalog/editions?status=BAD').expect(400);
    const ics = await request(app.getHttpServer()).get('/catalog/editions.ics?from=2000-01-01&to=2100-01-01').expect(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text).toContain('BEGIN:VCALENDAR');
  });

  it('GET /catalog/search matches family names/keywords (hamza-insensitive) and topics', async () => {
    const f = families[0];
    const word = f.name_fr.split(/\s+/).find((w) => w.length >= 5) ?? f.name_fr.slice(0, 5);
    const res = await request(app.getHttpServer()).get(`/catalog/search?q=${encodeURIComponent(word)}`).expect(200);
    expect(res.body.families.some((x: FamilySummaryDTO) => x.slug === f.slug)).toBe(true);
    const topics = await request(app.getHttpServer()).get(`/catalog/search?q=${encodeURIComponent('Francais')}`).expect(200);
    expect(topics.body.topics.length).toBeGreaterThan(0);
    const empty = await request(app.getHttpServer()).get('/catalog/search?q=a').expect(200);
    expect(empty.body).toEqual({ families: [], topics: [] });
  });

  it('GET /catalog/stats returns landing counters', async () => {
    const res = await request(app.getHttpServer()).get('/catalog/stats').expect(200);
    expect(res.body).toEqual({ families: expect.any(Number), questions: expect.any(Number), sources: expect.any(Number), officialFacts: expect.any(Number) });
    expect(res.body.families).toBeGreaterThan(0);
  });

  it('EditionStatusJob aligns statuses with dates; families with an open edition sort first', async () => {
    const shift = (days: number) => new Date(Date.parse(`${tunisToday()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const fam = families[families.length - 1];
    const [{ id: familyId }] = await db.select({ id: competitionFamilies.id }).from(competitionFamilies).where(eq(competitionFamilies.slug, fam.slug));
    const tag = randomBytes(4).toString('hex');
    // alerts_sent_at is set so a concurrently running alert cron never notifies real users about these test rows.
    const [stale] = await db.insert(competitions)
      .values({ familyId, year: 2026, sessionLabel: `test-stale-${tag}`, status: 'OPEN', registrationDeadline: shift(-3), alertsSentAt: new Date() })
      .returning({ id: competitions.id });
    const [announced] = await db.insert(competitions)
      .values({ familyId, year: 2026, sessionLabel: `test-ann-${tag}`, status: 'ANNOUNCED', registrationOpen: shift(-2), registrationDeadline: shift(30), examDate: shift(60), alertsSentAt: new Date() })
      .returning({ id: competitions.id });
    createdEditionIds.push(stale.id, announced.id);

    const r = await app.get(EditionStatusJob).run();
    expect(r.closed).toContain(stale.id);
    expect(r.opened).toContain(announced.id);
    const [after] = await db.select({ status: competitions.status }).from(competitions).where(eq(competitions.id, announced.id));
    expect(after.status).toBe('OPEN');

    const list: FamilySummaryDTO[] = (await request(app.getHttpServer()).get('/catalog/families').expect(200)).body;
    const idx = list.findIndex((x) => x.slug === fam.slug);
    expect(list[idx].nextEdition?.id).toBe(announced.id);
    expect(list.slice(0, idx).every((x) => x.nextEdition?.status === 'OPEN')).toBe(true);
    const cal = await request(app.getHttpServer()).get('/catalog/editions?status=OPEN').expect(200);
    expect(cal.body.some((e: EditionDTO) => e.id === announced.id)).toBe(true);
    expect(cal.body.some((e: EditionDTO) => e.id === stale.id)).toBe(false);
  });
});

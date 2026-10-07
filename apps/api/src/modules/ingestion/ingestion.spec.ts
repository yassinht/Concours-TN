import 'reflect-metadata';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Anthropic from '@anthropic-ai/sdk';
import cookieParser from 'cookie-parser';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { CommonModule } from '../../common/common.module';
import { SESSION_COOKIE, signSession } from '../../common/session';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { DB, DbModule } from '../../db/db.module';
import {
  aiJobs, competitions, contentReviews, ingestCandidates, learningObjectives, questionObjectives, questions, sourceDocuments, sources,
  syllabusNodes, users, watchedSources,
} from '../../db/schema';
import { AiService } from '../ai/ai.service';
import { extractFirstJsonObject } from '../ai/ai.util';
import { NotificationsService } from '../notifications/notifications.service';
import { ALGO_KINDS, LATIN, generateAlgorithmic, makeRng } from './algorithmic';
import { findDates, heuristicExtract, normalizeAiProposal } from './extraction';
import { IngestionModule } from './ingestion.module';
import { PageFetcher, isPrivateAddress } from './page-fetcher';
import { QuestionGenerationService } from './question-generation.service';
import { findNearDuplicate, jaccard, tokenSet, validateStructure, type CandidateQuestion } from './question-validation';
import { chunkPage, foldForMatch, htmlToText, splitPages } from './text.util';
import { announcementBlocks, guessFamily } from './watch.util';

// ───────────── Test doubles ─────────────

const aiMock = { enabled: false, json: jest.fn(), modelId: (role: string) => `mock-${role}` };
const notificationsMock = { notifyMany: jest.fn(async () => 1), notify: jest.fn(async () => null) };
const fetcherMock = { fetchPage: jest.fn(), fetchDocument: jest.fn() };

@Global()
@Module({
  providers: [{ provide: AiService, useValue: aiMock }, { provide: NotificationsService, useValue: notificationsMock }],
  exports: [AiService, NotificationsService],
})
class GlobalMocksModule {}

const run = randomBytes(4).toString('hex');

/** Minimal valid PDF: one Helvetica text line per string; `null` = a page without any text (like a scan). */
function makePdf(pages: (string[] | null)[]): Buffer {
  const objs: string[] = ['', ''];
  const add = (body: string) => objs.push(body);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const lines of pages) {
    const stream = lines ? `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join(' ')} ET` : '';
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const AR_SAMPLE = `بلاغ
تعلن وزارة المالية عن فتح مناظرة خارجية لانتداب 120 رقيب ديوانة دورة نوفمبر 2026.
- أن يكون المترشح تونسي الجنسية.
- أن يكون سنه بين 18 و٣٠ سنة.
- أن يكون متحصلا على شهادة الباكالوريا.
آخر أجل لقبول الترشحات يوم ١٥ نوفمبر ٢٠٢٦.
تجرى الاختبارات الكتابية يوم 20 ديسمبر 2026 وهي إقصائية.
يتكون ملف الترشح من الوثائق التالية:
- نسخة من بطاقة التعريف الوطنية
- مضمون ولادة`;

const FR_SAMPLE = `Avis de concours
Les candidats doivent être âgés de 20 ans au moins et de 35 ans au plus.
Être titulaire d'une licence.
Date limite de dépôt des candidatures : le 30 septembre 2026.
Les épreuves écrites auront lieu le 18 octobre 2026.
Épreuve de culture générale : durée 2 heures, coefficient 2`;

// ───────────── Pure helpers ─────────────

describe('ingestion helpers (pure)', () => {
  it('reads Arabic and French dates, including Arabic-Indic digits and Tunisian month names', () => {
    expect(findDates('آخر أجل يوم ١٥/٠٦/٢٠٢٦').map((d) => d.iso)).toEqual(['2026-06-15']);
    expect(findDates('من 1 جوان 2026 إلى 30 جويلية 2026').map((d) => d.iso)).toEqual(['2026-06-01', '2026-07-30']);
    expect(findDates('le 1er août 2026 et le 31/02/2026').map((d) => d.iso)).toEqual(['2026-08-01']); // 31 Feb rejected
  });

  it('heuristic extraction finds dates, ages, diploma, phases and documents with verbatim quotes and pages', () => {
    const ar = heuristicExtract([{ page: 1, text: 'غلاف' }, { page: 2, text: AR_SAMPLE }]);
    expect(ar.editions[0]).toMatchObject({ registration_deadline: '2026-11-15', exam_date: '2026-12-20', positions_count: 120, year: 2026 });
    expect(ar.editions[0].field_quotes?.registration_deadline).toEqual({ source_quote: 'آخر أجل لقبول الترشحات يوم ١٥ نوفمبر ٢٠٢٦.', page: 2 });
    expect(ar.eligibility.min_age).toMatchObject({ value: 18, page: 2 });
    expect(ar.eligibility.max_age?.value).toBe(30);
    expect(ar.eligibility.nationality?.value).toBe('TN');
    expect(ar.eligibility.diplomas.map((d) => d.level)).toEqual(['BAC']);
    expect(ar.phases[0]).toMatchObject({ kind: 'WRITTEN', is_eliminatory: true });
    expect(ar.required_documents.map((d) => d.text)).toEqual(['نسخة من بطاقة التعريف الوطنية', 'مضمون ولادة']);
    for (const d of ar.required_documents) expect(AR_SAMPLE).toContain(d.source_quote);

    const fr = heuristicExtract(splitPages(FR_SAMPLE));
    expect(fr.editions[0]).toMatchObject({ registration_deadline: '2026-09-30', exam_date: '2026-10-18' });
    expect(fr.eligibility.min_age?.value).toBe(20);
    expect(fr.eligibility.max_age?.value).toBe(35);
    expect(fr.eligibility.diplomas[0].level).toBe('LICENCE');
    expect(fr.subjects[0]).toMatchObject({ domain: 'CULTURE_GENERALE', coefficient: 2, duration_minutes: 120 });
  });

  it('normalises AI output: drops quote-less items, flags quotes not found verbatim, fixes pages', () => {
    const pages = [{ page: 1, text: 'Intro' }, { page: 2, text: 'Les candidats doivent être âgés de 20 ans au moins.' }];
    const { body, stats } = normalizeAiProposal({
      editions: [{ year: 2026, registration_deadline: '2026-02-30', source_quote: 'invented sentence', page: 1 }],
      eligibility: { min_age: { value: 20, source_quote: 'âgés de 20 ans au moins', page: 1 }, max_age: { value: 35 } },
      phases: [{ kind: 'NOT_A_KIND', name: 'x', source_quote: 'Intro' }],
      required_documents: [{ text: 'CIN', source_quote: '' }],
    }, pages);
    expect(body.eligibility.min_age).toMatchObject({ value: 20, page: 2, quote_verified: true });
    expect(body.eligibility.max_age).toBeNull();
    expect(body.editions[0]).toMatchObject({ registration_deadline: null, quote_verified: false });
    expect(body.phases).toEqual([]);
    expect(body.required_documents).toEqual([]);
    expect(stats).toEqual({ dropped: 2, unverified: 1 });
  });

  it('turns HTML into lines and chunks pages without crossing them', () => {
    expect(htmlToText('<html><head><title>x</title><script>var a=1</script></head><body><h1>Concours&nbsp;2026</h1><p>Ligne&#32;1<br>Ligne 2</p><ul><li>A</li></ul></body></html>'))
      .toBe('Concours 2026\n\nLigne 1\nLigne 2\n\n- A'); // blank line = paragraph break (used by chunking)
    const long = Array.from({ length: 40 }, (_, i) => `Paragraphe numéro ${i} `.repeat(6)).join('\n\n');
    const chunks = chunkPage(long, 500);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
    expect(splitPages('p1\fp2\f\fp4').map((p) => p.page)).toEqual([1, 2, 4]);
    expect(foldForMatch('الإقصائيّة Épreuve')).toBe('الاقصاييه epreuve');
  });

  it('generates valid, correct-by-construction psychotechnical questions', () => {
    const rng = makeRng(20261007);
    for (const kind of ALGO_KINDS) {
      for (const language of ['ar', 'fr'] as const) {
        for (let i = 0; i < 60; i++) {
          const q = generateAlgorithmic(kind, rng, { language });
          const candidate: CandidateQuestion = { ...q, correct: [...q.correct], objectiveKey: null };
          expect(validateStructure(candidate)).toBeNull();
          const answer = q.options.find((o) => o.id === q.correct[0])!.text;
          // Bilingual explanation that ends on the computed answer.
          expect(q.explanation).toMatch(/[؀-ۿ]/);
          expect(q.explanation).toContain(answer);
          if (kind !== 'CODING') expect(q.explanation.trim().endsWith(`${answer}.`) || q.explanation.includes(`suivante est ${answer}`)).toBe(true);
        }
      }
    }
    // The number-series key really continues the shown terms for an arithmetic rule.
    const q = generateAlgorithmic('NUMBER_SERIES', makeRng(1), { difficulty: 'EASY', language: 'fr' });
    const terms = q.stem.replace(/[⁦⁩]/g, '').split('\n')[1].split(', ').slice(0, -1).map(Number);
    const answer = Number(q.options.find((o) => o.id === q.correct[0])!.text);
    const d = terms[1] - terms[0];
    if (terms.every((t, i) => i === 0 || t - terms[i - 1] === d)) expect(answer).toBe(terms[terms.length - 1] + d);
    else expect(answer).toBe(terms[terms.length - 1] * (terms[1] / terms[0]));
    expect(LATIN).toHaveLength(26);
  });

  it('validates MCQ structure and detects near-duplicates with token Jaccard', () => {
    const base: CandidateQuestion = {
      type: 'MCQ_SINGLE', stem: 'Quelle est la capitale de la Tunisie ?', options: [{ id: 'a', text: 'Tunis' }, { id: 'b', text: 'Sfax' }, { id: 'c', text: 'Sousse' }, { id: 'd', text: 'Gabès' }],
      correct: ['a'], explanation: 'Tunis est la capitale depuis 1956.', difficulty: 'EASY', objectiveKey: null,
    };
    expect(validateStructure(base)).toBeNull();
    expect(validateStructure({ ...base, options: base.options.slice(0, 3) })).toBe('STRUCTURE_OPTIONS_COUNT');
    expect(validateStructure({ ...base, correct: ['a', 'b'] })).toBe('STRUCTURE_CORRECT_COUNT');
    expect(validateStructure({ ...base, correct: ['z'] })).toBe('STRUCTURE_CORRECT_UNKNOWN');
    expect(validateStructure({ ...base, options: [...base.options.slice(0, 3), { id: 'd', text: 'tunis' }] })).toBe('STRUCTURE_OPTION_TEXT');
    expect(jaccard(tokenSet('A B C'), tokenSet('c, b; a!'))).toBe(1);
    const existing = [{ id: 'q1', tokens: tokenSet('Quelle est la capitale de la Tunisie?') }, { id: 'q2', tokens: tokenSet('Combien font 2 + 2 ?') }];
    expect(findNearDuplicate('Quelle est la capitale de la Tunisie ?', existing)?.id).toBe('q1');
    expect(findNearDuplicate('Quelle est la capitale du Maroc ?', existing)).toBeNull();
  });

  it('diffs watched pages into announcement blocks and guesses the family', () => {
    const v1 = 'الرئيسية\nمناظرة داخلية لترقية الأعوان سنة 2025\nاتصل بنا';
    const v2 = 'الرئيسية\nمناظرة خارجية لانتداب 50 رقيب ديوانة دورة 2026\nآخر أجل للترشح 30/11/2026\nمناظرة داخلية لترقية الأعوان سنة 2025\nاتصل بنا';
    const blocks = announcementBlocks(v1, v2, [{ text: 'مناظرة خارجية لانتداب 50 رقيب ديوانة', href: 'https://www.douane.gov.tn/avis.pdf' }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('مناظرة خارجية لانتداب 50 رقيب ديوانة دورة 2026\nآخر أجل للترشح 30/11/2026');
    expect(blocks[0].url).toBe('https://www.douane.gov.tn/avis.pdf');
    expect(announcementBlocks(v2, v2)).toEqual([]);
    expect(announcementBlocks(null, 'Concours\nRecrutement')).toEqual([]); // menu entries are not announcements

    const families = [
      { slug: 'douane', nameAr: 'الديوانة', nameFr: 'Douane', keywords: ['رقيب ديوانة', 'وزارة المالية'] },
      { slug: 'police', nameAr: 'الأمن', nameFr: 'Police', keywords: ['حافظ أمن', 'وزارة الداخلية'] },
      { slug: 'garde', nameAr: 'الحرس', nameFr: 'Garde', keywords: ['عريف', 'وزارة الداخلية'] },
    ];
    expect(guessFamily(blocks[0].text, families).slug).toBe('douane');
    expect(guessFamily('بلاغ وزارة الداخلية حول مناظرة', families).slug).toBeNull(); // shared keyword only: no guess
    expect(guessFamily('بلاغ وزارة الداخلية حول مناظرة', families, 'garde').slug).toBe('garde');
  });

  it('blocks internal addresses for the watcher fetcher', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('196.203.77.10')).toBe(false);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
  });
});

describe('AiService', () => {
  const fence = '```json\n{"ok": true, "text": "a } brace"}\n```';
  it('extracts the first JSON object from fenced or chatty output', () => {
    expect(JSON.parse(extractFirstJsonObject(fence)!)).toEqual({ ok: true, text: 'a } brace' });
    expect(JSON.parse(extractFirstJsonObject('Voici {pas du json} puis {"a": {"b": [1, 2]}} fin')!)).toEqual({ a: { b: [1, 2] } });
    expect(extractFirstJsonObject('no json here')).toBeNull();
  });

  it('retries once on 429, then parses the answer and reports usage', async () => {
    const previousKey = env().ANTHROPIC_API_KEY;
    env().ANTHROPIC_API_KEY = 'test-key';
    try {
      const svc = new AiService();
      const create = jest.fn()
        .mockRejectedValueOnce(new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers({ 'retry-after': '0' })))
        .mockResolvedValueOnce({ content: [{ type: 'text', text: `Sure.\n${fence}` }], stop_reason: 'end_turn', model: 'claude-test', usage: { input_tokens: 12, output_tokens: 7 } });
      svc.setClientForTesting({ messages: { create } } as unknown as Pick<Anthropic, 'messages'>);
      expect(svc.enabled).toBe(true);
      const r = await svc.json<{ ok: boolean }>({ model: 'content', system: 's', prompt: 'p' });
      expect(r).toEqual({ data: { ok: true, text: 'a } brace' }, model: 'claude-test', tokensIn: 12, tokensOut: 7 });
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[0][0]).toMatchObject({ model: env().AI_MODEL_CONTENT, system: 's' });

      const bad = jest.fn().mockRejectedValue(new Anthropic.BadRequestError(400, { type: 'error' }, 'bad', new Headers()));
      svc.setClientForTesting({ messages: { create: bad } } as unknown as Pick<Anthropic, 'messages'>);
      await expect(svc.json({ model: 'tutor', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(Anthropic.BadRequestError);
      expect(bad).toHaveBeenCalledTimes(1); // 4xx other than 429: no retry
    } finally {
      env().ANTHROPIC_API_KEY = previousKey;
    }
  });
});

// ───────────── HTTP (real database) ─────────────

describe('ingestion & ai endpoints', () => {
  let app: INestApplication;
  let db: Database;
  let generation: QuestionGenerationService;
  let uploadDir: string;
  let previousUploadDir: string;
  let admin: { id: string; cookie: string };
  let userCookie: string;
  const createdQuestionIds: string[] = [];
  const createdDocIds: string[] = [];
  let topicId: string | null = null;
  let watchId: string | null = null;

  async function makeUser(role: 'ADMIN' | 'USER') {
    const [u] = await db.insert(users).values({
      email: `ingest-${role.toLowerCase()}-${run}@test.local`, name: `Ingest ${role}`, role, isGuest: false, referralCode: `ING${role[0]}${run}`.toUpperCase(),
    }).returning({ id: users.id });
    return { id: u.id, cookie: `${SESSION_COOKIE}=${signSession({ id: u.id, role, isGuest: false })}` };
  }

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'ctn-ingest-'));
    previousUploadDir = env().UPLOAD_DIR;
    env().UPLOAD_DIR = uploadDir;
    const moduleRef = await Test.createTestingModule({ imports: [DbModule, CommonModule, GlobalMocksModule, IngestionModule] })
      .overrideProvider(PageFetcher)
      .useValue(fetcherMock)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    db = app.get(DB);
    generation = app.get(QuestionGenerationService);
    admin = await makeUser('ADMIN');
    userCookie = (await makeUser('USER')).cookie;
  });

  afterAll(async () => {
    await generation.whenIdle();
    if (createdQuestionIds.length) {
      await db.delete(contentReviews).where(inArray(contentReviews.entityId, createdQuestionIds));
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    if (topicId) await db.delete(syllabusNodes).where(eq(syllabusNodes.id, topicId));
    if (createdDocIds.length) await db.delete(sourceDocuments).where(inArray(sourceDocuments.id, createdDocIds));
    if (watchId) {
      const drafted = await db.select({ extracted: ingestCandidates.extracted }).from(ingestCandidates).where(eq(ingestCandidates.watchedSourceId, watchId));
      const compIds = drafted.map((d) => (d.extracted as { draft?: { competitionId: string } } | null)?.draft?.competitionId).filter((x): x is string => !!x);
      if (compIds.length) {
        const comps = await db.select({ sourceId: competitions.sourceId }).from(competitions).where(inArray(competitions.id, compIds));
        await db.delete(competitions).where(inArray(competitions.id, compIds));
        const srcIds = comps.map((c) => c.sourceId).filter((x): x is string => !!x);
        if (srcIds.length) await db.delete(sources).where(inArray(sources.id, srcIds));
      }
      await db.delete(ingestCandidates).where(eq(ingestCandidates.watchedSourceId, watchId));
      await db.delete(watchedSources).where(eq(watchedSources.id, watchId));
    }
    await db.delete(aiJobs).where(eq(aiJobs.createdBy, admin.id));
    env().UPLOAD_DIR = previousUploadDir;
    await rm(uploadDir, { recursive: true, force: true });
    await app.close();
  });

  it('is staff-only', async () => {
    await request(app.getHttpServer()).get('/admin/documents').expect(401);
    await request(app.getHttpServer()).get('/admin/documents').set('Cookie', userCookie).expect(403);
    // A token claiming ADMIN for a user whose DB role is USER is refused (role re-read from the database).
    const [plain] = await db.select({ id: users.id }).from(users).where(eq(users.email, `ingest-user-${run}@test.local`));
    const forged = `${SESSION_COOKIE}=${signSession({ id: plain.id, role: 'ADMIN', isGuest: false })}`;
    await request(app.getHttpServer()).get('/admin/documents').set('Cookie', forged).expect(403);
  });

  it('uploads a PDF, dedupes by sha256 and keeps page numbers on chunks', async () => {
    const pdf = makePdf([[`Avis de concours ${run}`, 'Date limite de depot : le 30/09/2026.'], [`Page deux ${run}`, 'Epreuves ecrites le 18/10/2026.']]);
    const res = await request(app.getHttpServer())
      .post('/admin/documents')
      .set('Cookie', admin.cookie)
      .attach('file', pdf, { filename: 'avis.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(res.body.duplicate).toBe(false);
    const doc = res.body.document;
    createdDocIds.push(doc.id);
    expect(doc).toMatchObject({ mime: 'application/pdf', pageCount: 2, ocrStatus: 'TEXT_LAYER', filename: 'avis.pdf' });
    expect(doc.chunks.map((c: { page: number }) => c.page)).toEqual([1, 2]);
    expect(doc.chunks[0].text).toContain(`Avis de concours ${run}`);
    expect(doc.chunks[1].text).toContain('18/10/2026');

    const again = await request(app.getHttpServer())
      .post('/admin/documents').set('Cookie', admin.cookie).attach('file', pdf, { filename: 'copy.pdf', contentType: 'application/pdf' }).expect(201);
    expect(again.body).toMatchObject({ duplicate: true, document: { id: doc.id } });

    const list = await request(app.getHttpServer()).get('/admin/documents?limit=200').set('Cookie', admin.cookie).expect(200);
    expect(list.body.items.find((d: { id: string }) => d.id === doc.id)).toMatchObject({ chunkCount: 2 });
    await request(app.getHttpServer()).get(`/admin/documents/${doc.id}`).set('Cookie', admin.cookie).expect(200);
  });

  it('flags PDFs without a text layer as NEEDS_OCR and rejects unsupported files', async () => {
    const scan = makePdf([null, null, [`${run}`.slice(0, 2)]]);
    const res = await request(app.getHttpServer())
      .post('/admin/documents').set('Cookie', admin.cookie).attach('file', scan, { filename: `scan-${run}.pdf`, contentType: 'application/pdf' }).expect(201);
    createdDocIds.push(res.body.document.id);
    expect(res.body.document).toMatchObject({ ocrStatus: 'NEEDS_OCR', pageCount: 3, chunks: [] });
    const extract = await request(app.getHttpServer()).post('/admin/ai/extract').set('Cookie', admin.cookie).send({ documentId: res.body.document.id }).expect(400);
    expect(extract.body.message).toBe('DOCUMENT_NEEDS_OCR');

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const bad = await request(app.getHttpServer())
      .post('/admin/documents').set('Cookie', admin.cookie).attach('file', png, { filename: 'x.png', contentType: 'image/png' }).expect(400);
    expect(bad.body.message).toBe('UNSUPPORTED_FILE_TYPE');
    const fake = await request(app.getHttpServer())
      .post('/admin/documents').set('Cookie', admin.cookie).attach('file', Buffer.from('not a pdf'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(400);
    expect(fake.body.message).toBe('INVALID_PDF');
    await request(app.getHttpServer()).post('/admin/documents').set('Cookie', admin.cookie).expect(400);
  });

  it('uploads an Arabic text file and extracts a heuristic DRAFT proposal from it (AI disabled)', async () => {
    const text = `مقدمة ${run}\f${AR_SAMPLE}\n${run}`;
    const up = await request(app.getHttpServer())
      .post('/admin/documents').set('Cookie', admin.cookie).attach('file', Buffer.from(text, 'utf8'), { filename: 'بلاغ.txt', contentType: 'text/plain' }).expect(201);
    createdDocIds.push(up.body.document.id);
    expect(up.body.document).toMatchObject({ mime: 'text/plain', language: 'ar', pageCount: 2, filename: 'بلاغ.txt' });

    const res = await request(app.getHttpServer())
      .post('/admin/ai/extract').set('Cookie', admin.cookie).send({ documentId: up.body.document.id, familySlug: 'douane' });
    if (res.status === 404) {
      expect(res.body.message).toBe('FAMILY_NOT_FOUND'); // catalog not seeded in this database
      return;
    }
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'EXTRACT_FACTS', status: 'DONE', promptVersion: 'heuristic-v1', model: null });
    const p = res.body.output;
    expect(p).toMatchObject({ status: 'DRAFT', method: 'HEURISTIC', family_slug: 'douane', document_id: up.body.document.id });
    expect(p.editions[0]).toMatchObject({ registration_deadline: '2026-11-15', page: 2 });
    expect(p.eligibility.max_age).toMatchObject({ value: 30, page: 2, quote_verified: true });
    expect(p.documents).toEqual(p.required_documents);

    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, res.body.id));
    expect(job.output).toMatchObject({ method: 'HEURISTIC' });
    const jobs = await request(app.getHttpServer()).get('/admin/ai/jobs?kind=EXTRACT_FACTS').set('Cookie', admin.cookie).expect(200);
    expect(jobs.body.some((j: { id: string }) => j.id === res.body.id)).toBe(true);
  });

  it('uses the AI extractor when enabled and verifies every quote against the text', async () => {
    aiMock.enabled = true;
    aiMock.json.mockResolvedValueOnce({
      data: {
        editions: [{ year: 2026, registration_deadline: '2026-09-30', source_quote: 'Date limite de dépôt des candidatures : le 30 septembre 2026.', page: 9 }],
        eligibility: { min_age: { value: 20, source_quote: 'âgés de 20 ans au moins', page: 1 }, max_age: { value: 40, source_quote: 'pas plus de 40 ans', page: 1 } },
        phases: [], subjects: [], required_documents: [],
      },
      model: 'mock-content', tokensIn: 900, tokensOut: 300,
    });
    try {
      const res = await request(app.getHttpServer()).post('/admin/ai/extract').set('Cookie', admin.cookie).send({ text: FR_SAMPLE }).expect(201);
      expect(res.body).toMatchObject({ promptVersion: 'extract-v1', model: 'mock-content', tokensIn: 900, tokensOut: 300 });
      const p = res.body.output;
      expect(p.method).toBe('AI');
      expect(p.editions[0]).toMatchObject({ page: 1, quote_verified: true });
      expect(p.eligibility.max_age).toMatchObject({ value: 40, quote_verified: false });
      expect(p.warnings.some((w: string) => w.startsWith('QUOTE_NOT_FOUND'))).toBe(true);
      const call = aiMock.json.mock.calls.at(-1)![0];
      expect(call.model).toBe('content');
      expect(call.system).toContain('verbatim');
      expect(call.prompt).toContain('<page n="1">');

      // AI failure → heuristic fallback, still a DRAFT proposal.
      aiMock.json.mockRejectedValueOnce(new Error('AI_INVALID_JSON'));
      const fb = await request(app.getHttpServer()).post('/admin/ai/extract').set('Cookie', admin.cookie).send({ text: FR_SAMPLE }).expect(201);
      expect(fb.body.output.method).toBe('HEURISTIC');
      expect(fb.body.output.warnings[0]).toMatch(/^AI_FAILED/);
    } finally {
      aiMock.enabled = false;
    }
    const missing = await request(app.getHttpServer()).post('/admin/ai/extract').set('Cookie', admin.cookie).send({}).expect(400);
    expect(missing.body.message).toBe('DOCUMENT_OR_TEXT_REQUIRED');
  });

  it('generates algorithmic questions as AI_REVIEWED without duplicates', async () => {
    const seed = randomInt(1, 2 ** 31 - 1);
    const res = await request(app.getHttpServer())
      .post('/admin/ai/generate-algorithmic').set('Cookie', admin.cookie).send({ kind: 'NUMBER_SERIES', count: 5, seed, language: 'fr' });
    if (res.status === 404) {
      expect(res.body.message).toBe('TOPIC_NOT_FOUND'); // syllabus not seeded in this database
      return;
    }
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'NUMBER_SERIES', topicKey: 'lo.suites-numeriques', requested: 5, inserted: 5 });
    createdQuestionIds.push(...res.body.questionIds);
    const rows = await db.select().from(questions).where(inArray(questions.id, res.body.questionIds));
    for (const q of rows) {
      expect(q).toMatchObject({ origin: 'ALGORITHMIC', status: 'AI_REVIEWED', type: 'MCQ_SINGLE', domain: 'LOGIC', language: 'fr', aiPromptVersion: 'algo-v1' });
      expect(q.extId).toMatch(/^algo:number_series:/);
      expect((q.options as unknown[]).length).toBe(4);
    }
    const links = await db.select().from(questionObjectives).where(inArray(questionObjectives.questionId, res.body.questionIds));
    expect(links.length).toBeGreaterThanOrEqual(5);

    const again = await request(app.getHttpServer())
      .post('/admin/ai/generate-algorithmic').set('Cookie', admin.cookie).send({ kind: 'NUMBER_SERIES', count: 5, seed, language: 'fr' }).expect(201);
    createdQuestionIds.push(...again.body.questionIds);
    expect(again.body.skippedDuplicates).toBeGreaterThanOrEqual(1);
    expect(again.body.questionIds.filter((id: string) => res.body.questionIds.includes(id))).toEqual([]);
  });

  it('runs AI question generation as a job: DRAFT insert, then structure / duplicate / blind-solve validation', async () => {
    const disabled = await request(app.getHttpServer())
      .post('/admin/ai/generate-questions').set('Cookie', admin.cookie).send({ topicKey: 'lo.analogies', count: 2 }).expect(400);
    expect(disabled.body.message).toBe('AI_DISABLED');

    const [node] = await db.insert(syllabusNodes).values({
      key: `test.gen.${run}`, level: 'TOPIC', domain: 'CULTURE_GENERALE', titleAr: 'اختبار', titleFr: 'Test génération', scope: 'SUGGESTED', status: 'DRAFT',
    }).returning({ id: syllabusNodes.id });
    topicId = node.id;
    const [objective] = await db.insert(learningObjectives).values({ key: `test.gen.${run}.o1`, nodeId: node.id, textAr: 'هدف', textFr: 'Objectif' }).returning({ id: learningObjectives.id });
    const [existing] = await db.insert(questions).values({
      type: 'MCQ_SINGLE', domain: 'CULTURE_GENERALE', language: 'fr', stem: `Quel fleuve traverse la ville de Paris ${run} ?`,
      options: [{ id: 'a', text: 'Seine' }, { id: 'b', text: 'Loire' }, { id: 'c', text: 'Rhône' }, { id: 'd', text: 'Garonne' }], correct: ['a'],
      explanation: 'La Seine traverse Paris.', difficulty: 'EASY', topicId: node.id, origin: 'AUTHORED', status: 'PUBLISHED',
    }).returning({ id: questions.id });
    createdQuestionIds.push(existing.id);

    const opts = (texts: string[]) => texts.map((text, i) => ({ id: 'abcd'[i], text }));
    const generated = [
      { type: 'MCQ_SINGLE', stem: `Combien de gouvernorats compte la Tunisie ${run} ?`, options: opts(['24', '23', '26', '20']), correct: ['a'], explanation: 'La Tunisie compte 24 gouvernorats ; 23, 26 et 20 sont faux.', difficulty: 'EASY', objective_key: `test.gen.${run}.o1` },
      { type: 'MCQ_SINGLE', stem: `Quelle est la plus haute montagne de Tunisie ${run} ?`, options: opts(['Jebel Chambi', 'Jebel Zaghouan', 'Jebel Ressas', 'Jebel Bou Kornine']), correct: ['b'], explanation: 'Clé volontairement fausse pour le test du solveur aveugle.', difficulty: 'MEDIUM', objective_key: 'unknown' },
      { type: 'MCQ_SINGLE', stem: `Quel fleuve traverse la ville de Paris ${run} ?`, options: opts(['Seine', 'Loire', 'Rhin', 'Meuse']), correct: ['a'], explanation: 'Doublon de la question existante.', difficulty: 'EASY' },
      { type: 'MCQ_SINGLE', stem: `Question avec trois options seulement ${run} ?`, options: opts(['x', 'y', 'z']), correct: ['a'], explanation: 'Structure invalide : trois options.', difficulty: 'EASY' },
      { stem: '', explanation: '' },
    ];
    aiMock.enabled = true;
    aiMock.json.mockReset();
    aiMock.json.mockImplementation(async (o: { system: string; prompt: string }) => {
      if (o.system.includes('solving')) {
        // Blind solver: only the two structurally valid, non-duplicate questions reach it (q1, q2).
        expect(o.prompt).not.toContain('Doublon');
        return { data: { answers: [{ id: 'q1', choice: 'a' }, { id: 'q2', choice: 'a' }] }, model: 'mock-content', tokensIn: 50, tokensOut: 10 };
      }
      expect(o.prompt).toContain('Objectif');
      expect(o.prompt).toContain('<examples>');
      return { data: { questions: generated }, model: 'mock-content', tokensIn: 1000, tokensOut: 800 };
    });
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/ai/generate-questions').set('Cookie', admin.cookie).send({ topicKey: `test.gen.${run}`, count: 5, language: 'fr' }).expect(202);
      expect(res.body).toMatchObject({ kind: 'GENERATE_QUESTIONS', status: 'QUEUED', promptVersion: 'gen-v1' });
      await generation.whenIdle();

      const job = await request(app.getHttpServer()).get(`/admin/ai/jobs/${res.body.id}`).set('Cookie', admin.cookie).expect(200);
      expect(job.body).toMatchObject({ status: 'DONE', tokensIn: 1050, tokensOut: 810 });
      const out = job.body.output;
      createdQuestionIds.push(...out.questionIds);
      expect(out).toMatchObject({ requested: 5, inserted: 4, aiReviewed: 1, draft: 3, discarded: 1 });
      expect(out.rejected.map((r: { reason: string }) => r.reason).sort()).toEqual(['BLIND_SOLVE_DISAGREES', 'NEAR_DUPLICATE', 'STRUCTURE_OPTIONS_COUNT']);

      const rows = await db.select().from(questions).where(inArray(questions.id, out.questionIds));
      const byStem = (s: string) => rows.find((r) => r.stem.startsWith(s))!;
      expect(byStem('Combien de gouvernorats')).toMatchObject({ status: 'AI_REVIEWED', origin: 'AI_GENERATED', aiModel: 'mock-content', aiPromptVersion: 'gen-v1' });
      const mountain = byStem('Quelle est la plus haute');
      expect(mountain.status).toBe('DRAFT');
      expect(mountain.tags).toContain('reject:blind_solve_disagrees');
      expect(mountain.explanation).toContain('Validation automatique');
      expect(byStem('Quel fleuve').tags).toContain('reject:near_duplicate');
      expect(byStem('Question avec trois').tags).toContain('reject:structure_options_count');
      const links = await db.select().from(questionObjectives).where(and(inArray(questionObjectives.questionId, out.questionIds), eq(questionObjectives.objectiveId, objective.id)));
      expect(links).toHaveLength(4); // unknown objective keys fall back to the topic's first objective
    } finally {
      aiMock.enabled = false;
      aiMock.json.mockReset();
    }
  });

  it('watches an official page, turns new announcement lines into candidates and drafts an unverified edition', async () => {
    const url = `https://www.douane.gov.tn/concours-${run}`;
    const page = (extra: string) => `<html><body><nav><a href="/">Concours</a></nav><ul>${extra}<li>مناظرة داخلية لترقية الأعوان ${run} سنة 2025</li></ul></body></html>`;
    let html = page('');
    fetcherMock.fetchPage.mockImplementation(async (u: string) => {
      if (u !== url) throw new Error('HTTP 404');
      return { url, status: 200, contentType: 'text/html; charset=utf-8', body: html };
    });
    notificationsMock.notifyMany.mockClear();

    const created = await request(app.getHttpServer())
      .post('/admin/watch').set('Cookie', admin.cookie).send({ url, label: `Douane ${run}`, familySlug: null }).expect(201);
    watchId = created.body.id;
    expect(created.body).toMatchObject({ url, active: true });

    const first = await request(app.getHttpServer()).post('/admin/watch/check-now').set('Cookie', admin.cookie).send({ ids: [watchId] }).expect(200);
    const mine = (b: { results: { id: string }[] }) => b.results.find((r) => r.id === watchId);
    expect(mine(first.body)).toMatchObject({ outcome: 'FIRST_SNAPSHOT', newCandidates: 1 });

    const unchanged = await request(app.getHttpServer()).post('/admin/watch/check-now').set('Cookie', admin.cookie).send({ ids: [watchId] }).expect(200);
    expect(mine(unchanged.body)).toMatchObject({ outcome: 'UNCHANGED', newCandidates: 0 });

    html = page(`<li><a href="/avis-${run}.pdf">مناظرة خارجية لانتداب 120 رقيب ديوانة ${run} دورة 2026</a></li><li>آخر أجل للترشح يوم 30/11/2026</li>`);
    const second = await request(app.getHttpServer()).post('/admin/watch/check-now').set('Cookie', admin.cookie).send({ ids: [watchId] }).expect(200);
    expect(mine(second.body)).toMatchObject({ outcome: 'CHANGED', newCandidates: 1 });
    expect(notificationsMock.notifyMany).toHaveBeenCalled();
    const [recipients, note] = notificationsMock.notifyMany.mock.calls.at(-1) as unknown as [string[], { url: string; type: string }];
    expect(recipients).toContain(admin.id);
    expect(note).toMatchObject({ url: '/admin/ingest', type: 'SYSTEM' });

    const list = await request(app.getHttpServer()).get('/admin/ingest?status=NEW').set('Cookie', admin.cookie).expect(200);
    const candidates = list.body.filter((c: { watchedSourceId: string }) => c.watchedSourceId === watchId);
    expect(candidates).toHaveLength(2);
    const fresh = candidates.find((c: { title: string }) => c.title.includes('رقيب ديوانة'));
    expect(fresh.url).toBe(`https://www.douane.gov.tn/avis-${run}.pdf`);
    expect(fresh.rawText).toContain('30/11/2026');
    expect(fresh.extracted.editions[0]).toMatchObject({ registration_deadline: '2026-11-30' });

    const watched = await request(app.getHttpServer()).get('/admin/watch').set('Cookie', admin.cookie).expect(200);
    expect(watched.body.find((w: { id: string }) => w.id === watchId)).toMatchObject({ newCandidates: 2, lastError: null });

    const old = candidates.find((c: { id: string }) => c.id !== fresh.id);
    const ignored = await request(app.getHttpServer()).post(`/admin/ingest/${old.id}/ignore`).set('Cookie', admin.cookie).expect(200);
    expect(ignored.body.status).toBe('IGNORED');

    if (fresh.familySlugGuess !== 'douane') {
      // Catalog not seeded in this database: no family to guess or draft into.
      const noFamily = await request(app.getHttpServer()).post(`/admin/ingest/${fresh.id}/draft`).set('Cookie', admin.cookie).send({}).expect(400);
      expect(noFamily.body.message).toBe('FAMILY_REQUIRED');
      return;
    }
    // Family defaults to the watcher's guess; the linked announcement is imported and analysed in the same call.
    fetcherMock.fetchDocument.mockImplementation(async (u: string) => ({
      url: u, contentType: 'text/plain; charset=utf-8', buffer: Buffer.from(`${AR_SAMPLE}\nمرجع ${run}`, 'utf8'),
    }));
    const draft = await request(app.getHttpServer()).post(`/admin/ingest/${fresh.id}/draft`).set('Cookie', admin.cookie).send({ importDocument: true });
    expect(draft.status).toBe(201);
    expect(draft.body.candidate.status).toBe('DRAFTED');
    expect(fetcherMock.fetchDocument).toHaveBeenCalledWith(`https://www.douane.gov.tn/avis-${run}.pdf`);
    expect(draft.body.import).toMatchObject({ error: null, document: { ocrStatus: 'TEXT_LAYER', duplicate: false } });
    createdDocIds.push(draft.body.import.document.id);
    const [importedDoc] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, draft.body.import.document.id));
    expect(importedDoc.sourceId).toBe(draft.body.competition.sourceId);
    const [extraction] = await db.select().from(aiJobs).where(eq(aiJobs.id, draft.body.import.extractionJobId));
    expect(extraction.output).toMatchObject({ method: 'HEURISTIC', family_slug: 'douane', editions: [{ registration_deadline: '2026-11-15' }] });
    expect(draft.body.competition).toMatchObject({
      familySlug: 'douane', year: 2026, status: 'ANNOUNCED', contentStatus: 'DRAFT', needsVerification: true, confidence: 'LOW',
      registrationDeadline: '2026-11-30', announcementUrl: `https://www.douane.gov.tn/avis-${run}.pdf`,
    });
    const [src] = await db.select().from(sources).where(eq(sources.id, draft.body.competition.sourceId));
    expect(src).toMatchObject({ sourceType: 'OFFICIAL', confidence: 'LOW', publisher: 'www.douane.gov.tn' });
    const again = await request(app.getHttpServer()).post(`/admin/ingest/${fresh.id}/draft`).set('Cookie', admin.cookie).send({ familySlug: 'douane' }).expect(409);
    expect(again.body.message).toBe('ALREADY_DRAFTED');

    // Fetch failures are recorded on the watcher, not thrown.
    fetcherMock.fetchPage.mockRejectedValue(new Error('HTTP 503'));
    html = 'changed';
    const failing = await request(app.getHttpServer()).post('/admin/watch/check-now').set('Cookie', admin.cookie).send({ ids: [watchId] }).expect(200);
    expect(mine(failing.body)).toMatchObject({ outcome: 'ERROR', error: 'HTTP 503' });
    const [w] = await db.select().from(watchedSources).where(eq(watchedSources.id, watchId!));
    expect(w.lastError).toBe('HTTP 503');
    await request(app.getHttpServer()).patch(`/admin/watch/${watchId}`).set('Cookie', admin.cookie).send({ active: false }).expect(200);
  });
});

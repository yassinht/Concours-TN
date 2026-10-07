import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  DIFFICULTIES, DIFFICULTY_RATING, DOMAINS, QUESTION_ORIGINS, QUESTION_TYPES,
  type ContentStatus, type Difficulty, type Domain, type QuestionOrigin, type QuestionType,
} from '@ctn/shared';
import { competitionFamilies, contentReviews, questionFamilies, questionObjectives, questions } from '../schema';
import { errorMessage, type SeedLog } from './log';
import { InvalidItem, arr, intIn, isObj, isoDate, oneOf, oneOfOrNull, reqStr, str, strArr } from './normalize';
import { sourceResolver, upsertFileSources, type SourceRef } from './sources';
import type { SyllabusSeeder } from './syllabus';
import type { Db } from './types';

/** Statuses set by a human (or an explicit admin action) that a re-seed must never override. */
const HUMAN_STATUSES: ContentStatus[] = ['HUMAN_REVIEWED', 'PUBLISHED', 'ARCHIVED'];

type Option = { id: string; text: string; side?: 'left' | 'right' };

interface QuestionInput {
  extId: string;
  type: QuestionType;
  domain: Domain;
  language: 'ar' | 'fr' | 'en';
  stem: string;
  options: Option[];
  correct: unknown;
  explanation: string;
  difficulty: Difficulty;
  topicId: string;
  objectiveKeys: string[];
  familySlugs: string[];
  isGeneral: boolean;
  origin: QuestionOrigin;
  sourceId: string | null;
  year: number | null;
  validUntil: string | null;
  tags: string[];
}

export function bankName(file: string, data: Record<string, unknown>): string {
  return str(data.bank) ?? path.basename(file, '.json');
}

/** Phase 1 (before competitions): bank sources and the bank's shared specialty syllabus nodes. */
export async function seedBankSyllabus(db: Db, file: string, data: unknown, syl: SyllabusSeeder, log: SeedLog): Promise<void> {
  const ctx = `questions/${path.basename(file)}`;
  if (!isObj(data)) {
    log.warn(ctx, 'not an object — skipped');
    return;
  }
  const bank = bankName(file, data);
  const sourceMap = await upsertFileSources(db, `bank:${bank}`, data.sources, log, ctx);
  const resolve = sourceResolver(sourceMap, log, ctx);
  const defaultDomain = oneOfOrNull<Domain>(data.domain, DOMAINS) ?? 'SPECIALTY';
  await syl.upsertMany(db, arr(data.specialty_syllabus), {
    familyId: null, defaultDomain, defaultScope: 'SUGGESTED', sourceIdOf: (k) => resolve(k)?.id ?? null, ctx,
  });
}

/** Shared state for phase 2 (questions), loaded once. */
export class QuestionSeeder {
  private families = new Map<string, string>();
  private objectives = new Map<string, string>();
  private existing = new Map<string, { id: string; status: ContentStatus; version: number; attempts: number }>();
  private reviewed = new Set<string>();
  private readonly seenExtIds = new Map<string, string>();

  constructor(private readonly syl: SyllabusSeeder, private readonly log: SeedLog) {}

  async load(db: Db): Promise<void> {
    const fams = await db.select({ id: competitionFamilies.id, slug: competitionFamilies.slug }).from(competitionFamilies);
    this.families = new Map(fams.map((f) => [f.slug, f.id]));
    this.objectives = await this.syl.objectiveIds(db);
    const rows = await db
      .select({ id: questions.id, extId: questions.extId, status: questions.status, version: questions.version, attempts: questions.attemptsCount })
      .from(questions);
    this.existing = new Map(rows.filter((r) => r.extId).map((r) => [r.extId!, { id: r.id, status: r.status, version: r.version, attempts: r.attempts }]));
    const reviews = await db.selectDistinct({ id: contentReviews.entityId }).from(contentReviews).where(eq(contentReviews.entityType, 'question'));
    this.reviewed = new Set(reviews.map((r) => r.id));
  }

  async seedBank(db: Db, file: string, data: unknown): Promise<void> {
    const ctx = `questions/${path.basename(file)}`;
    const warn = this.log.scoped(ctx);
    if (!isObj(data)) return;
    const bank = bankName(file, data);
    const sourceMap = await upsertFileSources(db, `bank:${bank}`, data.sources, this.log, ctx);
    const resolve = sourceResolver(sourceMap, this.log, ctx);
    const bankDomain = oneOfOrNull<Domain>(data.domain, DOMAINS, warn, 'bank.domain');

    await db.transaction(async (tx) => {
      for (const [i, raw] of arr(data.questions).entries()) {
        let q: QuestionInput;
        try {
          q = this.normalize(raw, bankDomain, resolve, warn);
        } catch (e) {
          const id = isObj(raw) ? str(raw.id) : null;
          warn(`question ${id ?? `#${i + 1}`} skipped (${errorMessage(e)})`);
          this.log.inc('skipped.questions');
          continue;
        }
        const prevFile = this.seenExtIds.get(q.extId);
        if (prevFile) warn(`question id "${q.extId}" already defined in ${prevFile} — this definition wins`);
        this.seenExtIds.set(q.extId, ctx);
        try {
          const created = await tx.transaction((sp) => this.upsert(sp, q, warn));
          // Cached only once the savepoint is released (a rolled-back insert must not be referenced later).
          if (created) this.existing.set(q.extId, created);
        } catch (e) {
          warn(`question ${q.extId} failed (${errorMessage(e)})`);
          this.log.inc('skipped.questions');
        }
      }
    });
  }

  private normalize(raw: unknown, bankDomain: Domain | null, resolve: (k: unknown) => SourceRef | null, warn: (m: string) => void): QuestionInput {
    if (!isObj(raw)) throw new InvalidItem('not an object');
    const extId = reqStr(raw.id, 'id');
    const type = oneOfOrNull<QuestionType>(raw.type, QUESTION_TYPES);
    if (!type) throw new InvalidItem(`invalid type "${String(raw.type)}"`);
    const topicKey = reqStr(raw.topic_key, 'topic_key');
    const topicId = this.syl.idOf(topicKey);
    if (!topicId) throw new InvalidItem(`unknown topic_key "${topicKey}"`);
    const stem = reqStr(raw.stem, 'stem');
    const explanation = reqStr(raw.explanation, 'explanation');
    // The topic is authoritative for the domain (practice filters by both); the bank's domain is only a fallback.
    const topicDomain = this.syl.domainOf(topicKey);
    const explicit = oneOfOrNull<Domain>(raw.domain, DOMAINS, warn, `domain of ${extId}`);
    if (explicit && topicDomain && explicit !== topicDomain) warn(`question ${extId}: domain ${explicit} differs from its topic's (${topicDomain}), using the topic's`);
    const domain = topicDomain ?? explicit ?? bankDomain ?? 'SPECIALTY';
    const lang = str(raw.language)?.toLowerCase();
    const language = lang === 'ar' || lang === 'fr' || lang === 'en' ? lang : /[؀-ۿ]/.test(stem) ? 'ar' : 'fr';
    if (lang !== language) warn(`question ${extId}: invalid language "${lang ?? ''}", inferred "${language}"`);
    const { options, correct } = validateAnswer(type, raw.options, raw.correct, language);

    const objectiveKeys = [...new Set([...strArr(raw.objective_keys), ...(str(raw.objective_key) ? [str(raw.objective_key)!] : [])])];
    const families = strArr(raw.families);
    const familyList = families.length ? families : ['*'];
    return {
      extId, type, domain, language, stem, options, correct, explanation,
      difficulty: oneOf<Difficulty>(raw.difficulty, DIFFICULTIES, 'MEDIUM', warn, `difficulty of ${extId}`),
      topicId, objectiveKeys,
      familySlugs: familyList.filter((f) => f !== '*'),
      isGeneral: familyList.includes('*'),
      origin: oneOf<QuestionOrigin>(raw.origin, QUESTION_ORIGINS, 'AI_GENERATED', warn, `origin of ${extId}`),
      sourceId: resolve(raw.source_key)?.id ?? null,
      year: intIn(raw.year, 1950, 2100, warn, `year of ${extId}`),
      validUntil: isoDate(raw.valid_until, warn, `valid_until of ${extId}`),
      tags: [...new Set(strArr(raw.tags))],
    };
  }

  /** Returns the cache entry of a newly inserted question (null when it already existed). */
  private async upsert(db: Db, q: QuestionInput, warn: (m: string) => void): Promise<{ id: string; status: ContentStatus; version: number; attempts: number } | null> {
    const prev = this.existing.get(q.extId);
    if (prev && prev.version > 1) {
      // An editor changed this question in the admin: the bank file no longer owns its content.
      this.log.inc('kept.questionsEditedByAdmin');
      return null;
    }
    const keepStatus = prev && (HUMAN_STATUSES.includes(prev.status) || this.reviewed.has(prev.id));
    // Seeded content is never published: AI-written and research-team material waits for a human reviewer.
    const status: ContentStatus = keepStatus ? prev!.status : 'AI_REVIEWED';
    const content = {
      type: q.type, domain: q.domain, language: q.language, stem: q.stem, options: q.options, correct: q.correct as object,
      explanation: q.explanation, difficulty: q.difficulty, topicId: q.topicId, isGeneral: q.isGeneral, origin: q.origin,
      sourceId: q.sourceId, year: q.year, validUntil: q.validUntil, tags: q.tags, status,
    };
    let id: string;
    if (prev) {
      id = prev.id;
      await db
        .update(questions)
        .set({ ...content, ...(prev.attempts > 0 ? {} : { rating: DIFFICULTY_RATING[q.difficulty] }), updatedAt: new Date() })
        .where(eq(questions.id, id));
      this.log.inc('updated.questions');
    } else {
      const [row] = await db.insert(questions).values({ extId: q.extId, ...content, rating: DIFFICULTY_RATING[q.difficulty] }).returning({ id: questions.id });
      id = row.id;
      this.log.inc('created.questions');
    }

    const objectiveIds = q.objectiveKeys.map((k) => {
      const oid = this.objectives.get(k);
      if (!oid) warn(`question ${q.extId}: unknown objective_key "${k}"`);
      return oid;
    }).filter((x): x is string => !!x);
    await db.delete(questionObjectives).where(eq(questionObjectives.questionId, id));
    if (objectiveIds.length) await db.insert(questionObjectives).values(objectiveIds.map((objectiveId) => ({ questionId: id, objectiveId })));

    const familyIds = q.familySlugs.map((s) => {
      const fid = this.families.get(s);
      if (!fid) warn(`question ${q.extId}: unknown family "${s}"`);
      return fid;
    }).filter((x): x is string => !!x);
    await db.delete(questionFamilies).where(eq(questionFamilies.questionId, id));
    if (familyIds.length) await db.insert(questionFamilies).values([...new Set(familyIds)].map((familyId) => ({ questionId: id, familyId })));
    return prev ? null : { id, status, version: 1, attempts: 0 };
  }
}

function parseOptions(rawOptions: unknown, type: QuestionType): Option[] {
  const options: Option[] = [];
  const ids = new Set<string>();
  for (const o of arr(rawOptions)) {
    if (!isObj(o)) throw new InvalidItem('option is not an object');
    const id = reqStr(o.id, 'option.id');
    if (ids.has(id)) throw new InvalidItem(`duplicate option id "${id}"`);
    ids.add(id);
    const text = reqStr(o.text, 'option.text');
    const side = str(o.side);
    if (type === 'MATCHING') {
      if (side !== 'left' && side !== 'right') throw new InvalidItem(`MATCHING option "${id}" needs side left|right`);
      options.push({ id, text, side });
    } else options.push({ id, text });
  }
  return options;
}

/** Validates options/correct for each question type; returns normalized values or throws InvalidItem. */
export function validateAnswer(type: QuestionType, rawOptions: unknown, rawCorrect: unknown, language: 'ar' | 'fr' | 'en'): { options: Option[]; correct: unknown } {
  let options = parseOptions(rawOptions, type);
  const ids = () => new Set(options.map((o) => o.id));
  const asIdList = (v: unknown): string[] => (typeof v === 'string' ? [v] : strArr(v));

  switch (type) {
    case 'MCQ_SINGLE':
    case 'MCQ_MULTI':
    case 'TRUE_FALSE': {
      let correct = asIdList(rawCorrect);
      if (type === 'TRUE_FALSE') {
        if (typeof rawCorrect === 'boolean') correct = [rawCorrect ? 'true' : 'false'];
        if (!options.length) {
          const labels = language === 'ar' ? ['صحيح', 'خطأ'] : language === 'en' ? ['True', 'False'] : ['Vrai', 'Faux'];
          options = [{ id: 'true', text: labels[0] }, { id: 'false', text: labels[1] }];
        }
        if (options.length !== 2) throw new InvalidItem('TRUE_FALSE needs exactly 2 options');
      } else if (options.length < 2) throw new InvalidItem('MCQ needs at least 2 options');
      const known = ids();
      correct = [...new Set(correct)];
      if (!correct.length) throw new InvalidItem('missing correct answer');
      const unknown = correct.filter((c) => !known.has(c));
      if (unknown.length) throw new InvalidItem(`correct references unknown option(s) ${unknown.join(',')}`);
      if (type !== 'MCQ_MULTI' && correct.length !== 1) throw new InvalidItem(`${type} needs exactly one correct option`);
      return { options, correct };
    }
    case 'NUMERIC': {
      const c = isObj(rawCorrect) ? rawCorrect : { value: rawCorrect };
      const value = typeof c.value === 'number' ? c.value : typeof c.value === 'string' ? Number(c.value.replace(',', '.')) : NaN;
      if (!Number.isFinite(value)) throw new InvalidItem('NUMERIC needs correct.value');
      const tol = c.tolerance == null ? 0 : Number(c.tolerance);
      if (!Number.isFinite(tol) || tol < 0) throw new InvalidItem('invalid NUMERIC tolerance');
      return { options: [], correct: { value, tolerance: tol } };
    }
    case 'MATCHING': {
      if (!isObj(rawCorrect) || !Array.isArray(rawCorrect.pairs)) throw new InvalidItem('MATCHING needs correct.pairs');
      const left = new Set(options.filter((o) => o.side === 'left').map((o) => o.id));
      const right = new Set(options.filter((o) => o.side === 'right').map((o) => o.id));
      if (left.size < 2 || right.size < 2) throw new InvalidItem('MATCHING needs at least 2 left and 2 right options');
      const pairs: [string, string][] = [];
      const usedLeft = new Set<string>();
      for (const p of rawCorrect.pairs) {
        if (!Array.isArray(p) || p.length !== 2) throw new InvalidItem('invalid MATCHING pair');
        const [l, r] = [String(p[0]), String(p[1])];
        if (!left.has(l) || !right.has(r)) throw new InvalidItem(`MATCHING pair ${l}→${r} references unknown options`);
        if (usedLeft.has(l)) throw new InvalidItem(`MATCHING left option "${l}" paired twice`);
        usedLeft.add(l);
        pairs.push([l, r]);
      }
      if (usedLeft.size !== left.size) throw new InvalidItem('every left option must be paired');
      return { options, correct: { pairs } };
    }
    case 'ORDERING': {
      const order = isObj(rawCorrect) ? strArr(rawCorrect.order) : strArr(rawCorrect);
      const known = ids();
      if (options.length < 2) throw new InvalidItem('ORDERING needs at least 2 options');
      if (order.length !== known.size || new Set(order).size !== order.length || order.some((o) => !known.has(o))) {
        throw new InvalidItem('ORDERING correct.order must be a permutation of the option ids');
      }
      return { options, correct: { order } };
    }
  }
}


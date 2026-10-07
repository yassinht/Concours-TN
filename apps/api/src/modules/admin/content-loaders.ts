import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ContentStatus, Difficulty, Domain, QuestionType } from '@ctn/shared';
import type { Database } from '../../db/client';
import {
  competitionFamilies, contentReviews, learningObjectives, lessons, questionFamilies, questionObjectives, questionReports, questions,
  sources, syllabusNodes, users,
} from '../../db/schema';
import { iso } from './admin.util';

export interface PersonRef { id: string; name: string | null }

export interface LastReview { fromStatus: string | null; toStatus: string; comment: string | null; at: string; reviewer: PersonRef | null }

export interface AdminSourceRef {
  id: string; title: string; url: string | null; publisher: string | null; sourceType: string; confidence: string;
  publicationDate: string | null; lastVerifiedAt: string | null;
}

export interface AdminQuestionDetail {
  entity: 'question';
  id: string; extId: string | null; status: ContentStatus; version: number;
  type: QuestionType; domain: Domain; language: string; difficulty: Difficulty; rating: number;
  stem: string; options: { id: string; text: string; side?: 'left' | 'right' }[]; correct: unknown; explanation: string;
  topic: { key: string; title_ar: string; title_fr: string; level: string };
  objectives: { key: string; text_ar: string; text_fr: string }[];
  families: { slug: string; name_ar: string; name_fr: string }[];
  isGeneral: boolean; origin: string; year: number | null; validUntil: string | null; tags: string[];
  source: AdminSourceRef | null;
  ai: { model: string; promptVersion: string | null } | null;
  createdBy: PersonRef | null; reviewedBy: PersonRef | null; reviewedAt: string | null;
  stats: { attempts: number; correct: number; accuracy: number | null; openReports: number };
  lastReview: LastReview | null;
  createdAt: string; updatedAt: string;
}

export interface AdminLessonDetail {
  entity: 'lesson';
  id: string; status: ContentStatus; version: number; language: string; title: string; bodyMd: string; estMinutes: number; origin: string;
  topic: { key: string; title_ar: string; title_fr: string; domain: Domain };
  reviewedBy: PersonRef | null; lastReview: LastReview | null; updatedAt: string;
}

export const sourceRefCols = {
  id: sources.id, title: sources.title, url: sources.url, publisher: sources.publisher, sourceType: sources.sourceType,
  confidence: sources.confidence, publicationDate: sources.publicationDate, lastVerifiedAt: sources.lastVerifiedAt,
};

type SourceRefRow = { id: string | null; title: string | null; url: string | null; publisher: string | null; sourceType: string | null; confidence: string | null; publicationDate: string | null; lastVerifiedAt: Date | null };

export function toSourceRef(s: SourceRefRow | null | undefined): AdminSourceRef | null {
  if (!s || !s.id) return null;
  return {
    id: s.id, title: s.title ?? '', url: s.url, publisher: s.publisher, sourceType: s.sourceType ?? 'SUGGESTED', confidence: s.confidence ?? 'LOW',
    publicationDate: s.publicationDate, lastVerifiedAt: iso(s.lastVerifiedAt),
  };
}

export async function peopleByIds(db: Database, ids: (string | null | undefined)[]): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Latest content_reviews row per entity (reviewer comment, AI validation reason…). */
export async function lastReviews(db: Database, entityType: string, ids: string[]): Promise<Map<string, LastReview>> {
  if (!ids.length) return new Map();
  const rows = await db
    .selectDistinctOn([contentReviews.entityId], {
      entityId: contentReviews.entityId, fromStatus: contentReviews.fromStatus, toStatus: contentReviews.toStatus,
      comment: contentReviews.comment, createdAt: contentReviews.createdAt, reviewerId: contentReviews.reviewerId,
    })
    .from(contentReviews)
    .where(and(eq(contentReviews.entityType, entityType), inArray(contentReviews.entityId, ids)))
    .orderBy(contentReviews.entityId, desc(contentReviews.createdAt));
  const people = await peopleByIds(db, rows.map((r) => r.reviewerId));
  return new Map(rows.map((r) => [r.entityId, {
    fromStatus: r.fromStatus, toStatus: r.toStatus, comment: r.comment, at: r.createdAt.toISOString(),
    reviewer: r.reviewerId ? people.get(r.reviewerId) ?? { id: r.reviewerId, name: null } : null,
  }]));
}

/** Full review payload of questions (options, answer key, explanation, topic, objectives, source, AI model, stats), in `ids` order. */
export async function loadQuestionDetails(db: Database, ids: string[]): Promise<AdminQuestionDetail[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ q: questions, topic: { key: syllabusNodes.key, titleAr: syllabusNodes.titleAr, titleFr: syllabusNodes.titleFr, level: syllabusNodes.level }, src: sourceRefCols })
    .from(questions)
    .innerJoin(syllabusNodes, eq(syllabusNodes.id, questions.topicId))
    .leftJoin(sources, eq(sources.id, questions.sourceId))
    .where(inArray(questions.id, ids));

  const [objectives, families, reports, reviews, people] = await Promise.all([
    db
      .select({ questionId: questionObjectives.questionId, key: learningObjectives.key, textAr: learningObjectives.textAr, textFr: learningObjectives.textFr })
      .from(questionObjectives)
      .innerJoin(learningObjectives, eq(learningObjectives.id, questionObjectives.objectiveId))
      .where(inArray(questionObjectives.questionId, ids))
      .orderBy(learningObjectives.key),
    db
      .select({ questionId: questionFamilies.questionId, slug: competitionFamilies.slug, nameAr: competitionFamilies.nameAr, nameFr: competitionFamilies.nameFr })
      .from(questionFamilies)
      .innerJoin(competitionFamilies, eq(competitionFamilies.id, questionFamilies.familyId))
      .where(inArray(questionFamilies.questionId, ids))
      .orderBy(competitionFamilies.slug),
    db
      .select({ questionId: questionReports.questionId, n: sql<number>`count(*)::int` })
      .from(questionReports)
      .where(and(inArray(questionReports.questionId, ids), eq(questionReports.status, 'OPEN')))
      .groupBy(questionReports.questionId),
    lastReviews(db, 'question', ids),
    peopleByIds(db, rows.flatMap((r) => [r.q.createdBy, r.q.reviewedBy])),
  ]);

  const group = <T extends { questionId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.questionId, [...(m.get(x.questionId) ?? []), x]);
    return m;
  };
  const objBy = group(objectives);
  const famBy = group(families);
  const reportsBy = new Map(reports.map((r) => [r.questionId, Number(r.n)]));
  const person = (id: string | null) => (id ? people.get(id) ?? { id, name: null } : null);

  const byId = new Map<string, AdminQuestionDetail>(rows.map(({ q, topic, src }): [string, AdminQuestionDetail] => [q.id, {
    entity: 'question' as const,
    id: q.id, extId: q.extId, status: q.status, version: q.version,
    type: q.type, domain: q.domain, language: q.language, difficulty: q.difficulty, rating: Math.round(q.rating),
    stem: q.stem, options: (q.options ?? []) as AdminQuestionDetail['options'], correct: q.correct, explanation: q.explanation,
    topic: { key: topic.key, title_ar: topic.titleAr, title_fr: topic.titleFr, level: topic.level },
    objectives: (objBy.get(q.id) ?? []).map((o) => ({ key: o.key, text_ar: o.textAr, text_fr: o.textFr })),
    families: (famBy.get(q.id) ?? []).map((f) => ({ slug: f.slug, name_ar: f.nameAr, name_fr: f.nameFr })),
    isGeneral: q.isGeneral, origin: q.origin, year: q.year, validUntil: q.validUntil, tags: q.tags ?? [],
    source: toSourceRef(src),
    ai: q.aiModel ? { model: q.aiModel, promptVersion: q.aiPromptVersion } : null,
    createdBy: person(q.createdBy), reviewedBy: person(q.reviewedBy), reviewedAt: iso(q.reviewedAt),
    stats: {
      attempts: q.attemptsCount, correct: q.correctCount,
      accuracy: q.attemptsCount ? Math.round((q.correctCount / q.attemptsCount) * 1000) / 1000 : null,
      openReports: reportsBy.get(q.id) ?? 0,
    },
    lastReview: reviews.get(q.id) ?? null,
    createdAt: q.createdAt.toISOString(), updatedAt: q.updatedAt.toISOString(),
  }]));
  return ids.map((id) => byId.get(id)).filter((x): x is AdminQuestionDetail => !!x);
}

export async function loadLessonDetails(db: Database, ids: string[]): Promise<AdminLessonDetail[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ l: lessons, topic: { key: syllabusNodes.key, titleAr: syllabusNodes.titleAr, titleFr: syllabusNodes.titleFr, domain: syllabusNodes.domain } })
    .from(lessons)
    .innerJoin(syllabusNodes, eq(syllabusNodes.id, lessons.nodeId))
    .where(inArray(lessons.id, ids));
  const [reviews, people] = await Promise.all([lastReviews(db, 'lesson', ids), peopleByIds(db, rows.map((r) => r.l.reviewedBy))]);
  const byId = new Map<string, AdminLessonDetail>(rows.map(({ l, topic }): [string, AdminLessonDetail] => [l.id, {
    entity: 'lesson' as const,
    id: l.id, status: l.status, version: l.version, language: l.language, title: l.title, bodyMd: l.bodyMd, estMinutes: l.estMinutes, origin: l.origin,
    topic: { key: topic.key, title_ar: topic.titleAr, title_fr: topic.titleFr, domain: topic.domain },
    reviewedBy: l.reviewedBy ? people.get(l.reviewedBy) ?? { id: l.reviewedBy, name: null } : null,
    lastReview: reviews.get(l.id) ?? null,
    updatedAt: l.updatedAt.toISOString(),
  }]));
  return ids.map((id) => byId.get(id)).filter((x): x is AdminLessonDetail => !!x);
}

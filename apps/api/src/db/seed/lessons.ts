import path from 'node:path';
import { eq } from 'drizzle-orm';
import { QUESTION_ORIGINS, SOURCE_TYPES, type ContentStatus, type QuestionOrigin, type SourceType } from '@ctn/shared';
import { contentReviews, lessons } from '../schema';
import { errorMessage, type SeedLog } from './log';
import { InvalidItem, arr, bool, intIn, isHttpUrl, isObj, oneOf, reqStr, str } from './normalize';
import type { SyllabusSeeder } from './syllabus';
import type { Db } from './types';

const HUMAN_STATUSES: ContentStatus[] = ['HUMAN_REVIEWED', 'PUBLISHED', 'ARCHIVED'];

const SOURCE_LABEL: Record<SourceType, { ar: string; fr: string }> = {
  OFFICIAL: { ar: 'رسمي', fr: 'officiel' },
  SECONDARY: { ar: 'صحافة', fr: 'presse' },
  COMMUNITY: { ar: 'مجتمعي', fr: 'communautaire' },
  SUGGESTED: { ar: 'اقتراح', fr: 'suggestion' },
};

/** Lessons table has no source columns: sources and the verification notice are rendered into the Markdown body. */
function decorateBody(body: string, language: 'ar' | 'fr' | 'en', rawSources: unknown, needsVerification: boolean): string {
  const ar = language === 'ar';
  const parts: string[] = [];
  if (needsVerification) {
    parts.push(ar
      ? '> **للتحقق** — بعض المعلومات الخاصة بتونس في هذا الدرس لم يتسنّ تأكيدها من مصدر رسمي.'
      : '> **À vérifier** — certaines informations propres à la Tunisie dans cette leçon n’ont pas pu être confirmées par une source officielle.');
  }
  parts.push(body.trim());
  const srcLines: string[] = [];
  for (const s of arr(rawSources)) {
    if (!isObj(s)) continue;
    const title = str(s.title);
    const url = str(s.url);
    if (!title && !isHttpUrl(url)) continue;
    const type = oneOf<SourceType>(s.source_type, SOURCE_TYPES, 'SUGGESTED');
    const label = ar ? SOURCE_LABEL[type].ar : SOURCE_LABEL[type].fr;
    srcLines.push(`- ${isHttpUrl(url) ? `[${title ?? url}](${url})` : title} (${label})`);
  }
  if (srcLines.length) parts.push(`### ${ar ? 'المصادر' : 'Sources'}\n\n${srcLines.join('\n')}`);
  return parts.join('\n\n');
}

/** Upserts lessons by (topic, language, title); never publishes, never overrides an editor's work. */
export async function seedLessonFile(db: Db, file: string, data: unknown, syl: SyllabusSeeder, log: SeedLog): Promise<void> {
  const ctx = `lessons/${path.basename(file)}`;
  const warn = log.scoped(ctx);
  if (!isObj(data)) {
    warn('not an object — skipped');
    return;
  }
  const existingRows = await db
    .select({ id: lessons.id, nodeId: lessons.nodeId, language: lessons.language, title: lessons.title, status: lessons.status, version: lessons.version })
    .from(lessons);
  const existing = new Map(existingRows.map((r) => [`${r.nodeId}|${r.language}|${r.title}`, r]));
  const reviewed = new Set(
    (await db.selectDistinct({ id: contentReviews.entityId }).from(contentReviews).where(eq(contentReviews.entityType, 'lesson'))).map((r) => r.id),
  );

  for (const [i, raw] of arr(data.lessons).entries()) {
    try {
      if (!isObj(raw)) throw new InvalidItem('lesson is not an object');
      const topicKey = reqStr(raw.topic_key, 'topic_key');
      const nodeId = syl.idOf(topicKey);
      if (!nodeId) throw new InvalidItem(`unknown topic_key "${topicKey}"`);
      const lang = str(raw.language)?.toLowerCase();
      if (lang !== 'ar' && lang !== 'fr' && lang !== 'en') throw new InvalidItem(`invalid language "${lang ?? ''}"`);
      const title = reqStr(raw.title, 'title');
      const body = reqStr(raw.body_md, 'body_md');
      const values = {
        nodeId, language: lang, title,
        bodyMd: decorateBody(body, lang, raw.sources, bool(raw.needs_verification, false)),
        estMinutes: intIn(raw.est_minutes, 1, 240, warn, 'est_minutes') ?? 10,
        origin: oneOf<QuestionOrigin>(raw.origin, QUESTION_ORIGINS, 'AI_GENERATED', warn, 'origin'),
      };
      const prev = existing.get(`${nodeId}|${lang}|${title}`);
      if (prev && prev.version > 1) {
        log.inc('kept.lessonsEditedByAdmin');
        continue;
      }
      if (prev) {
        const status: ContentStatus = HUMAN_STATUSES.includes(prev.status) || reviewed.has(prev.id) ? prev.status : 'AI_REVIEWED';
        await db.update(lessons).set({ ...values, status, updatedAt: new Date() }).where(eq(lessons.id, prev.id));
        log.inc('updated.lessons');
      } else {
        const [row] = await db.insert(lessons).values({ ...values, status: 'AI_REVIEWED' }).returning({ id: lessons.id });
        existing.set(`${nodeId}|${lang}|${title}`, { id: row.id, nodeId, language: lang, title, status: 'AI_REVIEWED', version: 1 });
        log.inc('created.lessons');
      }
    } catch (e) {
      warn(`lesson #${i + 1} skipped (${errorMessage(e)})`);
      log.inc('skipped.lessons');
    }
  }
}

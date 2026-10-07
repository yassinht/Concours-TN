import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { DOMAINS, DOMAIN_LABELS, computeReadiness, type ReadinessDTO } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { attempts, mastery, readinessSnapshots } from '../../db/schema';
import { CurriculumService, planWeights } from './curriculum.service';

/** Number of most recent mock exams that feed readiness (computeReadiness itself blends the last two). */
const MOCKS_CONSIDERED = 5;
const HISTORY_DAYS = 30;

type Bilingual = { ar: string; fr: string };

/** computeReadiness names domains by their code; show the bilingual label instead. */
export function humanizeReason(r: Bilingual): Bilingual {
  let { ar, fr } = r;
  for (const d of DOMAINS) {
    const re = new RegExp(`\\b${d}\\b`, 'g');
    ar = ar.replace(re, DOMAIN_LABELS[d].ar);
    fr = fr.replace(re, DOMAIN_LABELS[d].fr);
  }
  return { ar, fr };
}

/**
 * CONTRACT (owned by the learning module):
 * - forFamily(userId, familyId) → ReadinessDTO computed with @ctn/shared computeReadiness from the user's mastery rows on the
 *   family's syllabus, domain weights from the primary position's blueprint (fallback: equal weights), and the user's last
 *   MOCK attempt scores for that family. Upserts today's readiness_snapshots row and returns history (last 30 snapshots).
 */
@Injectable()
export class ReadinessService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly curriculum: CurriculumService,
  ) {}

  async forFamily(userId: string, familyId: string): Promise<ReadinessDTO> {
    const family = await this.curriculum.familyById(familyId);
    if (!family) throw new NotFoundException('NOT_FOUND');

    const [topics, format] = await Promise.all([this.curriculum.topics(familyId), this.curriculum.examFormat(userId, familyId)]);
    const plan = planWeights(format, topics);
    const weighted = new Set(plan.weights.map((w) => w.domain));
    const examTopics = topics.filter((t) => weighted.has(t.domain));
    const domainOf = new Map(examTopics.map((t) => [t.id, t.domain]));

    const [masteryRows, mockRows] = await Promise.all([
      examTopics.length
        ? this.db
          .select({ nodeId: mastery.nodeId, rating: mastery.rating, attempts: mastery.attempts })
          .from(mastery)
          .where(and(eq(mastery.userId, userId), inArray(mastery.nodeId, examTopics.map((t) => t.id)), gt(mastery.attempts, 0)))
        : Promise.resolve([]),
      this.db
        .select({ score: attempts.score })
        .from(attempts)
        .where(and(eq(attempts.userId, userId), eq(attempts.familyId, familyId), eq(attempts.kind, 'MOCK'), isNotNull(attempts.submittedAt), isNotNull(attempts.score)))
        .orderBy(desc(attempts.submittedAt))
        .limit(MOCKS_CONSIDERED),
    ]);

    const result = computeReadiness({
      topics: masteryRows.map((m) => ({ topicId: m.nodeId, domain: domainOf.get(m.nodeId)!, rating: m.rating, attempts: m.attempts })),
      weights: plan.weights,
      mockScores: mockRows.map((m) => Math.max(0, Math.min(1, m.score ?? 0))),
      formatOfficial: plan.formatOfficial,
    });

    const reasons = result.reasons.map(humanizeReason);
    for (const u of plan.uncovered) {
      const pct = Math.round(u.share * 100);
      const label = DOMAIN_LABELS[u.domain];
      reasons.push({
        ar: `مادة «${label.ar}» (${pct}% من الامتحان) غير مشمولة بعد بمحتوى المنصة — حضّرها من مصادر أخرى.`,
        fr: `« ${label.fr} » (${pct} % de l’examen) n’est pas encore couverte par la plateforme — préparez-la avec d’autres ressources.`,
      });
    }

    const today = tunisToday();
    await this.db
      .insert(readinessSnapshots)
      .values({ userId, familyId, date: today, preparation: result.preparation, overall: result.overall, coverage: result.coverage, label: result.label })
      .onConflictDoUpdate({
        target: [readinessSnapshots.userId, readinessSnapshots.familyId, readinessSnapshots.date],
        set: { preparation: result.preparation, overall: result.overall, coverage: result.coverage, label: result.label },
      });

    const history = await this.db
      .select({ date: readinessSnapshots.date, preparation: readinessSnapshots.preparation })
      .from(readinessSnapshots)
      .where(and(eq(readinessSnapshots.userId, userId), eq(readinessSnapshots.familyId, familyId)))
      .orderBy(desc(readinessSnapshots.date))
      .limit(HISTORY_DAYS);

    // `key` lets clients link a priority topic to its lesson/practice page (extra to the { ar, fr } contract).
    const topicTitles: Record<string, { ar: string; fr: string; key: string }> = {};
    for (const t of topics) topicTitles[t.id] = { ar: t.titleAr, fr: t.titleFr, key: t.key };

    return { ...result, reasons, familySlug: family.slug, topicTitles, history: history.reverse() };
  }
}

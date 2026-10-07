import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DOMAINS, shrunkMastery, type Domain } from '@ctn/shared';
import { tunisToday } from '../../common/dates';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';

const SERIES_DAYS = 30;

export interface ProgressDTO {
  totals: { answered: number; correct: number; accuracy: number; studyDays: number };
  byDomain: { domain: Domain; answered: number; correct: number; accuracy: number }[];
  last30d: { date: string; answered: number; correct: number }[];
  mastery: { key: string; title_ar: string; title_fr: string; domain: Domain; mastery: number; attempts: number }[];
}

const ratio = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : 0);

/** The SERIES_DAYS calendar dates ending today (YYYY-MM-DD, oldest first). */
export function lastDays(today: string, n = SERIES_DAYS): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** Personal statistics from answered questions (all attempt kinds) and topic mastery. Accuracy and mastery are 0..1. */
@Injectable()
export class ProgressService {
  constructor(@InjectDb() private readonly db: Database) {}

  async forUser(userId: string): Promise<ProgressDTO> {
    const today = tunisToday();
    const days = lastDays(today);
    const [totals, domains, series, masteryRows] = await Promise.all([
      this.db.execute<{ answered: number; correct: number; study_days: number }>(sql`
        select count(*)::int as answered,
               count(*) filter (where aa.is_correct)::int as correct,
               count(distinct (aa.answered_at at time zone 'Africa/Tunis')::date)::int as study_days
        from attempts a join attempt_answers aa on aa.attempt_id = a.id
        where a.user_id = ${userId}`),
      this.db.execute<{ domain: Domain; answered: number; correct: number }>(sql`
        select q.domain, count(*)::int as answered, count(*) filter (where aa.is_correct)::int as correct
        from attempts a
        join attempt_answers aa on aa.attempt_id = a.id
        join questions q on q.id = aa.question_id
        where a.user_id = ${userId}
        group by q.domain`),
      this.db.execute<{ day: string; answered: number; correct: number }>(sql`
        select to_char((aa.answered_at at time zone 'Africa/Tunis')::date, 'YYYY-MM-DD') as day,
               count(*)::int as answered, count(*) filter (where aa.is_correct)::int as correct
        from attempts a join attempt_answers aa on aa.attempt_id = a.id
        where a.user_id = ${userId}
          and aa.answered_at > now() - make_interval(days => ${SERIES_DAYS + 1})
          and (aa.answered_at at time zone 'Africa/Tunis')::date >= ${days[0]}::date
        group by 1`),
      this.db.execute<{ key: string; title_ar: string; title_fr: string; domain: Domain; rating: number; attempts: number }>(sql`
        select n.key, n.title_ar, n.title_fr, n.domain, m.rating, m.attempts
        from mastery m join syllabus_nodes n on n.id = m.node_id
        where m.user_id = ${userId} and m.attempts > 0 and n.level = 'TOPIC'`),
    ]);

    const t = totals.rows[0] ?? { answered: 0, correct: 0, study_days: 0 };
    const order = new Map(DOMAINS.map((d, i) => [d, i]));
    const byDay = new Map(series.rows.map((r) => [r.day, r]));

    return {
      totals: { answered: Number(t.answered), correct: Number(t.correct), accuracy: ratio(Number(t.correct), Number(t.answered)), studyDays: Number(t.study_days) },
      byDomain: domains.rows
        .map((d) => ({ domain: d.domain, answered: Number(d.answered), correct: Number(d.correct), accuracy: ratio(Number(d.correct), Number(d.answered)) }))
        .sort((a, b) => (order.get(a.domain) ?? 99) - (order.get(b.domain) ?? 99)),
      last30d: days.map((date) => ({ date, answered: Number(byDay.get(date)?.answered ?? 0), correct: Number(byDay.get(date)?.correct ?? 0) })),
      // Weakest first: that is what the user should work on next.
      mastery: masteryRows.rows
        .map((m) => ({
          key: m.key, title_ar: m.title_ar, title_fr: m.title_fr, domain: m.domain,
          mastery: Math.round(shrunkMastery(Number(m.rating), Number(m.attempts)) * 1000) / 1000,
          attempts: Number(m.attempts),
        }))
        .sort((a, b) => a.mastery - b.mastery || a.key.localeCompare(b.key)),
    };
  }
}

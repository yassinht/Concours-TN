/**
 * Loads content/** JSON into PostgreSQL. Idempotent (re-runnable) and tolerant: content files are written by
 * research agents and may be missing, partial or invalid — bad items are logged and skipped, the seed never aborts.
 *
 *   pnpm --filter @ctn/api db:seed
 *
 * Order matters: shared syllabus → bank specialty syllabus → competitions (link to both) → openings → questions → lessons.
 */
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb } from './client';
import { seedAdmin, seedPlans, seedPromo, seedWatchedSources } from './seed/base';
import { seedCompetitionFile } from './seed/competitions';
import { contentDir, listJson, readJson } from './seed/files';
import { seedLessonFile } from './seed/lessons';
import { SeedLog, errorMessage } from './seed/log';
import { isObj, arr } from './seed/normalize';
import { seedOpenings } from './seed/openings';
import { QuestionSeeder, seedBankSyllabus } from './seed/questions';
import { SyllabusSeeder } from './seed/syllabus';
import type { Db } from './seed/types';

async function step(log: SeedLog, name: string, fn: () => Promise<void>): Promise<void> {
  const t = Date.now();
  try {
    await fn();
    log.info(`done: ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    log.warn(name, `step failed: ${errorMessage(e)}`);
  }
}

export async function runSeed(db: Db, log = new SeedLog()): Promise<SeedLog> {
  const root = contentDir();
  console.log(`Seeding from ${root}`);
  const syl = new SyllabusSeeder(log);
  await syl.load(db);

  await step(log, 'plans, promo code, admin, watched sources', async () => {
    await seedPlans(db, log);
    await seedPromo(db, log);
    await seedAdmin(db, log);
    await seedWatchedSources(db, log);
  });

  await step(log, 'common syllabus', async () => {
    const data = readJson(path.join(root, 'syllabus/common.json'), log);
    if (!isObj(data)) return;
    await db.transaction(async (tx) => {
      await syl.upsertMany(tx, arr(data.nodes), {
        familyId: null, defaultDomain: 'CULTURE_GENERALE', defaultScope: 'GENERAL_SKILL', sourceIdOf: () => null, ctx: 'syllabus/common.json',
      });
    });
  });

  const bankFiles = listJson(path.join(root, 'questions'));
  const banks = bankFiles.map((f) => ({ file: f, data: readJson(f, log) })).filter((b) => b.data != null);
  await step(log, `question bank syllabus (${banks.length} banks)`, async () => {
    for (const b of banks) {
      try {
        await db.transaction((tx) => seedBankSyllabus(tx, b.file, b.data, syl, log));
      } catch (e) {
        log.warn(`questions/${path.basename(b.file)}`, `bank syllabus failed: ${errorMessage(e)}`);
        await syl.reload(db);
      }
    }
  });

  const compFiles = listJson(path.join(root, 'competitions'));
  await step(log, `competitions (${compFiles.length} files)`, async () => {
    for (const f of compFiles) {
      const data = readJson(f, log);
      if (data == null) continue;
      try {
        await seedCompetitionFile(db, f, data, syl, log);
      } catch (e) {
        log.warn(`competitions/${path.basename(f)}`, `file rolled back: ${errorMessage(e)}`);
        log.inc('skipped.families');
        await syl.reload(db);
      }
    }
    await syl.resolvePendingParents(db);
  });

  await step(log, 'openings', async () => {
    const file = path.join(root, 'competitions/_openings.json');
    const data = readJson(file, log);
    await seedOpenings(db, data, log);
  });

  await step(log, 'questions', async () => {
    const qs = new QuestionSeeder(syl, log);
    await qs.load(db);
    for (const b of banks) {
      try {
        await qs.seedBank(db, b.file, b.data);
      } catch (e) {
        log.warn(`questions/${path.basename(b.file)}`, `bank failed: ${errorMessage(e)}`);
      }
    }
  });

  await step(log, 'lessons', async () => {
    for (const f of listJson(path.join(root, 'lessons'))) {
      const data = readJson(f, log);
      if (data == null) continue;
      try {
        await seedLessonFile(db, f, data, syl, log);
      } catch (e) {
        log.warn(`lessons/${path.basename(f)}`, `file failed: ${errorMessage(e)}`);
      }
    }
  });

  return log;
}

const SUMMARY_TABLES = [
  'organizations', 'competition_families', 'sources', 'competitions', 'positions', 'phases', 'exam_subjects', 'competition_facts',
  'blueprints', 'past_exams', 'syllabus_nodes', 'learning_objectives', 'family_syllabus', 'questions', 'question_objectives',
  'question_families', 'lessons', 'plans', 'promo_codes', 'watched_sources', 'ingest_candidates',
] as const;

async function printSummary(db: Db, log: SeedLog): Promise<void> {
  const rows: { table: string; rows: number }[] = [];
  for (const t of SUMMARY_TABLES) {
    const r = await db.execute<{ n: string }>(sql`select count(*)::text as n from ${sql.identifier(t)}`);
    rows.push({ table: t, rows: Number(r.rows[0]?.n ?? 0) });
  }
  const byStatus = await db.execute<{ status: string; n: string }>(sql`select status::text as status, count(*)::text as n from questions group by 1 order by 1`);
  const editions = await db.execute<{ status: string; n: string }>(sql`select status::text as status, count(*)::text as n from competitions group by 1 order by 1`);

  console.log('\nDatabase rows after seed:');
  console.table(rows);
  console.log('Questions by status:', Object.fromEntries(byStatus.rows.map((r) => [r.status, Number(r.n)])));
  console.log('Editions by status:', Object.fromEntries(editions.rows.map((r) => [r.status, Number(r.n)])));
  console.log('\nThis run:');
  console.table(Object.fromEntries(log.entries().sort(([a], [b]) => a.localeCompare(b))));
  console.log(`${log.warnings.length} warning(s).`);
}

async function main() {
  const { db, pool } = createDb();
  const started = Date.now();
  try {
    const log = await runSeed(db);
    await printSummary(db, log);
    console.log(`Seed finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

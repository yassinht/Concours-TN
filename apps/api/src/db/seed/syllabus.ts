import { eq, sql } from 'drizzle-orm';
import {
  DOMAINS, SYLLABUS_LEVELS, SYLLABUS_SCOPES, type Domain, type SyllabusLevel, type SyllabusScope,
} from '@ctn/shared';
import { learningObjectives, syllabusNodes } from '../schema';
import { errorMessage, type SeedLog } from './log';
import { InvalidItem, arr, bilingual, isObj, oneOf, oneOfOrNull, reqStr, str } from './normalize';
import type { Db } from './types';

export interface NodeOptions {
  /** Owner family (null = shared node). */
  familyId: string | null;
  /** Domain used when the node does not state one (and its parent is unknown). */
  defaultDomain: Domain;
  defaultScope: SyllabusScope;
  /** Resolves a file-local source key to a sources.id. */
  sourceIdOf: (key: string | null) => string | null;
  /** Label used in warnings (file name). */
  ctx: string;
}

interface NodeInput {
  key: string;
  parentKey: string | null;
  level: SyllabusLevel;
  domain: Domain | null;
  titleAr: string;
  titleFr: string;
  scope: SyllabusScope;
  sourceKey: string | null;
  objectives: { key: string; textAr: string; textFr: string }[];
}

const KEY_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function normalizeNode(raw: unknown, opts: NodeOptions, warn: (m: string) => void): NodeInput {
  if (!isObj(raw)) throw new InvalidItem('node is not an object');
  const key = reqStr(raw.key, 'key');
  if (!KEY_RE.test(key)) throw new InvalidItem(`invalid key "${key}"`);
  let parentKey = str(raw.parent_key);
  if (parentKey === key) {
    warn(`node "${key}" is its own parent — parent ignored`);
    parentKey = null;
  }
  const level = oneOf<SyllabusLevel>(raw.level, SYLLABUS_LEVELS, parentKey ? 'TOPIC' : 'UNIT', warn, `level of ${key}`);
  const domain = oneOfOrNull<Domain>(raw.domain, DOMAINS, warn, `domain of ${key}`);
  const title = bilingual(raw.title_ar, raw.title_fr, 'title');
  const scope = oneOf<SyllabusScope>(raw.scope, SYLLABUS_SCOPES, opts.defaultScope, warn, `scope of ${key}`);
  const objectives: NodeInput['objectives'] = [];
  const seen = new Set<string>();
  for (const o of arr(raw.objectives)) {
    try {
      if (!isObj(o)) throw new InvalidItem('objective is not an object');
      const okey = reqStr(o.key, 'objective.key');
      if (seen.has(okey)) throw new InvalidItem(`duplicate objective key "${okey}"`);
      seen.add(okey);
      const text = bilingual(o.text_ar, o.text_fr, 'objective.text');
      objectives.push({ key: okey, textAr: text.ar, textFr: text.fr });
    } catch (e) {
      warn(`node "${key}": objective skipped (${errorMessage(e)})`);
    }
  }
  return { key, parentKey, level, domain, titleAr: title.ar, titleFr: title.fr, scope, sourceKey: str(raw.source_key), objectives };
}

/** Upserts syllabus nodes (by key) and their objectives; keeps a key → id cache across files. */
export class SyllabusSeeder {
  private readonly ids = new Map<string, string>();
  private readonly domains = new Map<string, Domain>();
  private readonly pendingParents: { key: string; parentKey: string; ctx: string }[] = [];

  constructor(private readonly log: SeedLog) {}

  async load(db: Db): Promise<void> {
    const rows = await db.select({ id: syllabusNodes.id, key: syllabusNodes.key, domain: syllabusNodes.domain }).from(syllabusNodes);
    for (const r of rows) {
      this.ids.set(r.key, r.id);
      this.domains.set(r.key, r.domain);
    }
  }

  idOf(key: string): string | undefined {
    return this.ids.get(key);
  }

  /** Upserts the nodes of one file; returns the keys that were written. */
  async upsertMany(db: Db, rawNodes: unknown[], opts: NodeOptions): Promise<string[]> {
    const warn = this.log.scoped(opts.ctx);
    const nodes: NodeInput[] = [];
    const seen = new Set<string>();
    for (const raw of rawNodes) {
      try {
        const n = normalizeNode(raw, opts, warn);
        if (seen.has(n.key)) throw new InvalidItem(`duplicate node key "${n.key}"`);
        seen.add(n.key);
        nodes.push(n);
      } catch (e) {
        warn(`syllabus node skipped (${errorMessage(e)})`);
        this.log.inc('skipped.syllabus');
      }
    }

    // Parents first: a node is ready when its parent is already known (DB or earlier in this file).
    const ordered: NodeInput[] = [];
    const placed = new Set<string>();
    let remaining = nodes;
    for (;;) {
      const next: NodeInput[] = [];
      for (const n of remaining) {
        if (!n.parentKey || this.ids.has(n.parentKey) || placed.has(n.parentKey)) {
          ordered.push(n);
          placed.add(n.key);
        } else next.push(n);
      }
      if (next.length === remaining.length || next.length === 0) {
        ordered.push(...next); // unresolved parents: resolved later (other files) or warned
        break;
      }
      remaining = next;
    }

    const written: string[] = [];
    for (const [index, n] of ordered.entries()) {
      try {
        await this.upsertNode(db, n, index, opts);
        written.push(n.key);
      } catch (e) {
        warn(`syllabus node "${n.key}" failed (${errorMessage(e)})`);
        this.log.inc('skipped.syllabus');
      }
    }
    return written;
  }

  private async upsertNode(db: Db, n: NodeInput, index: number, opts: NodeOptions): Promise<void> {
    const parentId = n.parentKey ? this.ids.get(n.parentKey) ?? null : null;
    if (n.parentKey && !parentId) this.pendingParents.push({ key: n.key, parentKey: n.parentKey, ctx: opts.ctx });
    const domain = n.domain ?? (n.parentKey ? this.domains.get(n.parentKey) : undefined) ?? opts.defaultDomain;
    const sourceId = opts.sourceIdOf(n.sourceKey);
    if (n.sourceKey && !sourceId) this.log.warn(opts.ctx, `node "${n.key}": unknown source_key "${n.sourceKey}"`);

    const [row] = await db
      .insert(syllabusNodes)
      .values({
        key: n.key, parentId, familyId: opts.familyId, level: n.level, domain, titleAr: n.titleAr, titleFr: n.titleFr,
        orderIndex: index, scope: n.scope, sourceId,
      })
      .onConflictDoUpdate({
        target: syllabusNodes.key,
        set: {
          parentId,
          // A key defined by two different owners becomes a shared node (stable whatever the load order).
          familyId: sql`case when "syllabus_nodes"."family_id" is not distinct from excluded."family_id" then excluded."family_id" else null end`,
          level: n.level, domain, titleAr: n.titleAr, titleFr: n.titleFr, orderIndex: index, scope: n.scope, sourceId,
        },
      })
      .returning({ id: syllabusNodes.id });
    this.ids.set(n.key, row.id);
    this.domains.set(n.key, domain);
    this.log.inc('upserted.syllabus');

    for (const o of n.objectives) {
      await db
        .insert(learningObjectives)
        .values({ key: o.key, nodeId: row.id, textAr: o.textAr, textFr: o.textFr })
        .onConflictDoUpdate({ target: learningObjectives.key, set: { nodeId: row.id, textAr: o.textAr, textFr: o.textFr } });
      this.log.inc('upserted.objectives');
    }
  }

  /** Second pass for nodes whose parent was defined in a file loaded later. */
  async resolvePendingParents(db: Db): Promise<void> {
    for (const p of this.pendingParents.splice(0)) {
      const parentId = this.ids.get(p.parentKey);
      const id = this.ids.get(p.key);
      if (!id) continue;
      if (!parentId) {
        this.log.warn(p.ctx, `node "${p.key}": unknown parent_key "${p.parentKey}" (attached at root)`);
        continue;
      }
      await db.update(syllabusNodes).set({ parentId }).where(eq(syllabusNodes.id, id));
    }
  }

  /** Objective key → id, for question links. */
  async objectiveIds(db: Db): Promise<Map<string, string>> {
    const rows = await db.select({ id: learningObjectives.id, key: learningObjectives.key }).from(learningObjectives);
    return new Map(rows.map((r) => [r.key, r.id]));
  }
}

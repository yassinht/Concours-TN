/**
 * Pure question-selection helpers (no I/O) used to build attempts. Randomness is injectable for deterministic tests.
 */
import { START_RATING, type Difficulty, type Domain } from '@ctn/shared';

export type Rng = () => number;

/** A servable question as seen by the selector, with the user's history on it. */
export interface Candidate {
  id: string;
  topicId: string;
  domain: Domain;
  difficulty: Difficulty;
  /** Calibrated Elo difficulty of the question. */
  rating: number;
  /** The user's mastery rating on the question's topic (null when the topic was never practiced). */
  userRating: number | null;
  timesSeen: number;
  lastCorrect: boolean | null;
  /** Answered by the user during the last 24h. */
  recent: boolean;
}

export type DiffBucket = 'EASY' | 'MEDIUM' | 'HARD';

export const bucketOf = (d: Difficulty): DiffBucket => (d === 'EASY' ? 'EASY' : d === 'MEDIUM' ? 'MEDIUM' : 'HARD');

const BUCKET_RANK: Record<DiffBucket, number> = { EASY: 0, MEDIUM: 1, HARD: 2 };

/** Freshness tier: 0 never seen, 1 previously wrong, 2 seen and right, 3 answered in the last 24h (avoided when possible). */
export function freshness(c: Pick<Candidate, 'timesSeen' | 'lastCorrect' | 'recent'>): 0 | 1 | 2 | 3 {
  if (c.recent) return 3;
  if (c.lastCorrect === false) return 1;
  if (c.timesSeen > 0 || c.lastCorrect === true) return 2;
  return 0;
}

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Largest-remainder apportionment of `total` over weighted keys. Ties go to the earlier key; zero/negative weights get 0. */
export function apportion<K>(total: number, weights: readonly { key: K; weight: number }[]): Map<K, number> {
  const out = new Map<K, number>(weights.map((w) => [w.key, 0]));
  const positive = weights.filter((w) => w.weight > 0 && Number.isFinite(w.weight));
  const sum = positive.reduce((a, w) => a + w.weight, 0);
  if (total <= 0 || sum <= 0) return out;
  const raw = positive.map((w, i) => ({ key: w.key, i, exact: (total * w.weight) / sum }));
  let given = 0;
  for (const r of raw) {
    const n = Math.floor(r.exact);
    out.set(r.key, n);
    given += n;
  }
  const byRemainder = [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.i - b.i);
  for (let k = 0; given < total; k = (k + 1) % byRemainder.length, given++) {
    const r = byRemainder[k];
    out.set(r.key, (out.get(r.key) ?? 0) + 1);
  }
  return out;
}

/**
 * Apportions `total` over weighted keys without exceeding each key's capacity: the overflow of a capped key is
 * re-apportioned (same weights) over keys that still have room. Sum of the result = min(total, Σ caps).
 */
export function allocateWithCaps<K>(total: number, weights: readonly { key: K; weight: number }[], caps: ReadonlyMap<K, number>): Map<K, number> {
  const cap = (k: K) => Math.max(0, caps.get(k) ?? 0);
  const eligible = weights.filter((w) => cap(w.key) > 0 && w.weight > 0);
  const counts = new Map<K, number>(weights.map((w) => [w.key, 0]));
  let remaining = Math.min(total, eligible.reduce((a, w) => a + cap(w.key), 0));
  for (let guard = 0; remaining > 0 && guard < 50; guard++) {
    const open = eligible.filter((w) => (counts.get(w.key) ?? 0) < cap(w.key));
    if (!open.length) break;
    const share = apportion(remaining, open);
    let placed = 0;
    for (const w of open) {
      const room = cap(w.key) - (counts.get(w.key) ?? 0);
      const add = Math.min(room, share.get(w.key) ?? 0);
      counts.set(w.key, (counts.get(w.key) ?? 0) + add);
      placed += add;
    }
    // Every share was capped to 0 (tiny weights): hand one item to the heaviest open key so the loop progresses.
    if (placed === 0) {
      const heaviest = [...open].sort((a, b) => b.weight - a.weight)[0];
      counts.set(heaviest.key, (counts.get(heaviest.key) ?? 0) + 1);
      placed = 1;
    }
    remaining -= placed;
  }
  return counts;
}

/**
 * Difficulty plan for `n` slots: ~25% EASY, ~50% MEDIUM, ~25% HARD, interleaved so any prefix stays balanced.
 * `offset` rotates the cycle so several small groups (e.g. domains with 1–3 questions) do not all lean the same way.
 */
export function difficultyPattern(n: number, offset = 0): DiffBucket[] {
  const cycle: DiffBucket[] = ['MEDIUM', 'EASY', 'MEDIUM', 'HARD'];
  return Array.from({ length: Math.max(0, n) }, (_, i) => cycle[(i + offset) % cycle.length]);
}

/** Order of difficulty buckets to try for a slot: the requested one, then its neighbours (closest first). */
function bucketFallbacks(b: DiffBucket, rng: Rng): DiffBucket[] {
  if (b === 'EASY') return ['EASY', 'MEDIUM', 'HARD'];
  if (b === 'HARD') return ['HARD', 'MEDIUM', 'EASY'];
  return rng() < 0.5 ? ['MEDIUM', 'EASY', 'HARD'] : ['MEDIUM', 'HARD', 'EASY'];
}

/**
 * Picks one candidate per requested difficulty slot. Preference: same bucket (fresh tiers first), then neighbouring buckets,
 * and only then questions answered in the last 24h. Within a group, topics not yet used come first (coverage).
 */
export function pickBalanced(cands: readonly Candidate[], slots: readonly DiffBucket[], rng: Rng = Math.random): Candidate[] {
  // groups[bucket][tier] = shuffled list
  const groups = new Map<DiffBucket, Candidate[][]>();
  for (const b of ['EASY', 'MEDIUM', 'HARD'] as DiffBucket[]) groups.set(b, [[], [], [], []]);
  for (const c of shuffle(cands, rng)) groups.get(bucketOf(c.difficulty))![freshness(c)].push(c);

  const usedTopics = new Map<string, number>();
  const chosen: Candidate[] = [];
  const takeFrom = (list: Candidate[]): Candidate | null => {
    if (!list.length) return null;
    let idx = list.findIndex((c) => !usedTopics.has(c.topicId));
    if (idx < 0) idx = 0;
    return list.splice(idx, 1)[0];
  };

  for (const slot of slots) {
    const order = bucketFallbacks(slot, rng);
    let picked: Candidate | null = null;
    // Fresh tiers (0..2) across all buckets before touching recently answered questions (tier 3).
    for (const tiers of [[0, 1, 2], [3]]) {
      for (const b of order) {
        for (const t of tiers) {
          picked = takeFrom(groups.get(b)![t]);
          if (picked) break;
        }
        if (picked) break;
      }
      if (picked) break;
    }
    if (!picked) break; // pool exhausted
    usedTopics.set(picked.topicId, (usedTopics.get(picked.topicId) ?? 0) + 1);
    chosen.push(picked);
  }
  return chosen;
}

/** Cost added per freshness tier: unseen < previously wrong < seen & right ≪ answered in the last 24h. */
const TIER_PENALTY = [0, 60, 200, 1500] as const;
/** Cost added for each question already chosen on the same topic (spreads a family-wide session over topics). */
const TOPIC_REPEAT_PENALTY = 60;
const JITTER = 40;

/**
 * Adaptive pick: questions whose Elo rating is close to the user's rating on that topic (START_RATING when unseen),
 * preferring unseen, then previously-wrong questions. Greedy on a cost function, O(n × candidates).
 */
export function pickAdaptive(cands: readonly Candidate[], n: number, rng: Rng = Math.random): Candidate[] {
  const pool = cands.map((c) => ({
    c,
    base: Math.abs(c.rating - (c.userRating ?? START_RATING)) + TIER_PENALTY[freshness(c)] + rng() * JITTER,
  }));
  const usedTopics = new Map<string, number>();
  const chosen: Candidate[] = [];
  while (chosen.length < n && pool.length) {
    let best = 0;
    let bestCost = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cost = pool[i].base + TOPIC_REPEAT_PENALTY * (usedTopics.get(pool[i].c.topicId) ?? 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    const [{ c }] = pool.splice(best, 1);
    usedTopics.set(c.topicId, (usedTopics.get(c.topicId) ?? 0) + 1);
    chosen.push(c);
  }
  return chosen;
}

/**
 * Wide coverage pick (offline packs): round-robin over topics, each topic serving its previously-wrong questions first,
 * then unseen, then the rest.
 */
export function pickSpread(cands: readonly Candidate[], n: number, rng: Rng = Math.random): Candidate[] {
  const tierOrder = (c: Candidate) => [1, 0, 2, 3][freshness(c)];
  const byTopic = new Map<string, Candidate[]>();
  for (const c of shuffle(cands, rng)) {
    const list = byTopic.get(c.topicId) ?? [];
    list.push(c);
    byTopic.set(c.topicId, list);
  }
  const queues = shuffle([...byTopic.values()], rng).map((l) => l.sort((a, b) => tierOrder(a) - tierOrder(b)));
  const chosen: Candidate[] = [];
  while (chosen.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      const c = q.shift();
      if (c) chosen.push(c);
      if (chosen.length >= n) break;
    }
  }
  return chosen;
}

/** Stable sort by difficulty (easy → hard), used to give sessions a gentle ramp. */
export function byDifficulty<T extends { difficulty: Difficulty }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => BUCKET_RANK[bucketOf(a.difficulty)] - BUCKET_RANK[bucketOf(b.difficulty)]);
}

/** Deterministic PRNG (mulberry32) seeded from a string — stable option order per attempt. */
export function seededRng(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Correct-by-construction psychotechnical items (no AI): number series, letter series and letter coding.
 * The answer is computed from the rule that produced the shown terms, distractors are derived from typical mistakes
 * and checked to differ from the answer, and the explanation states the rule in Arabic and French.
 */
import type { Difficulty, Domain } from '@ctn/shared';

export const ALGO_KINDS = ['NUMBER_SERIES', 'LETTER_SERIES', 'CODING'] as const;
export type AlgoKind = (typeof ALGO_KINDS)[number];
export type AlgoLanguage = 'ar' | 'fr';

export const ALGO_TOPICS: Record<AlgoKind, { topicKey: string; domain: Domain }> = {
  NUMBER_SERIES: { topicKey: 'lo.suites-numeriques', domain: 'LOGIC' },
  LETTER_SERIES: { topicKey: 'lo.suites-lettres', domain: 'LOGIC' },
  CODING: { topicKey: 'ps.codage', domain: 'PSYCHOTECH' },
};

export const ALGO_VERSION = 'algo-v1';

export interface AlgoQuestion {
  kind: AlgoKind;
  type: 'MCQ_SINGLE';
  language: AlgoLanguage;
  difficulty: Difficulty;
  stem: string;
  options: { id: string; text: string }[];
  correct: [string];
  explanation: string;
  /** Short rule id (e.g. "arith", "caesar") — stored as a tag for analytics. */
  rule: string;
}

export type Rng = () => number;

/** mulberry32: small seeded PRNG so a given seed always yields the same items (tests, reproducible batches). */
export function makeRng(seed: number = Math.floor(Math.random() * 2 ** 31)): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Left-to-right isolate: keeps a series or a code in reading order inside right-to-left text. */
const ltr = (s: string) => `⁦${s}⁩`;
const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;

/** Places the answer among 3 distinct distractors at a random position. */
function buildOptions(rng: Rng, answer: string, distractors: string[]): { options: { id: string; text: string }[]; correct: [string] } {
  const uniq = [...new Set(distractors.filter((d) => d !== answer && d.trim() !== ''))];
  if (uniq.length < 3) throw new Error('NOT_ENOUGH_DISTRACTORS');
  const texts = shuffle(rng, [answer, ...shuffle(rng, uniq).slice(0, 3)]);
  const options = texts.map((text, i) => ({ id: OPTION_IDS[i], text }));
  return { options, correct: [options.find((o) => o.text === answer)!.id] };
}

export function pickDifficulty(rng: Rng): Difficulty {
  const r = rng();
  return r < 0.3 ? 'EASY' : r < 0.75 ? 'MEDIUM' : 'HARD';
}

// ───────────── Number series ─────────────

interface NumberRule {
  rule: string;
  terms: number[];
  answer: number;
  ar: string;
  fr: string;
  /** Rule-specific wrong answers (e.g. continuing with the wrong operation). */
  traps: number[];
}

function arithmetic(rng: Rng, descending: boolean): NumberRule {
  const d = randInt(rng, 2, descending ? 12 : 9);
  const start = descending ? randInt(rng, 6 * d + 5, 6 * d + 60) : randInt(rng, 1, 25);
  const step = descending ? -d : d;
  const terms = Array.from({ length: 5 }, (_, i) => start + i * step);
  const answer = start + 5 * step;
  return {
    rule: descending ? 'arith-desc' : 'arith', terms, answer,
    ar: descending ? `نطرح ${d} في كل مرة: ${terms[4]} − ${d} = ${answer}.` : `نضيف ${d} في كل مرة: ${terms[4]} + ${d} = ${answer}.`,
    fr: descending ? `On retranche ${d} à chaque terme : ${terms[4]} − ${d} = ${answer}.` : `On ajoute ${d} à chaque terme : ${terms[4]} + ${d} = ${answer}.`,
    traps: [answer + step, answer - step + (descending ? -1 : 1), answer + 1, answer - 1],
  };
}

function geometric(rng: Rng): NumberRule {
  const r = pick(rng, [2, 3] as const);
  const start = randInt(rng, 1, r === 2 ? 6 : 3);
  const terms = Array.from({ length: 5 }, (_, i) => start * r ** i);
  const answer = start * r ** 5;
  const diff = terms[4] - terms[3];
  return {
    rule: 'geom', terms, answer,
    ar: `نضرب في ${r} في كل مرة: ${terms[4]} × ${r} = ${answer}.`,
    fr: `On multiplie par ${r} à chaque fois : ${terms[4]} × ${r} = ${answer}.`,
    traps: [terms[4] + diff, terms[4] * (r + 1), answer + r, answer - r, answer + terms[0]],
  };
}

function growingDifferences(rng: Rng): NumberRule {
  const start = randInt(rng, 1, 15);
  const d0 = randInt(rng, 1, 4);
  const k = randInt(rng, 1, 3);
  const terms = [start];
  for (let i = 0; i < 4; i++) terms.push(terms[i] + d0 + i * k);
  const nextDiff = d0 + 4 * k;
  const answer = terms[4] + nextDiff;
  const diffs = terms.slice(1).map((t, i) => t - terms[i]);
  return {
    rule: 'diff-growing', terms, answer,
    ar: `الفوارق بين الحدود هي ${diffs.join('، ')}: تزداد بـ ${k} في كل مرة، فالفارق الموالي ${nextDiff} و${terms[4]} + ${nextDiff} = ${answer}.`,
    fr: `Les écarts entre les termes sont ${diffs.join(', ')} : ils augmentent de ${k} à chaque fois, l’écart suivant vaut ${nextDiff} et ${terms[4]} + ${nextDiff} = ${answer}.`,
    traps: [terms[4] + diffs[3], answer + k, answer - 1, answer + 1],
  };
}

function alternatingOps(rng: Rng): NumberRule {
  const a = randInt(rng, 1, 6);
  const b = pick(rng, [2, 3] as const);
  const start = randInt(rng, 1, 5);
  const terms = [start];
  for (let i = 0; i < 4; i++) terms.push(i % 2 === 0 ? terms[i] + a : terms[i] * b);
  // terms: s, s+a, (s+a)b, (s+a)b+a, ((s+a)b+a)b → next operation is +a
  const answer = terms[4] + a;
  return {
    rule: 'alt-ops', terms, answer,
    ar: `نتناوب بين عمليتين: نضيف ${a} ثم نضرب في ${b}. العملية الموالية هي إضافة ${a}: ${terms[4]} + ${a} = ${answer}.`,
    fr: `On alterne deux opérations : + ${a} puis × ${b}. L’opération suivante est + ${a} : ${terms[4]} + ${a} = ${answer}.`,
    traps: [terms[4] * b, answer + a, answer - 1, terms[4] + b],
  };
}

function squares(rng: Rng): NumberRule {
  const s = randInt(rng, 1, 7);
  const c = pick(rng, [0, 0, 1, -1, 2] as const);
  const terms = Array.from({ length: 5 }, (_, i) => (s + i) ** 2 + c);
  const n = s + 5;
  const answer = n ** 2 + c;
  const cTxt = c === 0 ? '' : c > 0 ? ` + ${c}` : ` − ${-c}`;
  return {
    rule: c === 0 ? 'squares' : 'squares-shift', terms, answer,
    ar: `الحدود هي مربعات أعداد متتالية${cTxt ? ` مع إضافة ${c > 0 ? c : -c}${c < 0 ? ' بالسالب' : ''}` : ''}: ${s}²${cTxt}، ${s + 1}²${cTxt}… فالحد الموالي ${n}²${cTxt} = ${answer}.`,
    fr: `Les termes sont les carrés d’entiers consécutifs${cTxt ? ` décalés de ${c}` : ''} : ${s}²${cTxt}, ${s + 1}²${cTxt}… Le terme suivant est ${n}²${cTxt} = ${answer}.`,
    traps: [answer + 1, answer - 1, terms[4] + (terms[4] - terms[3]), (n + 1) ** 2 + c],
  };
}

function interleaved(rng: Rng): NumberRule {
  const a0 = randInt(rng, 1, 10);
  const d1 = randInt(rng, 2, 6);
  const b0 = randInt(rng, 20, 60);
  const d2 = -randInt(rng, 1, 4);
  const A = (i: number) => a0 + i * d1;
  const B = (i: number) => b0 + i * d2;
  const terms = [A(0), B(0), A(1), B(1), A(2), B(2)];
  const answer = A(3);
  return {
    rule: 'interleaved', terms, answer,
    ar: `متتاليتان متداخلتان: الحدود الفردية (${A(0)}، ${A(1)}، ${A(2)}) تزداد بـ ${d1}، والحدود الزوجية (${B(0)}، ${B(1)}، ${B(2)}) تنقص بـ ${-d2}. الحد الموالي من المتتالية الأولى: ${A(2)} + ${d1} = ${answer}.`,
    fr: `Deux suites imbriquées : les termes de rang impair (${A(0)}, ${A(1)}, ${A(2)}) augmentent de ${d1}, ceux de rang pair (${B(0)}, ${B(1)}, ${B(2)}) diminuent de ${-d2}. Le terme suivant appartient à la première suite : ${A(2)} + ${d1} = ${answer}.`,
    traps: [B(3), answer + d1, answer - 1, B(2) + d2 * 2],
  };
}

function fibonacciLike(rng: Rng): NumberRule {
  const x0 = randInt(rng, 1, 5);
  const x1 = randInt(rng, 1, 6);
  const terms = [x0, x1];
  for (let i = 2; i < 6; i++) terms.push(terms[i - 1] + terms[i - 2]);
  const answer = terms[5] + terms[4];
  return {
    rule: 'fibonacci', terms, answer,
    ar: `كل حد يساوي مجموع الحدّين السابقين له: ${terms[4]} + ${terms[5]} = ${answer}.`,
    fr: `Chaque terme est la somme des deux précédents : ${terms[4]} + ${terms[5]} = ${answer}.`,
    traps: [terms[5] + (terms[5] - terms[4]), answer + 1, answer - 1, terms[5] * 2],
  };
}

function affineRecurrence(rng: Rng): NumberRule {
  const a = 2;
  const b = pick(rng, [1, 2, 3, -1] as const);
  const x0 = randInt(rng, 2, 5);
  const terms = [x0];
  for (let i = 0; i < 4; i++) terms.push(terms[i] * a + b);
  const answer = terms[4] * a + b;
  const bTxt = b > 0 ? `+ ${b}` : `− ${-b}`;
  return {
    rule: 'affine', terms, answer,
    ar: `نضرب كل حد في ${a} ثم ${b > 0 ? `نضيف ${b}` : `نطرح ${-b}`}: ${terms[4]} × ${a} ${bTxt} = ${answer}.`,
    fr: `On multiplie chaque terme par ${a} puis on ${b > 0 ? `ajoute ${b}` : `retranche ${-b}`} : ${terms[4]} × ${a} ${bTxt} = ${answer}.`,
    traps: [terms[4] * a, answer + b * 2, answer + 2, terms[4] + (terms[4] - terms[3])],
  };
}

function doublingDifferences(rng: Rng): NumberRule {
  const start = randInt(rng, 1, 10);
  const d0 = randInt(rng, 1, 3);
  const terms = [start];
  for (let i = 0; i < 4; i++) terms.push(terms[i] + d0 * 2 ** i);
  const next = d0 * 2 ** 4;
  const answer = terms[4] + next;
  const diffs = terms.slice(1).map((t, i) => t - terms[i]);
  return {
    rule: 'diff-doubling', terms, answer,
    ar: `الفوارق بين الحدود (${diffs.join('، ')}) تتضاعف في كل مرة، فالفارق الموالي ${next} و${terms[4]} + ${next} = ${answer}.`,
    fr: `Les écarts (${diffs.join(', ')}) doublent à chaque fois : l’écart suivant vaut ${next} et ${terms[4]} + ${next} = ${answer}.`,
    traps: [terms[4] + diffs[3] + d0, answer - d0, answer + 2, terms[4] * 2],
  };
}

const NUMBER_RULES: Record<Difficulty, ((rng: Rng) => NumberRule)[]> = {
  EASY: [(r) => arithmetic(r, false), (r) => arithmetic(r, true), geometric],
  MEDIUM: [growingDifferences, alternatingOps, squares, (r) => arithmetic(r, true)],
  HARD: [interleaved, fibonacciLike, affineRecurrence, doublingDifferences],
  EXPERT: [interleaved, affineRecurrence, doublingDifferences, alternatingOps],
};

export function numberSeries(rng: Rng, difficulty: Difficulty, language: AlgoLanguage): AlgoQuestion {
  const r = pick(rng, NUMBER_RULES[difficulty])(rng);
  const answer = String(r.answer);
  const pool = [...r.traps, r.answer + 2, r.answer - 2, r.answer + 3, r.answer + 10, r.answer - 10]
    .filter((n) => Number.isInteger(n) && n >= 0 && n !== r.answer)
    .map(String);
  const { options, correct } = buildOptions(rng, answer, pool);
  const series = ltr(`${r.terms.join(', ')}, ?`);
  const stem = language === 'ar' ? `ما العدد الذي يكمل المتتالية التالية؟\n${series}` : `Quel nombre complète la suite suivante ?\n${series}`;
  return {
    kind: 'NUMBER_SERIES', type: 'MCQ_SINGLE', language, difficulty, stem, options, correct, rule: r.rule,
    explanation: `${r.ar} الجواب: ${answer}.\n\n${r.fr} Réponse : ${answer}.`,
  };
}

// ───────────── Letter series ─────────────

export const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
/** Arabic alphabetical (هجائي) order, as taught in Tunisian schools. */
export const ARABIC = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'];

/** Arabic count of letters with the dual: "بحرف واحد", "بحرفين", "بـ 3 حروف". */
const arByLetters = (k: number) => (k === 1 ? 'بحرف واحد' : k === 2 ? 'بحرفين' : `بـ ${k} حروف`);
/** Same, as a distance: "حرفا واحدا", "حرفين", "3 حروف". */
const arLetters = (k: number) => (k === 1 ? 'حرفا واحدا' : k === 2 ? 'حرفين' : `${k} حروف`);

interface LetterRule {
  rule: string;
  /** Indices of the shown letters, and of the answer. */
  idx: number[];
  answer: number;
  ar: string;
  fr: string;
}

function letterRule(rng: Rng, difficulty: Difficulty, n: number): LetterRule {
  const easy = (): LetterRule => {
    const k = randInt(rng, 1, 3);
    const s = randInt(rng, 0, n - 1 - 5 * k);
    const idx = Array.from({ length: 5 }, (_, i) => s + i * k);
    return { rule: 'skip', idx, answer: s + 5 * k, ar: k === 1 ? 'نأخذ الحروف متتالية' : `نتقدم ${arByLetters(k)} في كل مرة (نترك ${arLetters(k - 1)})`, fr: k === 1 ? 'on prend les lettres consécutives' : `on avance de ${k} lettres à chaque fois (on en saute ${k - 1})` };
  };
  const backwards = (): LetterRule => {
    const k = randInt(rng, 1, 3);
    const s = randInt(rng, 5 * k, n - 1);
    const idx = Array.from({ length: 5 }, (_, i) => s - i * k);
    return { rule: 'skip-back', idx, answer: s - 5 * k, ar: `نرجع إلى الوراء ${arByLetters(k)} في كل مرة`, fr: `on recule de ${k} lettre${k > 1 ? 's' : ''} à chaque fois` };
  };
  const growing = (): LetterRule => {
    const s = randInt(rng, 0, n - 1 - 15);
    const idx = [s, s + 1, s + 3, s + 6, s + 10];
    return { rule: 'skip-growing', idx, answer: s + 15, ar: 'نتقدم بحرف ثم بحرفين ثم بثلاثة ثم بأربعة، فالخطوة الموالية خمسة حروف', fr: 'on avance de 1, puis 2, puis 3, puis 4 lettres : le pas suivant est de 5 lettres' };
  };
  const alternating = (): LetterRule => {
    const up = randInt(rng, 2, 4);
    const down = 1;
    const s = randInt(rng, 0, n - 1 - 3 * (up - down) - up);
    const idx = [s];
    for (let i = 0; i < 4; i++) idx.push(idx[i] + (i % 2 === 0 ? up : -down));
    // next step is +up (5th move, i = 4)
    return { rule: 'alt', idx, answer: idx[4] + up, ar: `نتقدم ${arByLetters(up)} ثم نرجع بحرف واحد، بالتناوب`, fr: `on avance de ${up} puis on recule de 1, en alternance` };
  };
  const twoEnds = (): LetterRule => {
    const s = randInt(rng, 0, 3);
    const idx = [s, n - 1 - s, s + 1, n - 2 - s, s + 2];
    return { rule: 'two-ends', idx, answer: n - 3 - s, ar: 'متتاليتان متداخلتان: الأولى من بداية الأبجدية إلى الأمام، والثانية من نهايتها إلى الوراء', fr: 'deux suites imbriquées : l’une part du début de l’alphabet en avançant, l’autre de la fin en reculant' };
  };
  const table: Record<Difficulty, (() => LetterRule)[]> = {
    EASY: [easy],
    MEDIUM: [backwards, growing, easy],
    HARD: [alternating, twoEnds, growing],
    EXPERT: [alternating, twoEnds],
  };
  return pick(rng, table[difficulty])();
}

export function letterSeries(rng: Rng, difficulty: Difficulty, language: AlgoLanguage): AlgoQuestion {
  const alphabet = language === 'ar' ? ARABIC : LATIN;
  const r = letterRule(rng, difficulty, alphabet.length);
  const answer = alphabet[r.answer];
  const near = [r.answer + 1, r.answer - 1, r.answer + 2, r.answer - 2, r.answer + 3, r.answer - 3]
    .filter((i) => i >= 0 && i < alphabet.length)
    .map((i) => alphabet[i]);
  const { options, correct } = buildOptions(rng, answer, near);
  const shown = r.idx.map((i) => alphabet[i]);
  const ranks = (letters: number[]) => letters.map((i) => `${alphabet[i]}=${i + 1}`);
  const stem = language === 'ar'
    ? `ما الحرف الذي يكمل المتتالية التالية؟\n${shown.join('، ')}، ؟`
    : `Quelle lettre complète la suite suivante ?\n${ltr(`${shown.join(', ')}, ?`)}`;
  const explanation =
    `رتبة الحروف في ${language === 'ar' ? 'الترتيب الهجائي' : 'الأبجدية اللاتينية'}: ${ranks(r.idx).join('، ')}. ${r.ar}، فالحرف الموالي هو ${answer} (${r.answer + 1}).` +
    `\n\nRang des lettres dans ${language === 'ar' ? 'l’alphabet arabe (ordre hijā’ī)' : 'l’alphabet'} : ${ranks(r.idx).join(', ')}. Règle : ${r.fr}. La lettre suivante est ${answer} (${r.answer + 1}).`;
  return { kind: 'LETTER_SERIES', type: 'MCQ_SINGLE', language, difficulty, stem, options, correct, explanation, rule: r.rule };
}

// ───────────── Coding ─────────────

const FR_WORDS = [
  'CHAT', 'LOUP', 'PAIN', 'MER', 'SOLEIL', 'ARBRE', 'TABLE', 'LIVRE', 'ROUTE', 'PORTE', 'MAISON', 'JARDIN', 'ECOLE', 'STYLO', 'CAHIER',
  'VILLE', 'FLEUR', 'BATEAU', 'CHEVAL', 'LAMPE', 'PLUME', 'NUAGE', 'SABLE', 'NEIGE', 'ORANGE', 'RADIO', 'TRAIN', 'VELO', 'BUREAU',
  'MOTEUR', 'MONDE', 'CARTE', 'PIANO', 'TIGRE', 'POMME', 'CITRON', 'LAPIN', 'AVION', 'CAMION', 'BALLON', 'CRAYON', 'MOUTON',
];
const AR_WORDS = [
  'قلم', 'بحر', 'شمس', 'نهر', 'جبل', 'سمك', 'ورد', 'باب', 'درس', 'علم', 'حبر', 'كتاب', 'قمر', 'نجم', 'شجر', 'ولد', 'بيت', 'طريق',
  'سفر', 'مطر', 'ثلج', 'زيت', 'خبز', 'لبن', 'عسل', 'فرس', 'جمل', 'صقر', 'نمر', 'فيل', 'حصان', 'دفتر', 'مكتب', 'كرسي', 'سوق', 'غيم',
];

const shiftWord = (word: string, alphabet: string[], k: number): string | null => {
  let out = '';
  for (const ch of word) {
    const i = alphabet.indexOf(ch);
    if (i < 0 || i + k < 0 || i + k >= alphabet.length) return null; // no wrap-around: keeps the rule unambiguous
    out += alphabet[i + k];
  }
  return out;
};
const reverse = (w: string) => [...w].reverse().join('');
const ranksOf = (word: string, alphabet: string[]) => [...word].map((ch) => alphabet.indexOf(ch) + 1);

/** Two different words of the list that can both be shifted by every k in `ks` without wrapping (null if none). */
function pickWords(rng: Rng, words: string[], alphabet: string[], ks: number[]): [string, string] | null {
  const ok = shuffle(rng, words.filter((w) => ks.every((k) => shiftWord(w, alphabet, k) !== null)));
  return ok.length >= 2 ? [ok[0], ok[1]] : null;
}

const shiftsFor = (k: number) => [k, k + 1, k - 1 === 0 ? k + 2 : k - 1, -k];

export function coding(rng: Rng, difficulty: Difficulty, language: AlgoLanguage): AlgoQuestion {
  const alphabet = language === 'ar' ? ARABIC : LATIN;
  const words = language === 'ar' ? AR_WORDS : FR_WORDS;
  const variants: Record<Difficulty, string[]> = {
    EASY: ['caesar'],
    MEDIUM: ['caesar', 'numeric'],
    HARD: ['reverse-shift', 'decode', 'caesar-back'],
    EXPERT: ['reverse-shift', 'decode'],
  };
  const variant = pick(rng, variants[difficulty]);
  const quoteW = (w: string) => (language === 'ar' ? `«${w}»` : w);

  if (variant === 'numeric') {
    const [ex, target] = pickWords(rng, words, alphabet, [0])!;
    const code = (w: string) => ranksOf(w, alphabet);
    const fmt = (ns: number[]) => ltr(ns.join('-'));
    const t = code(target);
    const answer = fmt(t);
    const distract = [
      fmt(t.map((x) => x + 1)),
      fmt(t.map((x) => Math.max(1, x - 1))),
      fmt([...t].reverse()),
      fmt(t.map((x, i) => (i === t.length - 1 ? x + 2 : x))),
      fmt(t.map((x, i) => (i === 0 ? x + 1 : x))),
    ];
    const { options, correct } = buildOptions(rng, answer, distract);
    const pairs = (w: string, sep: string) => [...w].map((ch) => `${ch}=${alphabet.indexOf(ch) + 1}`).join(sep);
    const stem = language === 'ar'
      ? `في رمز معيّن، تُكتب كلمة «${ex}» هكذا: ${fmt(code(ex))}\nكيف تُكتب كلمة «${target}»؟`
      : `Dans un code, le mot ${ex} s’écrit ${fmt(code(ex))}.\nComment s’écrit le mot ${target} ?`;
    const explanation =
      `كل حرف يُعوَّض برتبته في ${language === 'ar' ? 'الترتيب الهجائي' : 'الأبجدية'}، بنفس ترتيب حروف الكلمة من أولها إلى آخرها: ${pairs(target, '، ')}. الجواب: ${answer}.` +
      `\n\nChaque lettre est remplacée par son rang dans l’alphabet${language === 'ar' ? ' arabe' : ''}, dans l’ordre des lettres du mot : ${pairs(target, ', ')}. Réponse : ${answer}.`;
    return { kind: 'CODING', type: 'MCQ_SINGLE', language, difficulty, stem, options, correct, explanation, rule: 'numeric' };
  }

  // Large shifts leave few words that never wrap around the alphabet: shrink the shift until two words qualify.
  let k = variant === 'caesar-back' ? -randInt(rng, 1, 3) : difficulty === 'EASY' ? randInt(rng, 1, 2) : randInt(rng, 1, 4);
  let chosen = pickWords(rng, words, alphabet, shiftsFor(k));
  while (!chosen && Math.abs(k) > 1) {
    k -= Math.sign(k);
    chosen = pickWords(rng, words, alphabet, shiftsFor(k));
  }
  if (!chosen) throw new Error('NO_CODABLE_WORDS');
  const ks = shiftsFor(k);
  const [ex, target] = chosen;
  const reversed = variant === 'reverse-shift';
  const encode = (w: string, kk: number, rev = reversed) => shiftWord(rev ? reverse(w) : w, alphabet, kk);
  const exCode = encode(ex, k)!;
  const kAbs = Math.abs(k);
  const dirAr = `${arLetters(kAbs)} ${k > 0 ? 'إلى الأمام' : 'إلى الوراء'}`;
  const dirFr = k > 0 ? `avancée de ${kAbs} rang${kAbs > 1 ? 's' : ''}` : `reculée de ${kAbs} rang${kAbs > 1 ? 's' : ''}`;
  const ruleAr = `${reversed ? 'نقلب ترتيب حروف الكلمة ثم ' : ''}نعوّض كل حرف بالحرف الذي يبعد عنه ${dirAr} في ${language === 'ar' ? 'الترتيب الهجائي' : 'الأبجدية'}`;
  const ruleFr = `${reversed ? 'on écrit le mot à l’envers, puis ' : ''}chaque lettre est ${dirFr} dans l’alphabet`;
  const step = (w: string) => [...(reversed ? reverse(w) : w)].map((ch) => `${ch}→${alphabet[alphabet.indexOf(ch) + k]}`);

  if (variant === 'decode') {
    const tCode = encode(target, k)!;
    const decoys = shuffle(rng, words.filter((w) => w !== target && w !== ex && w.length === target.length));
    const near = [shiftWord(target, alphabet, 1), shiftWord(target, alphabet, -1), reverse(target)].filter((w): w is string => !!w);
    const { options, correct } = buildOptions(rng, target, [...decoys.slice(0, 2), ...near, ...decoys.slice(2)]);
    const stem = language === 'ar'
      ? `في رمز سري، تُكتب كلمة «${ex}» هكذا: «${exCode}».\nما الكلمة التي تُكتب «${tCode}»؟`
      : `Dans un code secret, ${ex} s’écrit ${exCode}.\nQuel mot s’écrit ${tCode} ?`;
    const explanation =
      `القاعدة: ${ruleAr}. لفك الرمز نطبق العكس على «${tCode}» فنحصل على «${target}».` +
      `\n\nRègle : ${ruleFr}. Pour décoder, on applique l’opération inverse à ${tCode} et on obtient ${target}.`;
    return { kind: 'CODING', type: 'MCQ_SINGLE', language, difficulty, stem, options, correct, explanation, rule: 'decode' };
  }

  const answer = encode(target, k)!;
  const distract = [
    encode(target, ks[1]), encode(target, ks[2]), encode(target, -k), reversed ? encode(target, k, false) : reverse(answer),
    answer.length > 2 ? answer[1] + answer[0] + answer.slice(2) : null,
  ].filter((w): w is string => !!w);
  const { options, correct } = buildOptions(rng, answer, distract);
  const stem = language === 'ar'
    ? `في رمز سري، تُكتب كلمة ${quoteW(ex)} هكذا: «${exCode}».\nكيف تُكتب كلمة ${quoteW(target)}؟`
    : `Dans un code secret, ${ex} s’écrit ${exCode}.\nComment s’écrit ${target} ?`;
  const explanation =
    `القاعدة: ${ruleAr} (${step(ex).join('، ')}). بتطبيقها على «${target}»: ${step(target).join('، ')}، فالجواب «${answer}».` +
    `\n\nRègle : ${ruleFr} (${step(ex).join(', ')}). Appliquée à ${target} : ${step(target).join(', ')}. Réponse : ${answer}.`;
  return { kind: 'CODING', type: 'MCQ_SINGLE', language, difficulty, stem, options, correct, explanation, rule: variant };
}

export function generateAlgorithmic(kind: AlgoKind, rng: Rng, opts: { difficulty?: Difficulty; language: AlgoLanguage }): AlgoQuestion {
  const difficulty = opts.difficulty ?? pickDifficulty(rng);
  if (kind === 'NUMBER_SERIES') return numberSeries(rng, difficulty, opts.language);
  if (kind === 'LETTER_SERIES') return letterSeries(rng, difficulty, opts.language);
  return coding(rng, difficulty, opts.language);
}

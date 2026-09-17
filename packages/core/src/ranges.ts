import { MATRIX_RANKS, RANK_CHARS, cardId, cardRank, cardSuit, comboKey, holeType } from "./cards.js";
import { SeededRng } from "./rng.js";

export const COMBO_COUNT = 1326;

export interface Combo {
  index: number;
  a: number;
  b: number;
  key: string;
  type: string;
  suited: boolean;
  pair: boolean;
}

let comboTable: Combo[] | null = null;
let keyToIndex: Map<string, number> | null = null;
let typeToIndices: Map<string, number[]> | null = null;

export function allCombos(): Combo[] {
  if (comboTable) return comboTable;
  const combos: Combo[] = [];
  let index = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      combos.push({
        index,
        a,
        b,
        key: comboKey(a, b),
        type: holeType(a, b),
        suited: cardSuit(a) === cardSuit(b) && cardRank(a) !== cardRank(b),
        pair: cardRank(a) === cardRank(b),
      });
      index++;
    }
  }
  comboTable = combos;
  keyToIndex = new Map(combos.map((c) => [c.key, c.index]));
  typeToIndices = new Map();
  for (const combo of combos) {
    const list = typeToIndices.get(combo.type) ?? [];
    list.push(combo.index);
    typeToIndices.set(combo.type, list);
  }
  return combos;
}

export function comboIndexFor(a: number, b: number): number {
  allCombos();
  const key = comboKey(a, b);
  const idx = keyToIndex!.get(key);
  if (idx === undefined) throw new Error(`Unknown combo ${key}`);
  return idx;
}

export function indicesForType(type: string): number[] {
  allCombos();
  return typeToIndices!.get(type) ?? [];
}

export function emptyRange(): Float64Array {
  return new Float64Array(COMBO_COUNT);
}

export function uniformRange(blocked: Set<number> = new Set()): Float64Array {
  const weights = emptyRange();
  const combos = allCombos();
  let n = 0;
  for (const combo of combos) {
    if (blocked.has(combo.a) || blocked.has(combo.b)) continue;
    weights[combo.index] = 1;
    n++;
  }
  if (n) normalizeRange(weights);
  return weights;
}

export function rangeFromTypes(types: Record<string, number>, blocked: Set<number> = new Set()): Float64Array {
  const weights = emptyRange();
  const combos = allCombos();
  for (const combo of combos) {
    if (blocked.has(combo.a) || blocked.has(combo.b)) continue;
    const w = types[combo.type];
    if (w && w > 0) weights[combo.index] = w;
  }
  normalizeRange(weights);
  return weights;
}

export function normalizeRange(weights: Float64Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += weights[i]!;
  if (sum <= 0) return weights;
  for (let i = 0; i < weights.length; i++) weights[i]! /= sum;
  return weights;
}

export function cloneRange(weights: Float64Array): Float64Array {
  return Float64Array.from(weights);
}

export function applyActionLikelihood(
  prior: Float64Array,
  likelihood: (combo: Combo) => number,
  blocked: Set<number> = new Set(),
): Float64Array {
  const next = emptyRange();
  const combos = allCombos();
  for (const combo of combos) {
    if (blocked.has(combo.a) || blocked.has(combo.b)) continue;
    const p = prior[combo.index]!;
    if (p <= 0) continue;
    next[combo.index] = p * Math.max(0, likelihood(combo));
  }
  normalizeRange(next);
  return next;
}

export function rangeMass(weights: Float64Array): number {
  let sum = 0;
  for (const w of weights) sum += w;
  return sum;
}

export function sampleCombo(weights: Float64Array, rng: SeededRng, blocked: Set<number> = new Set()): Combo | null {
  const combos = allCombos();
  let total = 0;
  for (const combo of combos) {
    if (blocked.has(combo.a) || blocked.has(combo.b)) continue;
    total += weights[combo.index]!;
  }
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const combo of combos) {
    if (blocked.has(combo.a) || blocked.has(combo.b)) continue;
    r -= weights[combo.index]!;
    if (r <= 0) return combo;
  }
  return combos[combos.length - 1]!;
}

export interface MatrixCell {
  type: string;
  kind: "pair" | "suited" | "offsuit";
  weight: number;
  combos: number;
  strategy?: Record<string, number>;
}

export function rangeToMatrix(weights: Float64Array): MatrixCell[][] {
  const combos = allCombos();
  const cells: MatrixCell[][] = MATRIX_RANKS.map(() => []);
  const acc = new Map<string, { weight: number; n: number }>();

  for (const combo of combos) {
    const cur = acc.get(combo.type) ?? { weight: 0, n: 0 };
    cur.weight += weights[combo.index]!;
    cur.n += 1;
    acc.set(combo.type, cur);
  }

  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const hi = MATRIX_RANKS[row]!;
      const lo = MATRIX_RANKS[col]!;
      let type: string;
      let kind: MatrixCell["kind"];
      if (row === col) {
        type = `${hi}${lo}`;
        kind = "pair";
      } else if (col > row) {
        type = `${hi}${lo}s`;
        kind = "suited";
      } else {
        type = `${lo}${hi}o`;
        kind = "offsuit";
      }
      const data = acc.get(type) ?? { weight: 0, n: 0 };
      cells[row]!.push({ type, kind, weight: data.weight, combos: data.n });
    }
  }
  return cells;
}

export function blockedSet(cards: number[]): Set<number> {
  return new Set(cards);
}

export function comboStrengthScore(combo: Combo): number {
  const r1 = cardRank(combo.a);
  const r2 = cardRank(combo.b);
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  let score = hi * 1.15 + lo * 0.35;
  if (combo.pair) score = 8.2 + hi * 1.05;
  else {
    const gap = hi - lo;
    if (combo.suited) score += 1.35;
    if (gap === 1) score += 0.85;
    else if (gap === 2) score += 0.4;
    else if (gap === 3) score += 0.12;
    else score -= gap * 0.18;
    if (hi === 12) score += lo >= 9 ? 0.9 : 0.15;
    if (hi === 11) score += lo >= 9 ? 0.35 : 0.05;
    if (combo.suited && lo <= 5 && hi === 12) score += 0.35;
  }
  return score;
}

export function formatCombo(a: number, b: number): string {
  return comboKey(a, b);
}

export function parseHole(cards: string[]): [number, number] {
  const a = cards[0]!;
  const b = cards[1]!;
  const parse = (s: string) => {
    const rank = RANK_CHARS.indexOf(s[0]!.toUpperCase());
    const suit = "cdhs".indexOf(s[1]!.toLowerCase());
    return cardId(rank, suit);
  };
  return [parse(a), parse(b)];
}

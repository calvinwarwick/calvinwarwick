import { cardRank, holeType } from "./cards.js";
import { evaluateHand } from "./evaluator.js";
import { SeededRng } from "./rng.js";
import { allCombos, sampleCombo, type Combo } from "./ranges.js";

export interface EquityResult {
  equity: number;
  win: number;
  tie: number;
  lose: number;
  trials: number;
  exact: boolean;
}

const comboVsTypeCache = new Map<string, number>();
const situationCache = new Map<string, EquityResult>();

export function resetEquityCache(): void {
  situationCache.clear();
}

function remainingCards(used: Set<number>): number[] {
  const cards: number[] = [];
  for (let i = 0; i < 52; i++) if (!used.has(i)) cards.push(i);
  return cards;
}

function completeBoard(board: number[], deck: number[], rng: SeededRng): number[] {
  const need = 5 - board.length;
  if (need <= 0) return board.slice(0, 5);
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return [...board, ...copy.slice(0, need)];
}

export function equityHeroVsRange(args: {
  hero: [number, number];
  range: Float64Array;
  board?: number[];
  trials?: number;
  seed?: number;
  exactRiver?: boolean;
}): EquityResult {
  const board = args.board ?? [];
  const used = new Set<number>([args.hero[0], args.hero[1], ...board]);
  const cacheKey = `${args.hero[0]}-${args.hero[1]}-${board.join(",")}-${hashRange(args.range)}-${args.trials ?? 0}`;
  const cached = situationCache.get(cacheKey);
  if (cached) return cached;

  const exact = board.length === 5 && (args.exactRiver ?? true);
  const result = exact
    ? exactEquityVsRange(args.hero, args.range, board, used)
    : monteCarloEquity(args.hero, args.range, board, used, args.trials ?? 160, args.seed ?? 1);

  if (situationCache.size > 8000) situationCache.clear();
  situationCache.set(cacheKey, result);
  return result;
}

function hashRange(range: Float64Array): string {
  let h = 0;
  for (let i = 0; i < range.length; i += 17) {
    h = (Math.imul(h, 31) + Math.round((range[i] ?? 0) * 1e6)) >>> 0;
  }
  return h.toString(16);
}

function exactEquityVsRange(
  hero: [number, number],
  range: Float64Array,
  board: number[],
  used: Set<number>,
): EquityResult {
  const combos = allCombos();
  const heroRank = evaluateHand([hero[0], hero[1], ...board]);
  let w = 0;
  let t = 0;
  let l = 0;
  let mass = 0;
  for (const combo of combos) {
    const weight = range[combo.index]!;
    if (weight <= 0) continue;
    if (used.has(combo.a) || used.has(combo.b)) continue;
    const villainRank = evaluateHand([combo.a, combo.b, ...board]);
    mass += weight;
    if (heroRank > villainRank) w += weight;
    else if (heroRank === villainRank) t += weight;
    else l += weight;
  }
  if (mass <= 0) return { equity: 0.5, win: 0, tie: 0, lose: 0, trials: 0, exact: true };
  return {
    equity: (w + t / 2) / mass,
    win: w / mass,
    tie: t / mass,
    lose: l / mass,
    trials: combos.length,
    exact: true,
  };
}

function monteCarloEquity(
  hero: [number, number],
  range: Float64Array,
  board: number[],
  used: Set<number>,
  trials: number,
  seed: number,
): EquityResult {
  const rng = new SeededRng(seed);
  const deck = remainingCards(used);
  let w = 0;
  let t = 0;
  let l = 0;
  let n = 0;
  for (let i = 0; i < trials; i++) {
    const villain = sampleCombo(range, rng, used);
    if (!villain) break;
    const trialUsed = new Set(used);
    trialUsed.add(villain.a);
    trialUsed.add(villain.b);
    const trialDeck = deck.filter((c) => c !== villain.a && c !== villain.b);
    const fullBoard = completeBoard(board, trialDeck, rng);
    const heroRank = evaluateHand([hero[0], hero[1], ...fullBoard]);
    const villainRank = evaluateHand([villain.a, villain.b, ...fullBoard]);
    n++;
    if (heroRank > villainRank) w++;
    else if (heroRank === villainRank) t++;
    else l++;
  }
  if (!n) return { equity: 0.5, win: 0, tie: 0, lose: 0, trials: 0, exact: false };
  return {
    equity: (w + t / 2) / n,
    win: w / n,
    tie: t / n,
    lose: l / n,
    trials: n,
    exact: false,
  };
}

export function equityHeroVsRanges(args: {
  hero: [number, number];
  ranges: Float64Array[];
  board?: number[];
  trials?: number;
  seed?: number;
}): EquityResult {
  if (args.ranges.length === 1) {
    return equityHeroVsRange({
      hero: args.hero,
      range: args.ranges[0]!,
      board: args.board,
      trials: args.trials,
      seed: args.seed,
    });
  }
  const board = args.board ?? [];
  const used = new Set<number>([args.hero[0], args.hero[1], ...board]);
  const rng = new SeededRng(args.seed ?? 2);
  const deck0 = remainingCards(used);
  const trials = args.trials ?? 120;
  let w = 0;
  let t = 0;
  let l = 0;
  let n = 0;
  for (let i = 0; i < trials; i++) {
    const villains: Combo[] = [];
    const trialUsed = new Set(used);
    let ok = true;
    for (const range of args.ranges) {
      const combo = sampleCombo(range, rng, trialUsed);
      if (!combo) {
        ok = false;
        break;
      }
      villains.push(combo);
      trialUsed.add(combo.a);
      trialUsed.add(combo.b);
    }
    if (!ok) continue;
    const trialDeck = deck0.filter((c) => !trialUsed.has(c));
    const fullBoard = completeBoard(board, trialDeck, rng);
    const heroRank = evaluateHand([args.hero[0], args.hero[1], ...fullBoard]);
    let bestVillain = -1;
    let ties = 0;
    for (const v of villains) {
      const rank = evaluateHand([v.a, v.b, ...fullBoard]);
      if (rank > bestVillain) {
        bestVillain = rank;
        ties = 1;
      } else if (rank === bestVillain) {
        ties++;
      }
    }
    n++;
    if (heroRank > bestVillain) w++;
    else if (heroRank === bestVillain) t += 1 / (ties + 1);
    else l++;
  }
  if (!n) return { equity: 0.5, win: 0, tie: 0, lose: 0, trials: 0, exact: false };
  return {
    equity: (w + t / 2) / n,
    win: w / n,
    tie: t / n,
    lose: l / n,
    trials: n,
    exact: false,
  };
}

/** Fast 169-type preflop heuristic used when MC is too expensive. */
export function preflopTypeEquity(heroType: string, villainType: string): number {
  const key = `${heroType}|${villainType}`;
  const cached = comboVsTypeCache.get(key);
  if (cached !== undefined) return cached;
  const hs = typeStrength(heroType);
  const vs = typeStrength(villainType);
  const eq = 1 / (1 + Math.exp(-(hs - vs) * 0.42));
  const adjusted = heroType === villainType ? 0.5 : clamp(eq, 0.08, 0.92);
  comboVsTypeCache.set(key, adjusted);
  return adjusted;
}

function typeStrength(type: string): number {
  const hi = "23456789TJQKA".indexOf(type[0]!);
  const lo = "23456789TJQKA".indexOf(type[1]!);
  if (type.length === 2) return 9 + hi * 0.85;
  let s = hi * 0.9 + lo * 0.28;
  if (type.endsWith("s")) s += 1.1;
  const gap = hi - lo;
  if (gap === 1) s += 0.7;
  else if (gap === 2) s += 0.25;
  if (hi === 12) s += 0.6;
  return s;
}

export function preflopEquityVsRange(hero: [number, number], range: Float64Array): number {
  const heroType = holeType(hero[0], hero[1]);
  const combos = allCombos();
  let mass = 0;
  let eq = 0;
  const used = new Set([hero[0], hero[1]]);
  for (const combo of combos) {
    const w = range[combo.index]!;
    if (w <= 0 || used.has(combo.a) || used.has(combo.b)) continue;
    mass += w;
    eq += w * preflopTypeEquity(heroType, combo.type);
  }
  return mass > 0 ? eq / mass : 0.5;
}

export function trialsFor(accuracy: "fast" | "standard" | "precise", street: string): number {
  if (accuracy === "precise") return street === "flop" ? 400 : 700;
  if (accuracy === "standard") return street === "flop" ? 180 : 260;
  return street === "flop" ? 70 : 110;
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function comboHighCard(combo: Combo): number {
  return Math.max(cardRank(combo.a), cardRank(combo.b));
}

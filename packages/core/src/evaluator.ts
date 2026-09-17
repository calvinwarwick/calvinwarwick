import { cardRank, cardSuit } from "./cards.js";

export const HAND_CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export const HAND_CATEGORY_NAMES = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
] as const;

/** Pack category + up to 5 kickers into a comparable integer. */
export function packRank(category: number, ...kickers: number[]): number {
  let value = category;
  for (let i = 0; i < 5; i++) {
    value = value * 16 + (kickers[i] ?? 0);
  }
  return value;
}

export function unpackRank(value: number): { category: number; kickers: number[] } {
  const kickers: number[] = [];
  let rest = value;
  for (let i = 0; i < 5; i++) {
    kickers.push(rest % 16);
    rest = Math.floor(rest / 16);
  }
  kickers.reverse();
  return { category: rest, kickers };
}

export function categoryOf(value: number): number {
  return Math.floor(value / 16 ** 5);
}

export function handName(value: number): string {
  return HAND_CATEGORY_NAMES[categoryOf(value)] ?? "Unknown";
}

/** Highest card of a 5-card straight from a 13-bit rank mask, or -1. 5-high wheel = 3. */
export function straightHighFromMask(mask: number): number {
  for (let high = 12; high >= 4; high--) {
    const bits = 0b11111 << (high - 4);
    if ((mask & bits) === bits) return high;
  }
  const wheel = (1 << 12) | 0b1111;
  if ((mask & wheel) === wheel) return 3;
  return -1;
}

function ranksFromMaskDesc(mask: number): number[] {
  const ranks: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (mask & (1 << r)) ranks.push(r);
  }
  return ranks;
}

/**
 * Evaluate 5–7 hole+board cards. Returns a comparable rank integer.
 * Higher is better. Equal ranks split the pot.
 */
export function evaluateHand(cardIds: number[]): number {
  if (cardIds.length < 5 || cardIds.length > 7) {
    throw new Error(`evaluateHand expects 5–7 cards, got ${cardIds.length}`);
  }

  const rankCounts = new Array<number>(13).fill(0);
  const suitCounts = new Array<number>(4).fill(0);
  const suitRankMasks = [0, 0, 0, 0];
  let rankMask = 0;

  for (const id of cardIds) {
    const rank = cardRank(id);
    const suit = cardSuit(id);
    rankCounts[rank]! += 1;
    suitCounts[suit]! += 1;
    suitRankMasks[suit]! |= 1 << rank;
    rankMask |= 1 << rank;
  }

  let flushMask = 0;
  for (let suit = 0; suit < 4; suit++) {
    if (suitCounts[suit]! >= 5) {
      flushMask = suitRankMasks[suit]!;
      break;
    }
  }

  if (flushMask) {
    const sfHigh = straightHighFromMask(flushMask);
    if (sfHigh >= 0) return packRank(HAND_CATEGORY.STRAIGHT_FLUSH, sfHigh);
  }

  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let rank = 12; rank >= 0; rank--) {
    const count = rankCounts[rank]!;
    if (count === 4) quads.push(rank);
    else if (count === 3) trips.push(rank);
    else if (count === 2) pairs.push(rank);
    else if (count === 1) singles.push(rank);
  }

  if (quads.length) {
    const kicker = firstUnused(quads[0]!, trips, pairs, singles);
    return packRank(HAND_CATEGORY.QUADS, quads[0]!, kicker);
  }

  if (trips.length && (pairs.length || trips.length > 1)) {
    const three = trips[0]!;
    const two = trips.length > 1 ? trips[1]! : pairs[0]!;
    return packRank(HAND_CATEGORY.FULL_HOUSE, three, two);
  }

  if (flushMask) {
    const flushRanks = ranksFromMaskDesc(flushMask).slice(0, 5);
    return packRank(HAND_CATEGORY.FLUSH, ...flushRanks);
  }

  const straightHigh = straightHighFromMask(rankMask);
  if (straightHigh >= 0) return packRank(HAND_CATEGORY.STRAIGHT, straightHigh);

  if (trips.length) {
    const kickers = [...pairs, ...singles].slice(0, 2);
    return packRank(HAND_CATEGORY.TRIPS, trips[0]!, kickers[0] ?? 0, kickers[1] ?? 0);
  }

  if (pairs.length >= 2) {
    const kickerCandidates = [...pairs.slice(2), ...singles];
    return packRank(HAND_CATEGORY.TWO_PAIR, pairs[0]!, pairs[1]!, kickerCandidates[0] ?? 0);
  }

  if (pairs.length === 1) {
    const kickers = singles.slice(0, 3);
    return packRank(HAND_CATEGORY.PAIR, pairs[0]!, kickers[0] ?? 0, kickers[1] ?? 0, kickers[2] ?? 0);
  }

  const highs = singles.slice(0, 5);
  return packRank(HAND_CATEGORY.HIGH_CARD, highs[0] ?? 0, highs[1] ?? 0, highs[2] ?? 0, highs[3] ?? 0, highs[4] ?? 0);
}

function firstUnused(used: number, ...lists: number[][]): number {
  for (const list of lists) {
    for (const rank of list) {
      if (rank !== used) return rank;
    }
  }
  return 0;
}

export function compareHands(a: number[], b: number[]): number {
  return evaluateHand(a) - evaluateHand(b);
}

export function bestHandRank(hole: number[], board: number[]): number {
  return evaluateHand([...hole, ...board]);
}

export function winnersOf(players: { id: string; hole: number[] }[], board: number[]): string[] {
  let best = -1;
  const winners: string[] = [];
  for (const player of players) {
    const rank = bestHandRank(player.hole, board);
    if (rank > best) {
      best = rank;
      winners.length = 0;
      winners.push(player.id);
    } else if (rank === best) {
      winners.push(player.id);
    }
  }
  return winners;
}

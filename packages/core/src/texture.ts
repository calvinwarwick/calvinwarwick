import { cardRank, cardSuit } from "./cards.js";
import { straightHighFromMask, HAND_CATEGORY, evaluateHand } from "./evaluator.js";
import type { BoardTexture } from "./types.js";

export function classifyBoard(board: number[]): BoardTexture {
  if (board.length === 0) {
    return {
      paired: "unpaired",
      suits: "rainbow",
      connected: "disconnected",
      height: "high",
      dynamism: "static",
      wetness: 0,
    };
  }

  const ranks = board.map(cardRank);
  const suits = board.map(cardSuit);
  const rankCounts = new Array<number>(13).fill(0);
  const suitCounts = new Array<number>(4).fill(0);
  let rankMask = 0;
  for (let i = 0; i < board.length; i++) {
    rankCounts[ranks[i]!]! += 1;
    suitCounts[suits[i]!]! += 1;
    rankMask |= 1 << ranks[i]!;
  }

  const maxPair = Math.max(...rankCounts);
  const pairKinds = rankCounts.filter((c) => c >= 2).length;
  const paired: BoardTexture["paired"] =
    maxPair >= 3 ? "trips" : pairKinds >= 2 ? "two-pair" : maxPair === 2 ? "paired" : "unpaired";

  const maxSuit = Math.max(...suitCounts);
  const suitsKind: BoardTexture["suits"] =
    maxSuit >= 3 && board.length >= 3 && suitCounts.filter((c) => c > 0).length === 1
      ? "monotone"
      : maxSuit >= 2 && board.length >= 3
        ? maxSuit >= 3
          ? "monotone"
          : "two-tone"
        : "rainbow";

  const high = Math.max(...ranks);
  const height: BoardTexture["height"] = high >= 9 ? "high" : high >= 6 ? "medium" : "low";

  const uniqueRanks = ranks.filter((r, i) => ranks.indexOf(r) === i).sort((a, b) => a - b);
  let minGap = 12;
  for (let i = 1; i < uniqueRanks.length; i++) {
    minGap = Math.min(minGap, uniqueRanks[i]! - uniqueRanks[i - 1]!);
  }
  const hasStraight = board.length >= 3 && straightHighFromMask(expandNear(rankMask)) >= 0;
  const connected: BoardTexture["connected"] =
    uniqueRanks.length >= 3 && (minGap <= 1 || hasStraight)
      ? "connected"
      : minGap <= 2
        ? "semi-connected"
        : "disconnected";

  let wetness = 0;
  if (suitsKind === "monotone") wetness += 0.45;
  else if (suitsKind === "two-tone") wetness += 0.22;
  if (connected === "connected") wetness += 0.35;
  else if (connected === "semi-connected") wetness += 0.18;
  if (paired === "unpaired") wetness += 0.05;
  wetness = Math.min(1, wetness);

  const dynamism: BoardTexture["dynamism"] =
    wetness >= 0.55 ? "dynamic" : wetness >= 0.28 ? "semi-dynamic" : "static";

  return { paired, suits: suitsKind, connected, height, dynamism, wetness };
}

function expandNear(mask: number): number {
  let expanded = mask;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) {
      if (r > 0) expanded |= 1 << (r - 1);
      if (r < 12) expanded |= 1 << (r + 1);
    }
  }
  return expanded;
}

export function describeMadeHand(hole: number[], board: number[]): string {
  if (board.length < 3) return "Preflop";
  const rank = evaluateHand([...hole, ...board]);
  const category = Math.floor(rank / 16 ** 5);
  return [
    "High Card",
    "Pair",
    "Two Pair",
    "Three of a Kind",
    "Straight",
    "Flush",
    "Full House",
    "Four of a Kind",
    "Straight Flush",
  ][category] ?? "Unknown";
}

export function detectDraws(hole: number[], board: number[]): string[] {
  if (board.length === 0 || board.length >= 5) return [];
  const cards = [...hole, ...board];
  const suitCounts = [0, 0, 0, 0];
  let rankMask = 0;
  for (const id of cards) {
    suitCounts[cardSuit(id)]! += 1;
    rankMask |= 1 << cardRank(id);
  }
  const draws: string[] = [];
  if (suitCounts.some((c) => c === 4)) draws.push("Flush Draw");
  if (suitCounts.some((c) => c === 3) && board.length === 3) draws.push("Backdoor Flush Draw");

  const holes = new Set(hole.map(cardRank));
  let oesd = false;
  let gutshot = false;
  for (let high = 12; high >= 4; high--) {
    const bits = 0b11111 << (high - 4);
    const have = rankMask & bits;
    const missing = bits ^ have;
    const missCount = bitCount(missing);
    if (missCount === 1) {
      const missRank = Math.log2(missing);
      if (holes.has(cardRank(hole[0]!)) || holes.has(cardRank(hole[1]!))) {
        const ends = missRank === high || missRank === high - 4;
        if (ends) oesd = true;
        else gutshot = true;
      }
    }
  }
  const wheel = (1 << 12) | 0b1111;
  if (bitCount(wheel & rankMask) === 4) gutshot = true;
  if (oesd) draws.push("Open-Ended Straight Draw");
  else if (gutshot) draws.push("Gutshot");
  return draws;
}

function bitCount(n: number): number {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

export function blockerNotes(hole: number[], board: number[]): string[] {
  const notes: string[] = [];
  const ranks = hole.map(cardRank);
  const suits = hole.map(cardSuit);
  const labels = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  for (const r of new Set(ranks)) {
    if (r >= 11) notes.push(`Blocks ${labels[r]}-high combos`);
  }
  if (board.length >= 3) {
    const boardSuits = board.map(cardSuit);
    const flushSuit = [0, 1, 2, 3].find((s) => boardSuits.filter((x) => x === s).length >= 2);
    if (flushSuit !== undefined && suits.includes(flushSuit)) {
      notes.push("Holds a flush blocker");
    }
  }
  return notes;
}

export { HAND_CATEGORY };

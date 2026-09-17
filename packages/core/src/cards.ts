import { SeededRng } from "./rng.js";

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "cdhs";
export const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const MATRIX_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

/** Card id 0-51: suit * 13 + rank, rank 0=2 ... 12=A, suit 0=c 1=d 2=h 3=s. */
export function cardId(rank: number, suit: number): number {
  return suit * 13 + rank;
}

export function cardRank(id: number): number {
  return id % 13;
}

export function cardSuit(id: number): number {
  return Math.floor(id / 13);
}

export function formatCard(id: number): string {
  return `${RANK_CHARS[cardRank(id)]}${SUIT_CHARS[cardSuit(id)]}`;
}

export function parseCard(text: string): number {
  if (text.length < 2) throw new Error(`Invalid card: ${text}`);
  const rank = RANK_CHARS.indexOf(text[0]!.toUpperCase());
  const suit = SUIT_CHARS.indexOf(text[1]!.toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`Invalid card: ${text}`);
  return cardId(rank, suit);
}

export function parseCards(texts: string[] | string): number[] {
  const list = typeof texts === "string" ? texts.trim().split(/[\s,]+/).filter(Boolean) : texts;
  return list.map(parseCard);
}

export function formatCards(ids: number[]): string[] {
  return ids.map(formatCard);
}

export function freshDeck(): number[] {
  const deck: number[] = [];
  for (let i = 0; i < 52; i++) deck.push(i);
  return deck;
}

export function shuffledDeck(rng: SeededRng): number[] {
  return rng.shuffle(freshDeck());
}

export function canonicalCombo(a: number, b: number): [number, number] {
  return a > b ? [a, b] : [b, a];
}

export function comboKey(a: number, b: number): string {
  const [hi, lo] = canonicalCombo(a, b);
  return `${formatCard(hi)}${formatCard(lo)}`;
}

export function holeType(a: number, b: number): string {
  const r1 = cardRank(a);
  const r2 = cardRank(b);
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const h = RANK_CHARS[hi]!;
  const l = RANK_CHARS[lo]!;
  if (hi === lo) return `${h}${l}`;
  return cardSuit(a) === cardSuit(b) ? `${h}${l}s` : `${h}${l}o`;
}

export function typeToMatrixCell(type: string): { row: number; col: number; kind: "pair" | "suited" | "offsuit" } {
  const hi = MATRIX_RANKS.indexOf(type[0] as (typeof MATRIX_RANKS)[number]);
  const lo = MATRIX_RANKS.indexOf(type[1] as (typeof MATRIX_RANKS)[number]);
  if (type.length === 2) return { row: hi, col: lo, kind: "pair" };
  if (type.endsWith("s")) return { row: Math.min(hi, lo), col: Math.max(hi, lo), kind: "suited" };
  return { row: Math.max(hi, lo), col: Math.min(hi, lo), kind: "offsuit" };
}

export const FULL_DECK_IDS = freshDeck();

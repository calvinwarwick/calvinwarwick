import type { Combo } from "./ranges.js";
import { comboStrengthScore } from "./ranges.js";
import type { Position, PotType, Street } from "./types.js";

export interface Situation {
  street: Street;
  potType: PotType;
  position: Position;
  opener?: Position;
  raiser?: Position;
  facing: "unopened" | "limp" | "open" | "3bet" | "4bet" | "squeeze" | "shove" | "bet" | "check";
  stackBb: number;
  headsUp: boolean;
  multiway: boolean;
}

const POSITION_OPEN_THRESHOLD: Record<Position, number> = {
  UTG: 12.4,
  HJ: 11.6,
  CO: 10.6,
  BTN: 9.4,
  SB: 10.2,
  BB: 99,
};

const ISO_THRESHOLD: Record<Position, number> = {
  UTG: 13.2,
  HJ: 12.4,
  CO: 11.4,
  BTN: 10.2,
  SB: 10.8,
  BB: 11.6,
};

export function logistic(x: number, k = 1.6): number {
  return 1 / (1 + Math.exp(-k * x));
}

export function mixAround(score: number, threshold: number, width = 1.1): { raise: number; call: number; fold: number } {
  const raise = logistic(score - threshold, 2.1 / width);
  const callBand = logistic(score - (threshold - 1.35), 1.7 / width) - raise;
  const call = Math.max(0, callBand);
  const fold = Math.max(0, 1 - raise - call);
  const sum = raise + call + fold;
  return { raise: raise / sum, call: call / sum, fold: fold / sum };
}

export function preflopBaseline(combo: Combo, situation: Situation): { raise: number; call: number; fold: number } {
  const score = comboStrengthScore(combo);
  const steal = situation.facing === "unopened" && (situation.position === "CO" || situation.position === "BTN" || situation.position === "SB");

  if (situation.facing === "unopened") {
    const t = POSITION_OPEN_THRESHOLD[situation.position] - (steal ? 0.7 : 0);
    const mix = mixAround(score, t, steal ? 1.25 : 1);
    if (situation.position === "SB") {
      const limp = mix.fold * 0.18;
      return { raise: mix.raise, call: limp, fold: Math.max(0, mix.fold - limp) };
    }
    return { raise: mix.raise, call: 0, fold: mix.call + mix.fold };
  }

  if (situation.facing === "limp") {
    const mix = mixAround(score, ISO_THRESHOLD[situation.position], 1.15);
    return { raise: mix.raise, call: mix.call * 0.85, fold: 1 - mix.raise - mix.call * 0.85 };
  }

  if (situation.facing === "open") {
    const vsSteal = situation.opener === "CO" || situation.opener === "BTN" || situation.opener === "SB";
    const inPosition = situation.position === "BTN" || situation.position === "CO";
    const defendPos = situation.position === "BB" || situation.position === "SB" || inPosition;
    const valueT = vsSteal ? 14.6 : 15.0;
    const callT = defendPos ? (vsSteal ? 9.4 : 10.4) : 12.0;
    const threeBetValue = logistic(score - valueT, 2.4);
    const bluff = comboBluffScore(combo);
    const threeBetBluff = bluff * (vsSteal && inPosition ? 0.55 : vsSteal ? 0.28 : 0.14) * (1 - threeBetValue);
    const raise = clamp01(threeBetValue + threeBetBluff);
    const remain = 1 - raise;
    const callShare = defendPos ? logistic(score - callT, 1.55) : logistic(score - callT, 1.9);
    const call = clamp01(remain * Math.max(callShare, bluff > 0.8 && inPosition ? 0.35 : 0));
    return normalize3(raise, call, remain - call);
  }

  if (situation.facing === "3bet" || situation.facing === "squeeze") {
    const fourBet = logistic(score - 15.2, 2.4) + comboBluffScore(combo) * 0.08;
    const call = (1 - fourBet) * logistic(score - 13.1, 1.7);
    return normalize3(fourBet, call, 1 - fourBet - call);
  }

  if (situation.facing === "4bet" || situation.facing === "shove") {
    const fiveBet = logistic(score - 16.4, 2.8);
    const call = (1 - fiveBet) * logistic(score - 15.0, 2.2);
    return normalize3(fiveBet, call, 1 - fiveBet - call);
  }

  return { raise: 0, call: 0, fold: 1 };
}

function comboBluffScore(combo: Combo): number {
  const type = combo.type;
  if (["A5s", "A4s", "A3s", "A2s", "K9s", "K8s", "Q9s", "76s", "65s", "54s"].includes(type)) return 1;
  if (type.endsWith("s") && (type.startsWith("A") || type.startsWith("K"))) return 0.45;
  return 0.05;
}

function normalize3(raise: number, call: number, fold: number): { raise: number; call: number; fold: number } {
  const r = Math.max(0, raise);
  const c = Math.max(0, call);
  const f = Math.max(0, fold);
  const s = r + c + f || 1;
  return { raise: r / s, call: c / s, fold: f / s };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function sizingFor(situation: Situation): number[] {
  if (situation.street !== "preflop") return [0.33, 0.67, 1, 1.5];
  if (situation.facing === "unopened") {
    if (situation.position === "SB") return [3];
    if (situation.position === "BTN" || situation.position === "CO") return [2.5];
    return [2.5];
  }
  if (situation.facing === "limp") return [4];
  if (situation.facing === "open") return situation.position === "BB" ? [10] : [8];
  if (situation.facing === "3bet") return [18];
  return [100];
}

export function classifyFacing(args: {
  street: Street;
  potType: PotType;
  toCallBB: number;
  raises: number;
  limps: number;
  opener?: Position;
}): Situation["facing"] {
  if (args.street !== "preflop") {
    return args.toCallBB > 0 ? "bet" : "check";
  }
  if (args.toCallBB <= 0 && args.raises === 0) return args.limps > 0 ? "limp" : "unopened";
  if (args.potType === "5bet") return "shove";
  if (args.potType === "4bet") return "4bet";
  if (args.potType === "3bet") return "3bet";
  if (args.raises === 0 && args.limps > 0) return "limp";
  if (args.raises >= 1 && args.limps + args.raises >= 2) return "squeeze";
  if (args.toCallBB > 0) return "open";
  return "unopened";
}

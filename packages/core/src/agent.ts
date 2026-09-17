import { parseCards } from "./cards.js";
import { equityHeroVsRange, equityHeroVsRanges, preflopEquityVsRange, trialsFor } from "./equity.js";
import { ARCHETYPE_BY_ID, type OpponentModel } from "./opponents.js";
import {
  allCombos,
  applyActionLikelihood,
  comboIndexFor,
  parseHole,
  rangeFromTypes,
  uniformRange,
  type Combo,
} from "./ranges.js";
import { SeededRng } from "./rng.js";
import { classifyFacing, preflopBaseline, sizingFor, type Situation } from "./strategy.js";
import { blockerNotes, classifyBoard, describeMadeHand, detectDraws } from "./texture.js";
import type {
  Accuracy,
  ActionType,
  AgentDecision,
  AgentGameState,
  DecisionExplanation,
  EvBreakdown,
  ExploitRecord,
  MixedStrategy,
  Position,
  StrategyMode,
} from "./types.js";

export interface DecisionContext {
  rng: SeededRng;
  mode: StrategyMode;
  accuracy: Accuracy;
  opponents: Map<string, OpponentModel>;
  ranges: Map<string, Float64Array>;
  heroId: string;
}

export function inferSituation(state: AgentGameState): Situation {
  const raises = state.actionHistory.filter((a) => a.action === "raise" || a.action === "bet").length;
  const limps = state.actionHistory.filter((a) => a.action === "call" && state.street === "preflop").length;
  const opener = state.actionHistory.find((a) => a.action === "raise")?.player as Position | undefined;
  return {
    street: state.street,
    potType: state.potType,
    position: state.position,
    opener,
    facing: classifyFacing({
      street: state.street,
      potType: state.potType,
      toCallBB: state.toCallBB,
      raises,
      limps,
      opener,
    }),
    stackBb: state.heroStackBB,
    headsUp: state.isHeadsUp,
    multiway: state.isMultiway,
  };
}

export function initialOpenRange(position: Position, archetypeId = "balanced"): Float64Array {
  const prior = ARCHETYPE_BY_ID[archetypeId] ?? ARCHETYPE_BY_ID.balanced!;
  const types: Record<string, number> = {};
  const situation: Situation = {
    street: "preflop",
    potType: "limped",
    position,
    facing: "unopened",
    stackBb: 100,
    headsUp: false,
    multiway: false,
  };
  for (const combo of allCombos()) {
    const mix = preflopBaseline(combo, situation);
    const widen = (prior.looseness - 0.42) * 0.35;
    types[combo.type] = Math.max(types[combo.type] ?? 0, clamp01(mix.raise + widen));
  }
  return rangeFromTypes(types);
}

export function updateRangeForAction(
  prior: Float64Array,
  position: Position,
  action: string,
  state: AgentGameState,
  blocked: number[],
): Float64Array {
  const situation = inferSituation({ ...state, position });
  return applyActionLikelihood(
    prior,
    (combo) => {
      const mix = preflopBaseline(combo, situation);
      const a = action.toLowerCase();
      if (a === "fold") return mix.fold;
      if (a === "call" || a === "check") return Math.max(mix.call, a === "check" ? 0.6 : 0.05);
      if (a === "raise" || a === "bet") return Math.max(mix.raise, 0.02);
      return 0.05;
    },
    new Set(blocked),
  );
}

export function decide(state: AgentGameState, ctx: DecisionContext): AgentDecision {
  const legal = new Set(state.legalActions);
  if (legal.size === 0) {
    return fallbackDecision(state, "CHECK");
  }

  const situation = inferSituation(state);
  const hero = parseHole(state.holeCards);
  const board = parseCards(state.board);
  const blocked = [...hero, ...board];
  const combo = allCombos()[comboIndexFor(hero[0], hero[1])]!;
  const villainRanges = [...ctx.ranges.values()].filter((r) => r);
  const primaryRange = villainRanges[0] ?? uniformRange(new Set(blocked));

  const accuracyTrials = trialsFor(ctx.accuracy, state.street);
  const equity =
    state.street === "preflop"
      ? {
          equity: preflopEquityVsRange(hero, primaryRange),
          exact: false,
          trials: 0,
          win: 0,
          tie: 0,
          lose: 0,
        }
      : villainRanges.length > 1
        ? equityHeroVsRanges({
            hero,
            ranges: villainRanges,
            board,
            trials: accuracyTrials,
            seed: ctx.rng.int(1_000_000),
          })
        : equityHeroVsRange({
            hero,
            range: primaryRange,
            board,
            trials: accuracyTrials,
            seed: ctx.rng.int(1_000_000),
            exactRiver: state.street === "river",
          });

  const potOdds = state.toCallBB > 0 ? state.toCallBB / (state.potBB + state.toCallBB) : 0;
  const requiredEquity = potOdds;
  const texture = classifyBoard(board);
  const made = describeMadeHand([...hero], board);
  const draws = detectDraws([...hero], board);
  const blockers = blockerNotes([...hero], board);
  const foldEquity = estimateFoldEquity(state, ctx, texture);
  const showdownValue = showdownClass(equity.equity, made, draws);

  const candidates = buildCandidates(state, situation, legal);
  const evs = candidates.map((candidate) =>
    evaluateCandidate(candidate, state, equity.equity, foldEquity, potOdds),
  );

  const baseline = baselineMix(combo, situation, candidates, state, equity.equity, made, draws);
  let final = { ...baseline };
  const exploits: ExploitRecord[] = [];
  let opponentAdjustment: string | undefined;

  if (ctx.mode === "exploitative") {
    const adj = applyExploits(state, ctx, baseline, candidates, evs, foldEquity);
    final = adj.strategy;
    exploits.push(...adj.exploits);
    opponentAdjustment = adj.note;
  }

  const picked = sampleAction(final, candidates, ctx.rng, legal);
  const pickedEv = evs.find((e) => e.action === picked.action && almostEq(e.amountBB, picked.amountBB))?.evBB ?? evs[0]?.evBB ?? 0;
  const confidence = actionConfidence(final, picked.action, equity.equity, evs);

  const explanation: DecisionExplanation = {
    action: picked.action,
    amountBB: picked.amountBB,
    confidence,
    potBB: state.potBB,
    heroEquity: equity.equity,
    estimatedFoldEquity: foldEquity,
    heroHandStrength: made,
    potOdds,
    requiredEquity,
    spr: state.spr,
    effectiveStackBB: state.effectiveStackBB,
    position: state.position,
    boardTexture: state.board.length ? texture : undefined,
    rangeAdvantage: equity.equity - 0.5,
    nutAdvantage: nutAdvantage(made, draws, texture),
    blockers,
    draws,
    showdownValue,
    impliedOddsBB: impliedOdds(state, equity.equity, draws),
    baselineStrategy: baseline,
    opponentAdjustment,
    finalStrategy: final,
    selectedAction: picked.action,
    estimatedEvBB: pickedEv,
    evs,
    exploits,
    notes: buildNotes(state, situation, equity.equity, potOdds, foldEquity),
  };

  return { action: picked.action, amountBB: picked.amountBB, explanation };
}

interface Candidate {
  action: ActionType;
  amountBB?: number;
}

function buildCandidates(state: AgentGameState, situation: Situation, legal: Set<ActionType>): Candidate[] {
  const out: Candidate[] = [];
  if (legal.has("FOLD")) out.push({ action: "FOLD" });
  if (legal.has("CHECK")) out.push({ action: "CHECK" });
  if (legal.has("CALL")) out.push({ action: "CALL" });
  const sizes = sizingFor(situation);
  if (legal.has("BET")) {
    for (const frac of sizes) {
      const amt = clampSize(state.potBB * frac, state.minRaiseToBB ?? 1, state.maxRaiseToBB ?? state.heroStackBB);
      out.push({ action: "BET", amountBB: amt });
    }
    out.push({ action: "BET", amountBB: Math.min(state.heroStackBB, state.maxRaiseToBB ?? state.heroStackBB) });
  }
  if (legal.has("RAISE")) {
    const opens = situation.street === "preflop" ? sizes : [2.5, 3.2];
    for (const sz of opens) {
      const amt =
        situation.street === "preflop"
          ? sz
          : clampSize(state.currentBetBB + state.potBB * (sz - 2), state.minRaiseToBB ?? state.currentBetBB * 2, state.maxRaiseToBB ?? state.heroStackBB);
      const clipped = clampSize(amt, state.minRaiseToBB ?? amt, state.maxRaiseToBB ?? state.heroStackBB);
      out.push({ action: "RAISE", amountBB: clipped });
    }
  }
  return uniqueCandidates(out);
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    const key = `${c.action}:${c.amountBB?.toFixed(2) ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function evaluateCandidate(
  candidate: Candidate,
  state: AgentGameState,
  equity: number,
  foldEquity: number,
  potOdds: number,
): EvBreakdown {
  if (candidate.action === "FOLD") {
    return { action: "FOLD", evBB: 0, details: "EV(fold) = 0 by convention (chips already in pot are sunk)." };
  }
  if (candidate.action === "CHECK") {
    const ev = equity * state.potBB - (1 - equity) * 0;
    return {
      action: "CHECK",
      evBB: (equity - 0.5) * state.potBB * 0.35,
      details: `Checking realizes showdown/equity realization on a ${state.potBB.toFixed(1)} BB pot (eq=${pct(equity)}). Raw pot share ${ev.toFixed(2)}.`,
    };
  }
  if (candidate.action === "CALL") {
    const call = state.toCallBB;
    const finalPot = state.potBB + call;
    const ev = equity * finalPot - call;
    return {
      action: "CALL",
      evBB: ev,
      details: `EV(call) = ${pct(equity)} × ${finalPot.toFixed(2)} − ${call.toFixed(2)} = ${ev.toFixed(2)} BB. Required equity ${pct(potOdds)}.`,
    };
  }

  const bet = candidate.amountBB ?? 0;
  const invested = candidate.action === "RAISE" ? Math.max(0, bet - (state.currentBetBB - state.toCallBB)) : bet;
  const pFold = clamp01(foldEquity * foldEquityBySize(bet, state.potBB));
  const pRaise = state.isMultiway ? 0.12 : 0.08;
  const pCall = clamp01(1 - pFold - pRaise);
  const potIfCalled = state.potBB + invested + invested;
  const evCalled = equity * potIfCalled - invested;
  const evRaised = -invested * 0.72;
  const ev = pFold * state.potBB + pCall * evCalled + pRaise * evRaised;
  return {
    action: candidate.action,
    amountBB: bet,
    evBB: ev,
    details: `EV(bet ${bet.toFixed(1)}) = ${pct(pFold)}×${state.potBB.toFixed(1)} + ${pct(pCall)}×(${pct(equity)}×${potIfCalled.toFixed(1)}−${invested.toFixed(1)}) + ${pct(pRaise)}×(${evRaised.toFixed(2)}) = ${ev.toFixed(2)}`,
  };
}

function baselineMix(
  combo: Combo,
  situation: Situation,
  candidates: Candidate[],
  state: AgentGameState,
  equity: number,
  made: string,
  draws: string[],
): MixedStrategy {
  const pre = preflopBaseline(combo, situation);
  const sizes: Record<string, number> = {};
  let fold = 0;
  let check = 0;
  let call = 0;
  let bet = 0;
  let raise = 0;

  if (situation.street === "preflop") {
    fold = candidates.some((c) => c.action === "FOLD") ? pre.fold : 0;
    call = candidates.some((c) => c.action === "CALL") ? pre.call : 0;
    check = candidates.some((c) => c.action === "CHECK") ? Math.max(pre.call, 0.15) : 0;
    raise = candidates.some((c) => c.action === "RAISE") ? pre.raise : 0;
    bet = candidates.some((c) => c.action === "BET") ? pre.raise : 0;
  } else {
    const wantBet = state.toCallBB === 0;
    const strongMade = ["Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"].includes(made);
    const pair = made === "Pair";
    const hasDraw = draws.length > 0;
    const value = equity > 0.62 || strongMade;
    const drawish = hasDraw && equity > 0.32;
    if (wantBet) {
      bet = value ? 0.7 : drawish ? 0.42 : pair ? 0.35 : 0.16;
      check = 1 - bet;
    } else {
      const needed = state.toCallBB / (state.potBB + state.toCallBB);
      call = equity + (hasDraw ? 0.08 : 0) > needed - 0.03 ? 0.62 : 0.18;
      raise = value ? 0.26 : drawish && state.isHeadsUp ? 0.14 : 0.05;
      fold = Math.max(0, 1 - call - raise);
    }
  }

  const betCandidates = candidates.filter((c) => c.action === "BET" || c.action === "RAISE");
  if (betCandidates.length) {
    const share = 1 / betCandidates.length;
    for (const c of betCandidates) {
      if (c.amountBB !== undefined) sizes[c.amountBB.toFixed(2)] = share;
    }
  }

  return normalizeStrategy({ fold, check, call, bet, raise, sizesBB: sizes });
}

function applyExploits(
  state: AgentGameState,
  ctx: DecisionContext,
  baseline: MixedStrategy,
  _candidates: Candidate[],
  evs: EvBreakdown[],
  foldEquity: number,
): { strategy: MixedStrategy; exploits: ExploitRecord[]; note?: string } {
  const strategy = { ...baseline, sizesBB: { ...baseline.sizesBB } };
  const exploits: ExploitRecord[] = [];
  const notes: string[] = [];

  for (const [pos, model] of ctx.opponents) {
    if (pos === state.position) continue;
    const foldStat =
      state.street === "preflop" && (state.position === "CO" || state.position === "BTN" || state.position === "SB")
        ? model.hud.foldToSteal
        : state.street === "flop"
          ? model.hud.foldToFlopCBet
          : model.hud.foldToTurnCBet;
    const threeBet = model.hud.threeBet;
    const riverBet = model.hud.riverBet;

    if (foldStat.confidence > 0.35 && foldStat.estimate - foldStat.priorMean > 0.08) {
      const bump = Math.min(0.35, (foldStat.estimate - foldStat.priorMean) * foldStat.confidence);
      const before = describeMix(strategy);
      strategy.bet += bump;
      strategy.raise += bump * 0.6;
      strategy.fold = Math.max(0, strategy.fold - bump * 0.4);
      strategy.call = Math.max(0, strategy.call - bump * 0.4);
      strategy.check = Math.max(0, strategy.check - bump * 0.4);
      exploits.push({
        name: "Overfold exploit",
        evidence: `${model.name} (${pos}) folds ${pct(foldStat.estimate)} vs population ${pct(foldStat.priorMean)}.`,
        sampleSize: foldStat.sampleSize,
        confidence: foldStat.confidence,
        baselineAction: before,
        adjustedAction: "Increase bluff/bet frequency",
        estimatedEvDiffBB: bump * state.potBB * 0.35,
      });
      notes.push(`${model.name} overfolds; increasing bluff frequency.`);
    }

    if (foldStat.confidence > 0.35 && foldStat.priorMean - foldStat.estimate > 0.08) {
      const cut = Math.min(0.3, (foldStat.priorMean - foldStat.estimate) * foldStat.confidence);
      const before = describeMix(strategy);
      strategy.bet = Math.max(0, strategy.bet - cut);
      strategy.raise = Math.max(0, strategy.raise - cut * 0.5);
      strategy.call += cut * 0.4;
      exploits.push({
        name: "Underfold exploit",
        evidence: `${model.name} continues too often (fold ${pct(foldStat.estimate)} vs ${pct(foldStat.priorMean)}).`,
        sampleSize: foldStat.sampleSize,
        confidence: foldStat.confidence,
        baselineAction: before,
        adjustedAction: "Cut marginal bluffs, value thicker",
        estimatedEvDiffBB: cut * 0.2,
      });
      notes.push(`${model.name} underfolds; reducing bluffs.`);
    }

    if (threeBet.confidence > 0.4 && threeBet.estimate - threeBet.priorMean > 0.04 && state.street === "preflop") {
      const before = describeMix(strategy);
      strategy.raise = Math.max(0, strategy.raise - 0.12 * threeBet.confidence);
      strategy.fold += 0.06 * threeBet.confidence;
      exploits.push({
        name: "High 3-bet exploit",
        evidence: `${model.name} 3-bets ${pct(threeBet.estimate)} (prior ${pct(threeBet.priorMean)}).`,
        sampleSize: threeBet.sampleSize,
        confidence: threeBet.confidence,
        baselineAction: before,
        adjustedAction: "Tighten opens / widen 4-bet value",
        estimatedEvDiffBB: 0.08,
      });
    }

    if (riverBet.confidence > 0.4 && riverBet.estimate < riverBet.priorMean - 0.08 && state.street === "river" && state.toCallBB > 0) {
      const before = describeMix(strategy);
      strategy.fold += 0.18 * riverBet.confidence;
      strategy.call = Math.max(0, strategy.call - 0.18 * riverBet.confidence);
      exploits.push({
        name: "Low river bluff exploit",
        evidence: `${model.name} river bet ${pct(riverBet.estimate)} vs prior ${pct(riverBet.priorMean)}; bluffs are scarce.`,
        sampleSize: riverBet.sampleSize,
        confidence: riverBet.confidence,
        baselineAction: before,
        adjustedAction: "Tighten bluff-catchers",
        estimatedEvDiffBB: 0.12,
      });
    }
  }

  void foldEquity;
  void evs;
  return {
    strategy: normalizeStrategy(strategy),
    exploits,
    note: notes.join(" ") || undefined,
  };
}

function sampleAction(
  mix: MixedStrategy,
  candidates: Candidate[],
  rng: SeededRng,
  legal: Set<ActionType>,
): Candidate {
  const weighted: Candidate[] = [];
  const weights: number[] = [];
  for (const c of candidates) {
    if (!legal.has(c.action)) continue;
    let w = 0.01;
    if (c.action === "FOLD") w = mix.fold;
    else if (c.action === "CHECK") w = mix.check;
    else if (c.action === "CALL") w = mix.call;
    else if (c.action === "BET") w = mix.bet * (c.amountBB !== undefined ? mix.sizesBB[c.amountBB.toFixed(2)] ?? 1 : 1);
    else if (c.action === "RAISE") w = mix.raise * (c.amountBB !== undefined ? mix.sizesBB[c.amountBB.toFixed(2)] ?? 1 : 1);
    weighted.push(c);
    weights.push(Math.max(0, w));
  }
  if (!weighted.length) {
    if (legal.has("CHECK")) return { action: "CHECK" };
    if (legal.has("FOLD")) return { action: "FOLD" };
    return candidates[0]!;
  }
  return rng.pickWeighted(weighted, weights);
}

function estimateFoldEquity(state: AgentGameState, ctx: DecisionContext, texture: { wetness: number }): number {
  if (state.isMultiway) {
    let p = 1;
    for (const model of ctx.opponents.values()) {
      const f = state.street === "flop" ? model.hud.foldToFlopCBet.estimate : model.hud.foldToTurnCBet.estimate;
      p *= f;
    }
    return clamp01(p * (1 - texture.wetness * 0.35));
  }
  const first = [...ctx.opponents.values()][0];
  const base =
    state.street === "preflop"
      ? first?.hud.foldToSteal.estimate ?? 0.55
      : state.street === "flop"
        ? first?.hud.foldToFlopCBet.estimate ?? 0.42
        : first?.hud.foldToTurnCBet.estimate ?? 0.38;
  return clamp01(base * (1 - texture.wetness * 0.4) * (state.potType === "3bet" ? 0.85 : 1));
}

function foldEquityBySize(bet: number, pot: number): number {
  if (pot <= 0) return 1;
  const ratio = bet / pot;
  return clamp01(0.75 + ratio * 0.35);
}

function impliedOdds(state: AgentGameState, equity: number, draws: string[]): number | undefined {
  if (!draws.length || state.street === "river") return undefined;
  return Math.max(0, (state.effectiveStackBB - state.toCallBB) * (equity - 0.2) * 0.25);
}

function nutAdvantage(made: string, draws: string[], texture: { dynamism: string }): number {
  if (["Straight Flush", "Four of a Kind", "Full House", "Flush", "Straight"].includes(made)) return 0.7;
  if (draws.includes("Flush Draw") && texture.dynamism !== "static") return 0.25;
  return 0;
}

function showdownClass(equity: number, made: string, draws: string[]): string {
  if (["Full House", "Four of a Kind", "Straight Flush", "Flush", "Straight"].includes(made)) return "Strong showdown value";
  if (equity >= 0.55) return "Good showdown value";
  if (draws.length) return "Limited showdown value, draw equity";
  if (equity >= 0.4) return "Marginal showdown value";
  return "Weak showdown value";
}

function actionConfidence(mix: MixedStrategy, action: ActionType, equity: number, evs: EvBreakdown[]): number {
  const freq =
    action === "FOLD"
      ? mix.fold
      : action === "CHECK"
        ? mix.check
        : action === "CALL"
          ? mix.call
          : action === "BET"
            ? mix.bet
            : mix.raise;
  const best = Math.max(...evs.map((e) => e.evBB), 0);
  return clamp01(0.35 + freq * 0.4 + Math.min(0.2, Math.abs(best) / 4) + (equity > 0.7 ? 0.1 : 0));
}

function buildNotes(state: AgentGameState, situation: Situation, equity: number, potOdds: number, fe: number): string[] {
  const notes = [
    `${state.potType} ${state.isHeadsUp ? "heads-up" : "multiway"} ${state.street}`,
    `Facing ${situation.facing}; equity ${pct(equity)} vs required ${pct(potOdds)}`,
    `Estimated fold equity ${pct(fe)}; SPR ${state.spr.toFixed(2)}`,
  ];
  if (equity + 0.02 < potOdds && state.toCallBB > 0) notes.push("Below pot-odds threshold without implied odds.");
  return notes;
}

function normalizeStrategy(s: MixedStrategy): MixedStrategy {
  const keys: (keyof MixedStrategy)[] = ["fold", "check", "call", "bet", "raise"];
  let sum = 0;
  for (const k of keys) sum += Math.max(0, s[k] as number);
  if (sum <= 0) return { fold: 0, check: 1, call: 0, bet: 0, raise: 0, sizesBB: s.sizesBB };
  const out: MixedStrategy = { ...s, sizesBB: s.sizesBB };
  for (const k of keys) (out[k] as number) = Math.max(0, s[k] as number) / sum;
  return out;
}

function describeMix(s: MixedStrategy): string {
  const parts = [
    s.fold > 0.02 ? `Fold ${pct(s.fold)}` : "",
    s.check > 0.02 ? `Check ${pct(s.check)}` : "",
    s.call > 0.02 ? `Call ${pct(s.call)}` : "",
    s.bet > 0.02 ? `Bet ${pct(s.bet)}` : "",
    s.raise > 0.02 ? `Raise ${pct(s.raise)}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "Mixed";
}

function fallbackDecision(state: AgentGameState, action: ActionType): AgentDecision {
  const empty: MixedStrategy = { fold: 0, check: 1, call: 0, bet: 0, raise: 0, sizesBB: {} };
  return {
    action,
    explanation: {
      action,
      confidence: 0.5,
      potBB: state.potBB,
      heroEquity: 0.5,
      estimatedFoldEquity: 0,
      heroHandStrength: "Unknown",
      potOdds: 0,
      requiredEquity: 0,
      spr: state.spr,
      effectiveStackBB: state.effectiveStackBB,
      position: state.position,
      blockers: [],
      draws: [],
      showdownValue: "Unknown",
      baselineStrategy: empty,
      finalStrategy: empty,
      selectedAction: action,
      estimatedEvBB: 0,
      evs: [],
      exploits: [],
      notes: ["No legal actions beyond fallback."],
    },
  };
}

function clampSize(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function almostEq(a?: number, b?: number): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) < 0.02;
}

export function strategyMatrix(
  situation: Situation,
  action: "raise" | "call" | "fold" = "raise",
): { type: string; frequency: number }[] {
  const seen = new Map<string, { total: number; n: number }>();
  for (const combo of allCombos()) {
    const mix = preflopBaseline(combo, situation);
    const cur = seen.get(combo.type) ?? { total: 0, n: 0 };
    cur.total += mix[action];
    cur.n += 1;
    seen.set(combo.type, cur);
  }
  return [...seen.entries()].map(([type, v]) => ({ type, frequency: v.total / v.n }));
}

export function mixedStrategyForType(type: string, situation: Situation): { raise: number; call: number; fold: number } {
  const combos = allCombos().filter((c) => c.type === type);
  const acc = { raise: 0, call: 0, fold: 0 };
  for (const combo of combos) {
    const mix = preflopBaseline(combo, situation);
    acc.raise += mix.raise;
    acc.call += mix.call;
    acc.fold += mix.fold;
  }
  const n = combos.length || 1;
  return { raise: acc.raise / n, call: acc.call / n, fold: acc.fold / n };
}

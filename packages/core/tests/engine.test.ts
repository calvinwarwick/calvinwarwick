import { describe, expect, it } from "vitest";
import {
  applyAction,
  createSeats,
  finishHand,
  legalActions,
  potChips,
  startHand,
  toAgentState,
} from "../src/engine.js";
import { DEFAULT_TABLE_CONFIG, chipsToBb } from "../src/types.js";

function table(seed = 1) {
  const seats = createSeats([100, 100, 100, 100, 100, 100], ["H", "A", "B", "C", "D", "E"], 0, [], DEFAULT_TABLE_CONFIG);
  return startHand({ seats, button: 0, seed, handId: "t1" });
}

describe("betting engine", () => {
  it("posts blinds and deals hole cards", () => {
    const state = table(7);
    expect(state.seats.every((s) => s.hole.length === 2)).toBe(true);
    const sb = state.seats.find((s) => s.seat === 1)!;
    const bb = state.seats.find((s) => s.seat === 2)!;
    expect(sb.totalCommitted).toBe(40);
    expect(bb.totalCommitted).toBe(100);
    expect(potChips(state)).toBe(140);
    expect(state.toAct).not.toBeNull();
  });

  it("lists fold/call/raise facing a bet and check/bet when cheap", () => {
    const state = table(3);
    const legal = legalActions(state);
    expect(legal.map((a) => a.type)).toEqual(expect.arrayContaining(["FOLD", "CALL", "RAISE"]));
    applyAction(state, "FOLD");
    applyAction(state, "FOLD");
    applyAction(state, "FOLD");
    applyAction(state, "FOLD");
    const sbLegal = legalActions(state);
    expect(sbLegal.map((a) => a.type)).toEqual(expect.arrayContaining(["FOLD", "CALL", "RAISE"]));
  });

  it("enforces minimum raises", () => {
    const state = table(11);
    const open = legalActions(state).find((a) => a.type === "RAISE")!;
    expect(open.minToChips).toBeGreaterThanOrEqual(200);
    applyAction(state, "RAISE", 250);
    const next = legalActions(state).find((a) => a.type === "RAISE")!;
    expect(next.minToChips).toBeGreaterThanOrEqual(400);
  });

  it("awards an uncontested pot without a showdown", () => {
    const state = table(5);
    while (!state.complete && state.toAct !== null) {
      const actor = state.seats[state.toAct]!;
      if (actor.isHero) applyAction(state, "RAISE", 250);
      else applyAction(state, "FOLD");
    }
    const history = finishHand(state);
    expect(history.showdown).toBe(false);
    expect(history.heroProfitChips).toBeGreaterThan(0);
    expect(history.seats.find((s) => s.isHero)!.stackChips).toBeGreaterThan(10000);
  });

  it("supports all-in for less than a full raise", () => {
    const seats = createSeats([100, 100, 8, 100, 100, 100], ["H", "A", "Short", "C", "D", "E"], 0, [], DEFAULT_TABLE_CONFIG);
    const state = startHand({ seats, button: 0, seed: 21, handId: "ai" });
    const short = state.seats[2]!;
    expect(short.stack).toBeLessThan(1000);
    while (!state.complete && state.toAct !== null) {
      const legal = legalActions(state);
      if (legal.some((a) => a.type === "RAISE")) applyAction(state, "RAISE", legal.find((a) => a.type === "RAISE")!.maxToChips);
      else if (legal.some((a) => a.type === "CALL")) applyAction(state, "CALL");
      else applyAction(state, legal[0]!.type);
    }
    const history = finishHand(state);
    const stacks = history.seats.reduce((s, p) => s + p.stackChips, 0);
    const start = 100 * 100 * 5 + 8 * 100;
    expect(stacks + history.rakeChips).toBe(start);
  });

  it("preserves chip conservation across a full hand", () => {
    const state = table(99);
    const start = state.seats.reduce((s, p) => s + p.stack + p.totalCommitted, 0);
    while (!state.complete && state.toAct !== null) {
      const legal = legalActions(state);
      if (legal.some((a) => a.type === "CHECK")) applyAction(state, "CHECK");
      else if (legal.some((a) => a.type === "CALL")) applyAction(state, "CALL");
      else applyAction(state, "FOLD");
    }
    const history = finishHand(state);
    const end = history.seats.reduce((s, p) => s + p.stackChips, 0) + history.rakeChips;
    expect(end).toBe(start);
  });

  it("exposes structured agent state in BB", () => {
    const state = table(4);
    const actor = state.seats[state.toAct!]!;
    const gs = toAgentState(state, actor.id);
    expect(gs.potBB).toBeCloseTo(1.4);
    expect(gs.holeCards).toHaveLength(2);
    expect(gs.position).toBe("UTG");
    expect(gs.legalActions.length).toBeGreaterThan(0);
    expect(chipsToBb(100)).toBe(1);
  });
});

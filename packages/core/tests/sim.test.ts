import { describe, expect, it } from "vitest";
import { decide, inferSituation, mixedStrategyForType } from "../src/agent.js";
import { winrateReport } from "../src/analytics.js";
import { ARCHETYPE_BY_ID, createHud } from "../src/opponents.js";
import { uniformRange } from "../src/ranges.js";
import { SeededRng } from "../src/rng.js";
import { defaultSimulationConfig, runSimulation } from "../src/sim.js";
import type { AgentGameState } from "../src/types.js";

describe("decision engine", () => {
  it("returns a legal action with a full explanation", () => {
    const state: AgentGameState = {
      position: "BTN",
      heroStackBB: 103.4,
      villainStacksBB: { SB: 91.2, BB: 147.8 },
      holeCards: ["As", "Jh"],
      board: [],
      potBB: 1.5,
      toCallBB: 2.5,
      currentBetBB: 2.5,
      minRaiseToBB: 8,
      maxRaiseToBB: 103.4,
      street: "preflop",
      potType: "single-raised",
      isHeadsUp: false,
      isMultiway: true,
      spr: 40,
      effectiveStackBB: 91.2,
      actionHistory: [
        { player: "UTG", action: "fold" },
        { player: "HJ", action: "fold" },
        { player: "CO", action: "raise", amountBB: 2.5 },
      ],
      legalActions: ["FOLD", "CALL", "RAISE"],
    };
    const hud = createHud(ARCHETYPE_BY_ID.balanced!);
    const decision = decide(state, {
      rng: new SeededRng(9),
      mode: "exploitative",
      accuracy: "fast",
      opponents: new Map([["CO", { id: "co", name: "CO", archetypeId: "tag", hud, range: null }]]),
      ranges: new Map([["CO", uniformRange()]]),
      heroId: "hero",
    });
    expect(["FOLD", "CALL", "RAISE"]).toContain(decision.action);
    expect(decision.explanation.heroEquity).toBeGreaterThan(0);
    expect(decision.explanation.evs.length).toBeGreaterThan(0);
    expect(decision.explanation.notes.length).toBeGreaterThan(0);
    if (decision.action === "RAISE") expect(decision.amountBB).toBeGreaterThan(2.5);
  });

  it("produces mixed frequencies for A5s vs a CO open", () => {
    const mix = mixedStrategyForType("A5s", {
      street: "preflop",
      potType: "single-raised",
      position: "BTN",
      opener: "CO",
      facing: "open",
      stackBb: 100,
      headsUp: false,
      multiway: true,
    });
    expect(mix.raise).toBeGreaterThan(0.05);
    expect(mix.call).toBeGreaterThan(0.05);
    expect(mix.fold).toBeGreaterThan(0);
    expect(mix.raise + mix.call + mix.fold).toBeCloseTo(1, 5);
  });

  it("classifies steal-facing and 3-bet pots", () => {
    const situation = inferSituation({
      position: "BB",
      heroStackBB: 100,
      villainStacksBB: { BTN: 100 },
      holeCards: ["Ah", "5h"],
      board: [],
      potBB: 3.5,
      toCallBB: 2.5,
      currentBetBB: 2.5,
      street: "preflop",
      potType: "single-raised",
      isHeadsUp: true,
      isMultiway: false,
      spr: 28,
      effectiveStackBB: 100,
      actionHistory: [
        { player: "UTG", action: "fold" },
        { player: "HJ", action: "fold" },
        { player: "CO", action: "fold" },
        { player: "BTN", action: "raise", amountBB: 2.5 },
        { player: "SB", action: "fold" },
      ],
      legalActions: ["FOLD", "CALL", "RAISE"],
    });
    expect(situation.facing).toBe("open");
    expect(situation.opener).toBe("BTN");
  });
});

describe("simulation", () => {
  it("plays a deterministic batch and conserves seats", () => {
    const result = runSimulation(
      defaultSimulationConfig({
        hands: 12,
        seed: 2026,
        mode: "baseline",
        accuracy: "fast",
        storeExplanations: true,
      }),
    );
    expect(result.handsPlayed).toBe(12);
    expect(result.results).toHaveLength(12);
    expect(result.analytics.uncertainty.sampleSize).toBe(12);
    expect(result.analytics.uncertainty.note.toLowerCase()).toContain("variance");
    expect(result.opponents).toHaveLength(5);
    const replay = runSimulation(defaultSimulationConfig({ hands: 12, seed: 2026, accuracy: "fast" }));
    expect(replay.results.map((r) => r.profitBb)).toEqual(result.results.map((r) => r.profitBb));
  });
});

describe("uncertainty", () => {
  it("does not crown a 2000-hand heater as proven superior", () => {
    const hot = winrateReport(Array.from({ length: 2000 }, () => 0.08), Array.from({ length: 2000 }, () => 0.03));
    const modest = winrateReport(Array.from({ length: 2000 }, () => 0.03), Array.from({ length: 2000 }, () => 0.03));
    expect(hot.observedWinrateBb100).toBeCloseTo(8, 0);
    expect(modest.observedWinrateBb100).toBeCloseTo(3, 0);
    const hotWidth = hot.ci95[1] - hot.ci95[0];
    expect(hotWidth).toBeGreaterThan(0);
    expect(hot.note.toLowerCase()).toContain("variance");
  });
});

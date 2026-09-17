import { describe, expect, it } from "vitest";
import { parseCards } from "../src/cards.js";
import { applyRake, awardPots, buildSidePots, splitChips } from "../src/pots.js";

describe("side pots", () => {
  it("builds a main pot and side pot for a short all-in", () => {
    const pots = buildSidePots([
      { id: "A", totalCommitted: 10000, folded: false, hole: [] },
      { id: "B", totalCommitted: 10000, folded: false, hole: [] },
      { id: "C", totalCommitted: 4000, folded: false, hole: [] },
    ]);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toMatchObject({ amountChips: 12000, eligibleIds: ["A", "B", "C"] });
    expect(pots[1]).toMatchObject({ amountChips: 12000, eligibleIds: ["A", "B"] });
  });

  it("keeps folded chips in the pot but not eligibility", () => {
    const pots = buildSidePots([
      { id: "A", totalCommitted: 800, folded: false, hole: [] },
      { id: "B", totalCommitted: 800, folded: false, hole: [] },
      { id: "C", totalCommitted: 250, folded: true, hole: [] },
    ]);
    expect(pots[0]?.amountChips).toBe(750);
    expect(pots[0]?.eligibleIds).toEqual(["A", "B"]);
    expect(pots[1]?.amountChips).toBe(1100);
    expect(pots[1]?.eligibleIds).toEqual(["A", "B"]);
  });

  it("awards the known 3-way all-in mathematically", () => {
    const board = parseCards("2c 7d 9h Js Qs");
    const players = [
      { id: "nuts", totalCommitted: 5000, folded: false, hole: parseCards("As Ah") },
      { id: "mid", totalCommitted: 2000, folded: false, hole: parseCards("Kd Kc") },
      { id: "short", totalCommitted: 1000, folded: false, hole: parseCards("3c 3d") },
    ];
    const pots = buildSidePots(players);
    const awards = awardPots(pots, players, board);
    expect(awards.every((a) => a.winnerIds.includes("nuts"))).toBe(true);
    expect(awards.reduce((s, a) => s + a.amountChips, 0)).toBe(8000);
  });

  it("splits pots on exact ties", () => {
    const board = parseCards("Ah Kd Qc 7s 2d");
    const players = [
      { id: "A", totalCommitted: 1000, folded: false, hole: parseCards("Js Ts") },
      { id: "B", totalCommitted: 1000, folded: false, hole: parseCards("Jh Th") },
    ];
    const awards = awardPots(buildSidePots(players), players, board);
    expect(awards[0]?.split).toBe(true);
    expect(awards[0]?.winnerIds).toEqual(["A", "B"]);
    expect(splitChips(1000, 2)).toEqual([500, 500]);
    expect(splitChips(1001, 2)).toEqual([501, 500]);
  });

  it("applies configurable rake and no-flop-no-drop", () => {
    expect(applyRake(10000, 0.05, 1200, true, true)).toEqual({ netPot: 9500, rake: 500 });
    expect(applyRake(10000, 0.05, 300, true, true)).toEqual({ netPot: 9700, rake: 300 });
    expect(applyRake(10000, 0.05, 1200, false, true)).toEqual({ netPot: 10000, rake: 0 });
    expect(applyRake(10000, 0.05, 1200, false, false)).toEqual({ netPot: 9500, rake: 500 });
  });
});

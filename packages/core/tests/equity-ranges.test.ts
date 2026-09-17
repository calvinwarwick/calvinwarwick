import { describe, expect, it } from "vitest";
import { parseCards } from "../src/cards.js";
import { equityHeroVsRange } from "../src/equity.js";
import { createStat, observe } from "../src/opponents.js";
import { allCombos, applyActionLikelihood, COMBO_COUNT, rangeFromTypes, uniformRange } from "../src/ranges.js";
import { SeededRng } from "../src/rng.js";

describe("ranges", () => {
  it("enumerates all 1326 combinations", () => {
    expect(allCombos()).toHaveLength(COMBO_COUNT);
    expect(new Set(allCombos().map((c) => c.key)).size).toBe(COMBO_COUNT);
  });

  it("reweights a range after an action", () => {
    const prior = uniformRange();
    const updated = applyActionLikelihood(prior, (combo) => (combo.pair ? 1 : 0.05));
    const pairMass = allCombos()
      .filter((c) => c.pair)
      .reduce((s, c) => s + updated[c.index]!, 0);
    expect(pairMass).toBeGreaterThan(0.4);
  });

  it("removes blocked cards from a constructed range", () => {
    const blocked = new Set(parseCards(["As", "Kh"]));
    const range = rangeFromTypes({ AA: 1, AKs: 1, AKo: 1 }, blocked);
    const massOnAs = allCombos()
      .filter((c) => c.a === parseCards(["As"])[0] || c.b === parseCards(["As"])[0])
      .reduce((s, c) => s + range[c.index]!, 0);
    expect(massOnAs).toBe(0);
  });
});

describe("equity", () => {
  it("gives AA a large favourite vs 72o", () => {
    const hero = parseCards(["As", "Ad"]) as [number, number];
    const range = rangeFromTypes({ "72o": 1 });
    const eq = equityHeroVsRange({ hero, range, trials: 250, seed: 1 });
    expect(eq.equity).toBeGreaterThan(0.8);
    expect(eq.equity).toBeLessThan(0.95);
  });

  it("is near a coin flip for identical hands on a dry board", () => {
    const hero = parseCards(["Qc", "Jc"]) as [number, number];
    const range = rangeFromTypes({ QJo: 1 });
    const board = parseCards(["2d", "8h", "4s", "9c", "3h"]);
    const eq = equityHeroVsRange({ hero, range, board, exactRiver: true });
    expect(eq.exact).toBe(true);
    expect(eq.equity).toBeGreaterThan(0.35);
    expect(eq.equity).toBeLessThan(0.65);
  });
});

describe("EV identities", () => {
  it("matches the call formula on a known river", () => {
    const equity = 0.4;
    const pot = 10;
    const call = 5;
    const ev = equity * (pot + call) - call;
    expect(ev).toBeCloseTo(1);
  });

  it("matches the fold-equity mix formula", () => {
    const pot = 8;
    const bet = 4;
    const pFold = 0.5;
    const pCall = 0.5;
    const equity = 0.3;
    const evCalled = equity * (pot + bet + bet) - bet;
    const ev = pFold * pot + pCall * evCalled;
    expect(ev).toBeCloseTo(0.5 * 8 + 0.5 * (0.3 * 16 - 4));
    expect(ev).toBeCloseTo(4.4);
  });
});

describe("Bayesian HUD", () => {
  it("stays close to the prior after five observations", () => {
    let stat = createStat(0.58);
    for (let i = 0; i < 5; i++) stat = observe(stat, true);
    expect(stat.observed).toBe(1);
    expect(stat.estimate).toBeLessThan(0.7);
    expect(stat.confidence).toBeLessThan(0.2);
  });

  it("moves toward the player after hundreds of observations", () => {
    let stat = createStat(0.58);
    for (let i = 0; i < 400; i++) stat = observe(stat, i % 5 !== 0);
    expect(stat.estimate).toBeGreaterThan(0.72);
    expect(stat.confidence).toBeGreaterThan(0.9);
    expect(stat.sampleSize).toBe(400);
  });
});

describe("seeded rng", () => {
  it("is reproducible", () => {
    const a = new SeededRng(123);
    const b = new SeededRng(123);
    expect([a.next(), a.next(), a.int(10)]).toEqual([b.next(), b.next(), b.int(10)]);
  });
});

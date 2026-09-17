import { describe, expect, it } from "vitest";
import { parseCards } from "../src/cards.js";
import { categoryOf, compareHands, evaluateHand, HAND_CATEGORY, straightHighFromMask } from "../src/evaluator.js";

function rank(cards: string): number {
  return evaluateHand(parseCards(cards.split(" ")));
}

describe("hand evaluator", () => {
  it("orders the nine categories correctly", () => {
    const royal = rank("As Ks Qs Js Ts 2d 3c");
    const quads = rank("Ah Ad Ac As Kh 2d 3c");
    const boat = rank("Ah Ad Ac Kh Kd 2c 3c");
    const flush = rank("Ah Kh 9h 5h 2h 3c 4d");
    const straight = rank("9s 8h 7d 6c 5s 2h 3c");
    const trips = rank("Ah Ad Ac 9s 5h 2c 3d");
    const two = rank("Ah Ad Kh Kd 9s 2c 3d");
    const pair = rank("Ah Ad 9s 7c 5h 2d 3c");
    const high = rank("Ah Kd 9s 7c 5h 2d 3c");
    expect(categoryOf(royal)).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
    expect(royal).toBeGreaterThan(quads);
    expect(quads).toBeGreaterThan(boat);
    expect(boat).toBeGreaterThan(flush);
    expect(flush).toBeGreaterThan(straight);
    expect(straight).toBeGreaterThan(trips);
    expect(trips).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(pair);
    expect(pair).toBeGreaterThan(high);
  });

  it("treats A-5 as a wheel and loses to 6-high", () => {
    const wheel = rank("As 2d 3c 4h 5s 9c Kd");
    const sixHigh = rank("2d 3c 4h 5s 6d 9c Kd");
    expect(categoryOf(wheel)).toBe(HAND_CATEGORY.STRAIGHT);
    expect(categoryOf(sixHigh)).toBe(HAND_CATEGORY.STRAIGHT);
    expect(sixHigh).toBeGreaterThan(wheel);
  });

  it("detects steel wheel and royal flush", () => {
    const steel = rank("As 2s 3s 4s 5s 9c Kd");
    const royal = rank("As Ks Qs Js Ts 9c 2d");
    expect(categoryOf(steel)).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
    expect(royal).toBeGreaterThan(steel);
  });

  it("compares kickers and full houses", () => {
    expect(rank("Ah Ad Ac Kh Kd 2c 3d")).toBeGreaterThan(rank("Kh Kd Kc Qh Qd 2c 3d"));
    expect(rank("Ah Ad 9s 8c 7h 2d 3c")).toBeGreaterThan(rank("Ah Ad 9s 8c 6h 2d 3c"));
    expect(rank("Ah Ad Kh Kd 9s 2c 3d")).toBeGreaterThan(rank("Ah Ad Kh Kd 8s 2c 3d"));
  });

  it("uses a higher kicker to break two-pair ties", () => {
    expect(rank("Ah Ad Kh Kd 9s 3c 2d")).toBeGreaterThan(rank("Ah Ad Kh Kd 8s 3c 2d"));
  });

  it("ties identical boards", () => {
    const board = parseCards("Ah Kd 9s 4c 2h");
    const a = evaluateHand([...parseCards("Qc Jc"), ...board]);
    const b = evaluateHand([...parseCards("Qs Jh"), ...board]);
    expect(a).toBe(b);
    expect(compareHands([...parseCards("Qc Jc"), ...board], [...parseCards("Qs Jh"), ...board])).toBe(0);
  });

  it("evaluates 5-card hands", () => {
    expect(categoryOf(rank("As Ks Qs Js Ts"))).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
    expect(categoryOf(rank("Ah Ad Ac As Kh"))).toBe(HAND_CATEGORY.QUADS);
  });

  it("computes wheel mask correctly", () => {
    const wheelMask = (1 << 12) | 0b1111;
    expect(straightHighFromMask(wheelMask)).toBe(3);
  });
});

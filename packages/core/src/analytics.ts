import type { HandHistory, Position, UncertaintyReport } from "./types.js";
import { chipsToBb } from "./types.js";

export interface HandResult {
  handId: string;
  profitBb: number;
  evBb: number;
  position: Position;
  potType: HandHistory["potType"];
  holeCards: string;
  showdown: boolean;
  stackBb: number;
  opponentArchetypes: string[];
}

export function handToResult(history: HandHistory): HandResult {
  const hero = history.seats.find((s) => s.id === history.heroId) ?? history.seats.find((s) => s.isHero)!;
  const bb = history.config.chipsPerBb;
  return {
    handId: history.handId,
    profitBb: chipsToBb(history.heroProfitChips, bb),
    evBb: chipsToBb(history.heroEvChips, bb),
    position: hero.position,
    potType: history.potType,
    holeCards: hero.holeCards?.join(" ") ?? "",
    showdown: history.showdown,
    stackBb: chipsToBb(hero.stackChips - history.heroProfitChips, bb),
    opponentArchetypes: history.seats.filter((s) => !s.isHero && s.archetype).map((s) => s.archetype!),
  };
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

export function stdDev(values: number[]): number {
  return Math.sqrt(variance(values));
}

export function winrateReport(profitsBb: number[], evsBb: number[]): UncertaintyReport {
  const n = profitsBb.length;
  const observed = n ? mean(profitsBb) * 100 : 0;
  const ev = evsBb.length ? mean(evsBb) * 100 : observed;
  const empiricalSd = n ? stdDev(profitsBb.map((v) => v * 100)) : 0;
  const typicalSdBb100 = 90;
  const sd = Math.max(empiricalSd, typicalSdBb100);
  const se = n ? sd / Math.sqrt(n) : 0;
  const empiricalEvSd = evsBb.length ? stdDev(evsBb.map((v) => v * 100)) : empiricalSd;
  const evSd = Math.max(empiricalEvSd, typicalSdBb100);
  const evSe = n ? evSd / Math.sqrt(n || 1) : 0;
  const note =
    n < 20000
      ? "Short-term results are dominated by variance. Do not treat this as proof one strategy is superior."
      : "Sample is large enough for a usable interval, but overlap can still reverse rankings.";
  return {
    sampleSize: n,
    observedWinrateBb100: observed,
    evWinrateBb100: ev,
    stdDevBb100: sd,
    stdErrorBb100: se,
    ci95: [observed - 1.96 * se, observed + 1.96 * se],
    evCi95: [ev - 1.96 * evSe, ev + 1.96 * evSe],
    note,
  };
}

export interface AnalyticsBundle {
  hands: number;
  bb100: number;
  ev100: number;
  allInAdjBb100: number;
  totalBb: number;
  evBb: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  wtsd: number;
  wsd: number;
  byPosition: Record<string, { hands: number; bb100: number; ev100: number }>;
  byPotType: Record<string, { hands: number; bb100: number }>;
  byArchetype: Record<string, { hands: number; bb100: number }>;
  byStack: Record<string, { hands: number; bb100: number }>;
  startingHands: { hand: string; hands: number; profitBb: number; evBb: number }[];
  bankroll: { hand: number; bb: number; ev: number }[];
  uncertainty: UncertaintyReport;
}

export function summarize(
  results: HandResult[],
  frequencies?: { vpip: number; pfr: number; threeBet: number; wtsd: number; wsd: number },
): AnalyticsBundle {
  const profits = results.map((r) => r.profitBb);
  const evs = results.map((r) => r.evBb);
  const uncertainty = winrateReport(profits, evs);
  const byPosition: AnalyticsBundle["byPosition"] = {};
  const byPotType: AnalyticsBundle["byPotType"] = {};
  const byArchetype: AnalyticsBundle["byArchetype"] = {};
  const byStack: AnalyticsBundle["byStack"] = {};
  const handsMap = new Map<string, { hands: number; profitBb: number; evBb: number }>();

  for (const r of results) {
    addGroup(byPosition, r.position, r);
    addGroup(byPotType, r.potType, r);
    const bucket = r.stackBb < 60 ? "40-60" : r.stackBb < 90 ? "60-90" : r.stackBb < 130 ? "90-130" : "130-200";
    addGroup(byStack, bucket, r);
    for (const arch of r.opponentArchetypes) addGroup(byArchetype, arch, r);
    const key = r.holeCards;
    const cur = handsMap.get(key) ?? { hands: 0, profitBb: 0, evBb: 0 };
    cur.hands += 1;
    cur.profitBb += r.profitBb;
    cur.evBb += r.evBb;
    handsMap.set(key, cur);
  }

  let cum = 0;
  let cumEv = 0;
  const bankroll = results.map((r, i) => {
    cum += r.profitBb;
    cumEv += r.evBb;
    return { hand: i + 1, bb: cum, ev: cumEv };
  });

  const n = results.length || 1;
  return {
    hands: results.length,
    bb100: uncertainty.observedWinrateBb100,
    ev100: uncertainty.evWinrateBb100,
    allInAdjBb100: uncertainty.evWinrateBb100,
    totalBb: profits.reduce((a, b) => a + b, 0),
    evBb: evs.reduce((a, b) => a + b, 0),
    vpip: frequencies?.vpip ?? 0,
    pfr: frequencies?.pfr ?? 0,
    threeBet: frequencies?.threeBet ?? 0,
    wtsd: frequencies?.wtsd ?? 0,
    wsd: frequencies?.wsd ?? 0,
    byPosition,
    byPotType,
    byArchetype,
    byStack,
    startingHands: [...handsMap.entries()]
      .map(([hand, v]) => ({ hand, ...v }))
      .sort((a, b) => b.profitBb - a.profitBb)
      .slice(0, 80),
    bankroll: downsample(bankroll, 400),
    uncertainty,
  };
}

function addGroup(
  target: Record<string, { hands: number; bb100: number; ev100?: number }>,
  key: string,
  r: HandResult,
): void {
  const cur = target[key] ?? { hands: 0, bb100: 0, ev100: 0, _p: 0, _e: 0 };
  const ext = cur as { hands: number; bb100: number; ev100?: number; _p?: number; _e?: number };
  ext.hands += 1;
  ext._p = (ext._p ?? 0) + r.profitBb;
  ext._e = (ext._e ?? 0) + r.evBb;
  ext.bb100 = (ext._p / ext.hands) * 100;
  ext.ev100 = (ext._e / ext.hands) * 100;
  target[key] = ext;
}

function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]!);
  return out;
}

export function compareExperiments(a: UncertaintyReport, b: UncertaintyReport): {
  observedDelta: number;
  evDelta: number;
  overlapping: boolean;
  verdict: string;
} {
  const observedDelta = b.observedWinrateBb100 - a.observedWinrateBb100;
  const evDelta = b.evWinrateBb100 - a.evWinrateBb100;
  const overlapping = !(b.ci95[0] > a.ci95[1] || a.ci95[0] > b.ci95[1]);
  const verdict = overlapping
    ? "Confidence intervals overlap. The data do not establish that either strategy is superior."
    : evDelta > 0
      ? "EV intervals are separated; B is likely better under this matchup, but replication is still required."
      : "EV intervals are separated; A is likely better under this matchup, but replication is still required.";
  return { observedDelta, evDelta, overlapping, verdict };
}

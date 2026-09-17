import type { ArchetypePrior, PlayerHudStats, StatEstimate } from "./types.js";

const PRIOR_STRENGTH = 40;

export const ARCHETYPES: ArchetypePrior[] = [
  {
    id: "tight-passive",
    label: "Tight Passive",
    description: "Nitty, rarely applies pressure, folds to aggression.",
    vpip: 0.14,
    pfr: 0.08,
    threeBet: 0.03,
    foldTo3Bet: 0.72,
    fourBet: 0.02,
    ats: 0.16,
    foldToSteal: 0.78,
    flopCBet: 0.38,
    turnCBet: 0.28,
    riverBet: 0.22,
    foldToFlopCBet: 0.58,
    foldToTurnCBet: 0.52,
    checkRaise: 0.04,
    wtsd: 0.22,
    wsd: 0.54,
    aggression: 0.22,
    looseness: 0.2,
    bluffFrequency: 0.12,
    callDownFrequency: 0.28,
  },
  {
    id: "loose-passive",
    label: "Loose Passive",
    description: "Sees too many flops, rarely raises, pays off value.",
    vpip: 0.36,
    pfr: 0.09,
    threeBet: 0.035,
    foldTo3Bet: 0.48,
    fourBet: 0.015,
    ats: 0.18,
    foldToSteal: 0.55,
    flopCBet: 0.34,
    turnCBet: 0.24,
    riverBet: 0.2,
    foldToFlopCBet: 0.32,
    foldToTurnCBet: 0.28,
    checkRaise: 0.05,
    wtsd: 0.34,
    wsd: 0.46,
    aggression: 0.18,
    looseness: 0.72,
    bluffFrequency: 0.1,
    callDownFrequency: 0.62,
  },
  {
    id: "tag",
    label: "TAG",
    description: "Tight-aggressive regular with disciplined ranges.",
    vpip: 0.22,
    pfr: 0.18,
    threeBet: 0.08,
    foldTo3Bet: 0.64,
    fourBet: 0.045,
    ats: 0.3,
    foldToSteal: 0.68,
    flopCBet: 0.66,
    turnCBet: 0.48,
    riverBet: 0.4,
    foldToFlopCBet: 0.44,
    foldToTurnCBet: 0.4,
    checkRaise: 0.08,
    wtsd: 0.26,
    wsd: 0.53,
    aggression: 0.42,
    looseness: 0.38,
    bluffFrequency: 0.28,
    callDownFrequency: 0.36,
  },
  {
    id: "lag",
    label: "LAG",
    description: "Loose-aggressive regular, high pressure, wider bluffs.",
    vpip: 0.29,
    pfr: 0.24,
    threeBet: 0.12,
    foldTo3Bet: 0.52,
    fourBet: 0.07,
    ats: 0.42,
    foldToSteal: 0.58,
    flopCBet: 0.74,
    turnCBet: 0.58,
    riverBet: 0.5,
    foldToFlopCBet: 0.36,
    foldToTurnCBet: 0.34,
    checkRaise: 0.11,
    wtsd: 0.27,
    wsd: 0.5,
    aggression: 0.58,
    looseness: 0.58,
    bluffFrequency: 0.4,
    callDownFrequency: 0.34,
  },
  {
    id: "recreational",
    label: "Recreational",
    description: "Wide, inconsistent, weak vs size and position.",
    vpip: 0.44,
    pfr: 0.12,
    threeBet: 0.05,
    foldTo3Bet: 0.4,
    fourBet: 0.02,
    ats: 0.22,
    foldToSteal: 0.5,
    flopCBet: 0.48,
    turnCBet: 0.32,
    riverBet: 0.28,
    foldToFlopCBet: 0.34,
    foldToTurnCBet: 0.3,
    checkRaise: 0.06,
    wtsd: 0.35,
    wsd: 0.45,
    aggression: 0.25,
    looseness: 0.8,
    bluffFrequency: 0.22,
    callDownFrequency: 0.58,
  },
  {
    id: "agg-rec",
    label: "Aggressive Recreational",
    description: "Splashy and aggressive without balanced frequencies.",
    vpip: 0.41,
    pfr: 0.23,
    threeBet: 0.11,
    foldTo3Bet: 0.34,
    fourBet: 0.06,
    ats: 0.4,
    foldToSteal: 0.42,
    flopCBet: 0.8,
    turnCBet: 0.62,
    riverBet: 0.55,
    foldToFlopCBet: 0.28,
    foldToTurnCBet: 0.26,
    checkRaise: 0.12,
    wtsd: 0.33,
    wsd: 0.47,
    aggression: 0.62,
    looseness: 0.78,
    bluffFrequency: 0.48,
    callDownFrequency: 0.5,
  },
  {
    id: "calling-station",
    label: "Calling Station",
    description: "Refuses to fold once involved. Thin value prints.",
    vpip: 0.4,
    pfr: 0.08,
    threeBet: 0.03,
    foldTo3Bet: 0.22,
    fourBet: 0.01,
    ats: 0.14,
    foldToSteal: 0.28,
    flopCBet: 0.3,
    turnCBet: 0.2,
    riverBet: 0.16,
    foldToFlopCBet: 0.16,
    foldToTurnCBet: 0.14,
    checkRaise: 0.03,
    wtsd: 0.4,
    wsd: 0.44,
    aggression: 0.14,
    looseness: 0.85,
    bluffFrequency: 0.06,
    callDownFrequency: 0.82,
  },
  {
    id: "over-agg-reg",
    label: "Over-Aggressive Regular",
    description: "Competent but over-bluffs and over-3-bets.",
    vpip: 0.26,
    pfr: 0.23,
    threeBet: 0.15,
    foldTo3Bet: 0.5,
    fourBet: 0.09,
    ats: 0.46,
    foldToSteal: 0.55,
    flopCBet: 0.82,
    turnCBet: 0.64,
    riverBet: 0.58,
    foldToFlopCBet: 0.4,
    foldToTurnCBet: 0.38,
    checkRaise: 0.13,
    wtsd: 0.25,
    wsd: 0.49,
    aggression: 0.66,
    looseness: 0.5,
    bluffFrequency: 0.46,
    callDownFrequency: 0.3,
  },
  {
    id: "balanced",
    label: "Balanced Baseline",
    description: "Population-approximate regular used as a prior.",
    vpip: 0.24,
    pfr: 0.19,
    threeBet: 0.085,
    foldTo3Bet: 0.58,
    fourBet: 0.05,
    ats: 0.32,
    foldToSteal: 0.66,
    flopCBet: 0.64,
    turnCBet: 0.46,
    riverBet: 0.38,
    foldToFlopCBet: 0.42,
    foldToTurnCBet: 0.38,
    checkRaise: 0.08,
    wtsd: 0.26,
    wsd: 0.52,
    aggression: 0.4,
    looseness: 0.42,
    bluffFrequency: 0.3,
    callDownFrequency: 0.38,
  },
];

export const ARCHETYPE_BY_ID = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));

export function createStat(priorMean: number, priorStrength = PRIOR_STRENGTH): StatEstimate {
  const alpha = priorMean * priorStrength;
  const beta = (1 - priorMean) * priorStrength;
  return {
    opportunities: 0,
    successes: 0,
    observed: null,
    estimate: priorMean,
    priorMean,
    confidence: 0,
    sampleSize: 0,
    ...{ alpha, beta, priorStrength },
  } as StatEstimate & { alpha: number; beta: number; priorStrength: number };
}

type InternalStat = StatEstimate & { alpha: number; beta: number; priorStrength: number };

export function observe(stat: StatEstimate, success: boolean): StatEstimate {
  const s = stat as InternalStat;
  const opportunities = s.opportunities + 1;
  const successes = s.successes + (success ? 1 : 0);
  const alpha = (s.alpha ?? s.priorMean * PRIOR_STRENGTH) + (success ? 1 : 0);
  const beta = (s.beta ?? (1 - s.priorMean) * PRIOR_STRENGTH) + (success ? 0 : 1);
  const estimate = alpha / (alpha + beta);
  const sampleSize = opportunities;
  const confidence = 1 - Math.exp(-sampleSize / PRIOR_STRENGTH);
  return {
    opportunities,
    successes,
    observed: successes / opportunities,
    estimate,
    priorMean: s.priorMean,
    confidence,
    sampleSize,
    alpha,
    beta,
    priorStrength: s.priorStrength ?? PRIOR_STRENGTH,
  } as StatEstimate;
}

export function createHud(prior: ArchetypePrior): PlayerHudStats {
  return {
    hands: 0,
    vpip: createStat(prior.vpip),
    pfr: createStat(prior.pfr),
    threeBet: createStat(prior.threeBet),
    foldTo3Bet: createStat(prior.foldTo3Bet),
    fourBet: createStat(prior.fourBet),
    ats: createStat(prior.ats),
    foldToSteal: createStat(prior.foldToSteal),
    flopCBet: createStat(prior.flopCBet),
    turnCBet: createStat(prior.turnCBet),
    riverBet: createStat(prior.riverBet),
    foldToFlopCBet: createStat(prior.foldToFlopCBet),
    foldToTurnCBet: createStat(prior.foldToTurnCBet),
    checkRaise: createStat(prior.checkRaise),
    wtsd: createStat(prior.wtsd),
    wsd: createStat(prior.wsd),
    aggressionFrequency: createStat(prior.aggression),
  };
}

export interface OpponentModel {
  id: string;
  name: string;
  archetypeId: string;
  hud: PlayerHudStats;
  range: Float64Array | null;
}

export function serializeHud(hud: PlayerHudStats): PlayerHudStats {
  const clean = <T extends StatEstimate>(s: T): StatEstimate => ({
    opportunities: s.opportunities,
    successes: s.successes,
    observed: s.observed,
    estimate: s.estimate,
    priorMean: s.priorMean,
    confidence: s.confidence,
    sampleSize: s.sampleSize,
  });
  return {
    hands: hud.hands,
    vpip: clean(hud.vpip),
    pfr: clean(hud.pfr),
    threeBet: clean(hud.threeBet),
    foldTo3Bet: clean(hud.foldTo3Bet),
    fourBet: clean(hud.fourBet),
    ats: clean(hud.ats),
    foldToSteal: clean(hud.foldToSteal),
    flopCBet: clean(hud.flopCBet),
    turnCBet: clean(hud.turnCBet),
    riverBet: clean(hud.riverBet),
    foldToFlopCBet: clean(hud.foldToFlopCBet),
    foldToTurnCBet: clean(hud.foldToTurnCBet),
    checkRaise: clean(hud.checkRaise),
    wtsd: clean(hud.wtsd),
    wsd: clean(hud.wsd),
    aggressionFrequency: clean(hud.aggressionFrequency),
  };
}

export function updateHudFromHand(
  hud: PlayerHudStats,
  events: {
    vpip?: boolean;
    pfr?: boolean;
    threeBet?: boolean;
    faced3Bet?: boolean;
    foldedTo3Bet?: boolean;
    fourBet?: boolean;
    stealChance?: boolean;
    stole?: boolean;
    facedSteal?: boolean;
    foldedToSteal?: boolean;
    flopCBetChance?: boolean;
    flopCBet?: boolean;
    turnCBetChance?: boolean;
    turnCBet?: boolean;
    riverBetChance?: boolean;
    riverBet?: boolean;
    facedFlopCBet?: boolean;
    foldedToFlopCBet?: boolean;
    facedTurnCBet?: boolean;
    foldedToTurnCBet?: boolean;
    checkRaiseChance?: boolean;
    checkRaise?: boolean;
    wentToShowdown?: boolean;
    wonShowdown?: boolean;
    aggressiveAction?: boolean;
    actionOpportunity?: boolean;
  },
): PlayerHudStats {
  const next = { ...hud, hands: hud.hands + 1 };
  if (events.vpip !== undefined) next.vpip = observe(next.vpip, events.vpip);
  if (events.pfr !== undefined) next.pfr = observe(next.pfr, events.pfr);
  if (events.threeBet !== undefined) next.threeBet = observe(next.threeBet, events.threeBet);
  if (events.faced3Bet) next.foldTo3Bet = observe(next.foldTo3Bet, Boolean(events.foldedTo3Bet));
  if (events.fourBet !== undefined) next.fourBet = observe(next.fourBet, events.fourBet);
  if (events.stealChance) next.ats = observe(next.ats, Boolean(events.stole));
  if (events.facedSteal) next.foldToSteal = observe(next.foldToSteal, Boolean(events.foldedToSteal));
  if (events.flopCBetChance) next.flopCBet = observe(next.flopCBet, Boolean(events.flopCBet));
  if (events.turnCBetChance) next.turnCBet = observe(next.turnCBet, Boolean(events.turnCBet));
  if (events.riverBetChance) next.riverBet = observe(next.riverBet, Boolean(events.riverBet));
  if (events.facedFlopCBet) next.foldToFlopCBet = observe(next.foldToFlopCBet, Boolean(events.foldedToFlopCBet));
  if (events.facedTurnCBet) next.foldToTurnCBet = observe(next.foldToTurnCBet, Boolean(events.foldedToTurnCBet));
  if (events.checkRaiseChance) next.checkRaise = observe(next.checkRaise, Boolean(events.checkRaise));
  if (events.wentToShowdown !== undefined) next.wtsd = observe(next.wtsd, events.wentToShowdown);
  if (events.wonShowdown !== undefined) next.wsd = observe(next.wsd, events.wonShowdown);
  if (events.actionOpportunity) next.aggressionFrequency = observe(next.aggressionFrequency, Boolean(events.aggressiveAction));
  return next;
}

export function mixPopulation(ids: string[]): ArchetypePrior[] {
  return ids.map((id) => ARCHETYPE_BY_ID[id] ?? ARCHETYPE_BY_ID.balanced!);
}

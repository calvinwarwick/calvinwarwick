import { decide, inferSituation, initialOpenRange, updateRangeForAction, type DecisionContext } from "./agent.js";
import { handToResult, summarize, type AnalyticsBundle, type HandResult } from "./analytics.js";
import {
  applyAction,
  createSeats,
  finishHand,
  legalActions,
  positionOf,
  rotateButton,
  startHand,
  toAgentState,
  type Seat,
  type TableState,
} from "./engine.js";
import { ARCHETYPE_BY_ID, createHud, updateHudFromHand, type OpponentModel } from "./opponents.js";
import { parseCards } from "./cards.js";
import { uniformRange } from "./ranges.js";
import { SeededRng } from "./rng.js";
import {
  DEFAULT_TABLE_CONFIG,
  bbToChips,
  chipsToBb,
  type Accuracy,
  type ActionType,
  type AgentDecision,
  type HandHistory,
  type Position,
  type StrategyMode,
  type TableConfig,
} from "./types.js";

export interface SimPlayerConfig {
  name: string;
  archetypeId: string;
  isHero: boolean;
  stackBb?: number;
}

export interface SimulationConfig {
  hands: number;
  seed: number;
  mode: StrategyMode;
  accuracy: Accuracy;
  table: TableConfig;
  players: SimPlayerConfig[];
  heroIndex: number;
  storeExplanations: boolean;
  storeEveryHand: boolean;
  onHand?: (event: HandEvent) => void;
  onDecision?: (event: DecisionEvent) => void;
  shouldStop?: () => boolean;
}

export interface DecisionEvent {
  handId: string;
  street: string;
  actor: string;
  position: Position;
  isHero: boolean;
  decision: AgentDecision;
  state: ReturnType<typeof toAgentState>;
}

export interface HandEvent {
  index: number;
  history: HandHistory;
  result: HandResult;
}

export interface SimulationResult {
  config: Omit<SimulationConfig, "onHand" | "onDecision" | "shouldStop">;
  histories: HandHistory[];
  results: HandResult[];
  analytics: AnalyticsBundle;
  decisions: { handId: string; explanation: AgentDecision["explanation"] }[];
  opponents: { id: string; name: string; archetypeId: string; hud: OpponentModel["hud"] }[];
  heroHud: OpponentModel["hud"];
  elapsedMs: number;
  handsPlayed: number;
}

const DEFAULT_PLAYERS: SimPlayerConfig[] = [
  { name: "Hero", archetypeId: "balanced", isHero: true },
  { name: "Nora TAG", archetypeId: "tag", isHero: false },
  { name: "Luis LAG", archetypeId: "lag", isHero: false },
  { name: "Rita Rec", archetypeId: "recreational", isHero: false },
  { name: "Stan Station", archetypeId: "calling-station", isHero: false },
  { name: "Omar Overagg", archetypeId: "over-agg-reg", isHero: false },
];

export function defaultSimulationConfig(partial: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    hands: 200,
    seed: 42,
    mode: "baseline",
    accuracy: "fast",
    table: { ...DEFAULT_TABLE_CONFIG },
    players: DEFAULT_PLAYERS,
    heroIndex: 0,
    storeExplanations: true,
    storeEveryHand: true,
    ...partial,
  };
}

export function runSimulation(config: SimulationConfig): SimulationResult {
  const started = Date.now();
  const rng = new SeededRng(config.seed);
  const table = config.table;
  const names = config.players.map((p) => p.name);
  const archetypes = config.players.map((p) => p.archetypeId);
  const stacks = config.players.map((p) => p.stackBb ?? jitterStack(table.defaultBuyInBb, table.minBuyInBb, table.maxBuyInBb, rng));
  let seats = createSeats(stacks, names, config.heroIndex, archetypes, table);
  let button = 0;

  const models = new Map<string, OpponentModel>();
  for (const seat of seats) {
    const prior = ARCHETYPE_BY_ID[seat.archetype ?? "balanced"] ?? ARCHETYPE_BY_ID.balanced!;
    models.set(seat.id, {
      id: seat.id,
      name: seat.name,
      archetypeId: prior.id,
      hud: createHud(prior),
      range: null,
    });
  }

  const histories: HandHistory[] = [];
  const results: HandResult[] = [];
  const decisions: { handId: string; explanation: AgentDecision["explanation"] }[] = [];
  let vpipN = 0,
    vpipD = 0,
    pfrN = 0,
    pfrD = 0,
    tbN = 0,
    tbD = 0,
    wtsdN = 0,
    wtsdD = 0,
    wsdN = 0,
    wsdD = 0;

  for (let i = 0; i < config.hands; i++) {
    if (config.shouldStop?.()) break;
    rebuy(seats, table, rng);
    const seed = rng.int(2 ** 31);
    const state = startHand({
      seats: cloneSeats(seats),
      button,
      seed,
      handId: `${config.seed}-${i + 1}`,
      config: table,
    });

    const ranges = new Map<string, Float64Array>();
    for (const seat of state.seats) {
      if (seat.folded) continue;
      ranges.set(positionOf(state, seat), initialOpenRange(positionOf(state, seat), seat.archetype));
    }

    const ctxBase = {
      mode: config.mode,
      accuracy: config.accuracy,
      heroId: state.seats.find((s) => s.isHero)?.id ?? "seat-0",
    };

    const heroStreetActions: string[] = [];
    const playerEvents = new Map<string, Parameters<typeof updateHudFromHand>[1]>();
    let guard = 0;

    while (!state.complete && state.toAct !== null) {
      if (++guard > 96) break;
      const actor = state.seats[state.toAct]!;
      const agentState = toAgentState(state, actor.id);
      const rngHand = rng.fork(seed ^ (state.actionLog.length + 1) ^ (actor.seat * 97));
      const opponents = new Map<string, OpponentModel>();
      for (const seat of state.seats) {
        if (seat.id === actor.id) continue;
        const model = models.get(seat.id);
        if (model) opponents.set(positionOf(state, seat), model);
      }
      const ctx: DecisionContext = {
        ...ctxBase,
        rng: rngHand,
        opponents,
        ranges,
      };
      const decision = decide(agentState, ctx);
      if (actor.isHero && config.storeExplanations) {
        decisions.push({ handId: state.handId, explanation: decision.explanation });
      }
      config.onDecision?.({
        handId: state.handId,
        street: state.street,
        actor: actor.name,
        position: positionOf(state, actor),
        isHero: actor.isHero,
        decision,
        state: agentState,
      });

      const amountChips =
        decision.amountBB !== undefined ? bbToChips(decision.amountBB, table.chipsPerBb) : undefined;
      const legal = legalActions(state);
      const action = coerceLegal(decision.action, legal);
      applyAction(state, action, amountChips);

      const blocked = [
        ...parseCards(agentState.holeCards),
        ...parseCards(agentState.board),
      ];
      const pos = positionOf(state, actor);
      const prior = ranges.get(pos) ?? uniformRange();
      ranges.set(pos, updateRangeForAction(prior, pos, action, agentState, blocked));

      recordActionEvents(playerEvents, actor, action, agentState, state);
      if (actor.isHero) heroStreetActions.push(action);
    }

    const history = finishHand(state);
    const result = handToResult(history);
    results.push(result);
    if (config.storeEveryHand) histories.push(history);

    for (const seat of state.seats) {
      const model = models.get(seat.id);
      if (!model) continue;
      const ev = playerEvents.get(seat.id) ?? {};
      ev.wentToShowdown = history.showdown && !seat.folded;
      if (ev.wentToShowdown) {
        const won = history.winners.some((w) => w.playerId === seat.id && w.amountChips > 0);
        ev.wonShowdown = won;
      }
      model.hud = updateHudFromHand(model.hud, ev);
    }

    const hero = state.seats.find((s) => s.isHero)!;
    const heroVoluntarily = heroStreetActions.some((a) => a === "CALL" || a === "BET" || a === "RAISE");
    const heroRaised = heroStreetActions.some((a) => a === "BET" || a === "RAISE");
    vpipD++;
    if (heroVoluntarily) vpipN++;
    pfrD++;
    if (heroRaised && history.actions.some((a) => a.playerId === hero.id && a.street === "preflop" && (a.action === "RAISE" || a.action === "BET")))
      pfrN++;
    if (history.actions.some((a) => a.street === "preflop" && a.action === "RAISE")) {
      const hero3 = history.actions.filter((a) => a.street === "preflop" && a.action === "RAISE" && a.playerId === hero.id).length >= 1 && history.potType !== "single-raised" && history.potType !== "limped";
      tbD++;
      if (hero3) tbN++;
    }
    if (heroVoluntarily && history.flopSeen !== undefined) {
      // wtsd among saw flop
    }
    if (history.board.length >= 3 && !hero.folded) {
      wtsdD++;
      if (history.showdown) wtsdN++;
    }
    if (history.showdown && !hero.folded) {
      wsdD++;
      if (history.heroProfitChips > 0) wsdN++;
    }

    seats = state.seats.map((s) => ({
      ...s,
      committed: 0,
      totalCommitted: 0,
      folded: false,
      allIn: false,
      hole: [],
      hasActedThisRound: false,
    }));
    button = rotateButton(button, table.seats);
    config.onHand?.({ index: i, history, result });
  }

  const analytics = summarize(results, {
    vpip: vpipD ? vpipN / vpipD : 0,
    pfr: pfrD ? pfrN / pfrD : 0,
    threeBet: tbD ? tbN / tbD : 0,
    wtsd: wtsdD ? wtsdN / wtsdD : 0,
    wsd: wsdD ? wsdN / wsdD : 0,
  });

  const heroModel = models.get(seats.find((s) => s.isHero)!.id)!;
  return {
    config: {
      hands: config.hands,
      seed: config.seed,
      mode: config.mode,
      accuracy: config.accuracy,
      table: config.table,
      players: config.players,
      heroIndex: config.heroIndex,
      storeExplanations: config.storeExplanations,
      storeEveryHand: config.storeEveryHand,
    },
    histories,
    results,
    analytics,
    decisions,
    opponents: [...models.values()]
      .filter((m) => m.id !== heroModel.id)
      .map((m) => ({ id: m.id, name: m.name, archetypeId: m.archetypeId, hud: m.hud })),
    heroHud: heroModel.hud,
    elapsedMs: Date.now() - started,
    handsPlayed: results.length,
  };
}

function recordActionEvents(
  map: Map<string, Parameters<typeof updateHudFromHand>[1]>,
  actor: Seat,
  action: ActionType,
  agentState: ReturnType<typeof toAgentState>,
  state: TableState,
): void {
  const ev = map.get(actor.id) ?? {};
  const vol = action === "CALL" || action === "BET" || action === "RAISE";
  if (state.street === "preflop") {
    if (vol) ev.vpip = true;
    else if (ev.vpip === undefined) ev.vpip = false;
    if (action === "RAISE" || action === "BET") ev.pfr = true;
    else if (ev.pfr === undefined) ev.pfr = false;
    const raisesBefore = state.actionLog.filter((a) => a.street === "preflop" && a.action === "RAISE").length;
    if (raisesBefore === 1 && (action === "RAISE" || action === "FOLD" || action === "CALL")) {
      ev.threeBet = action === "RAISE";
      if (action === "FOLD") ev.foldedTo3Bet = true;
      if (action === "FOLD" || action === "CALL" || action === "RAISE") ev.faced3Bet = raisesBefore >= 1 && action !== "RAISE" ? true : raisesBefore >= 1;
    }
    const pos = agentState.position;
    if ((pos === "CO" || pos === "BTN" || pos === "SB") && raisesBefore === 0) {
      ev.stealChance = true;
      ev.stole = action === "RAISE" || action === "BET";
    }
  }
  if (state.street === "flop" && state.lastAggressor === actor.seat) {
    ev.flopCBetChance = true;
    ev.flopCBet = action === "BET" || action === "RAISE";
  }
  if (state.street === "turn" && (action === "BET" || action === "CHECK")) {
    ev.turnCBetChance = true;
    ev.turnCBet = action === "BET";
  }
  if (state.street === "river" && (action === "BET" || action === "CHECK")) {
    ev.riverBetChance = true;
    ev.riverBet = action === "BET";
  }
  ev.actionOpportunity = true;
  ev.aggressiveAction = action === "BET" || action === "RAISE";
  map.set(actor.id, ev);
}

function coerceLegal(action: ActionType, legal: { type: ActionType }[]): ActionType {
  if (legal.some((a) => a.type === action)) return action;
  if (legal.some((a) => a.type === "CHECK")) return "CHECK";
  if (legal.some((a) => a.type === "CALL")) return "CALL";
  if (legal.some((a) => a.type === "FOLD")) return "FOLD";
  return legal[0]?.type ?? "CHECK";
}

function jitterStack(def: number, min: number, max: number, rng: SeededRng): number {
  const raw = def + (rng.next() - 0.5) * 40;
  return Math.max(min, Math.min(max, raw));
}

function rebuy(seats: Seat[], table: TableConfig, rng: SeededRng): void {
  for (const seat of seats) {
    const bb = chipsToBb(seat.stack, table.chipsPerBb);
    if (bb > table.maxBuyInBb) {
      seat.stack = bbToChips(table.maxBuyInBb, table.chipsPerBb);
    } else if (bb < table.minBuyInBb * 0.4) {
      seat.stack = bbToChips(jitterStack(table.defaultBuyInBb, table.minBuyInBb, table.maxBuyInBb, rng), table.chipsPerBb);
    }
  }
}

function cloneSeats(seats: Seat[]): Seat[] {
  return seats.map((s) => ({ ...s, hole: [], committed: 0, totalCommitted: 0, folded: false, allIn: false, hasActedThisRound: false }));
}

export interface ExperimentSpec {
  name: string;
  mode: StrategyMode;
  hands: number;
  seed: number;
  accuracy?: Accuracy;
  population?: string[];
}

export function runExperiment(spec: ExperimentSpec): SimulationResult {
  const players = (spec.population ?? DEFAULT_PLAYERS.map((p) => p.archetypeId)).map((id, i) => ({
    name: i === 0 ? "Hero" : ARCHETYPE_BY_ID[id]?.label ?? `Villain ${i}`,
    archetypeId: i === 0 ? "balanced" : id,
    isHero: i === 0,
  }));
  if (players.length < 6) {
    while (players.length < 6) {
      players.push({
        name: `Fill ${players.length}`,
        archetypeId: "balanced",
        isHero: false,
      });
    }
  }
  players[0] = { name: "Hero", archetypeId: "balanced", isHero: true };
  return runSimulation(
    defaultSimulationConfig({
      hands: spec.hands,
      seed: spec.seed,
      mode: spec.mode,
      accuracy: spec.accuracy ?? "fast",
      players,
      storeExplanations: spec.hands <= 5000,
    }),
  );
}

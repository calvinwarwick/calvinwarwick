import {
  defaultSimulationConfig,
  runExperiment,
  runSimulation,
  type DecisionEvent,
  type HandEvent,
  type SimulationConfig,
  type SimulationResult,
} from "@poker-lab/core";
import { randomUUID } from "node:crypto";
import {
  insertActions,
  insertExperiment,
  insertHands,
  replaceOpponents,
  updateExperiment,
  type HandInsert,
} from "./db.js";

export type Speed = "1x" | "10x" | "100x" | "max";

export interface LiveSnapshot {
  running: boolean;
  paused: boolean;
  speed: Speed;
  experimentId: string | null;
  handsPlayed: number;
  targetHands: number;
  lastHand: HandEvent | null;
  lastDecision: DecisionEvent | null;
  lastHeroDecision: DecisionEvent | null;
  table: unknown;
}

const listeners = new Set<(payload: unknown) => void>();

export const live: LiveSnapshot & { stopFlag: boolean } = {
  running: false,
  paused: false,
  speed: "10x",
  experimentId: null,
  handsPlayed: 0,
  targetHands: 0,
  lastHand: null,
  lastDecision: null,
  lastHeroDecision: null,
  table: null,
  stopFlag: false,
};

export function subscribe(fn: (payload: unknown) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(payload: unknown): void {
  for (const fn of listeners) fn(payload);
}

function delayFor(speed: Speed): number {
  if (speed === "1x") return 900;
  if (speed === "10x") return 90;
  if (speed === "100x") return 8;
  return 0;
}

function persistMeta(experimentId: string, result: SimulationResult): void {
  replaceOpponents(
    experimentId,
    result.opponents.map((o) => ({
      id: `${experimentId}:${o.id}`,
      name: o.name,
      archetype_id: o.archetypeId,
      hud_json: JSON.stringify(o.hud),
    })),
  );
  updateExperiment(experimentId, {
    status: "completed",
    finished_at: Date.now(),
    analytics_json: JSON.stringify(result.analytics),
    uncertainty_json: JSON.stringify(result.analytics.uncertainty),
    hero_hud_json: JSON.stringify(result.heroHud),
    elapsed_ms: result.elapsedMs,
  });
}

function persistHandsFromResult(experimentId: string, result: SimulationResult): void {
  const handRows: HandInsert[] = result.histories.map((h, i) => ({
    id: h.handId,
    experiment_id: experimentId,
    seed: h.seed,
    position: result.results[i]?.position ?? "BTN",
    hole_cards: result.results[i]?.holeCards ?? "",
    board: h.board.join(" "),
    pot_type: h.potType,
    pot_bb: h.pots.reduce((s, p) => s + p.amountChips, 0) / 100,
    profit_bb: result.results[i]?.profitBb ?? 0,
    ev_bb: result.results[i]?.evBb ?? 0,
    showdown: h.showdown ? 1 : 0,
    history_json: JSON.stringify(h),
    created_at: h.finishedAt,
  }));
  if (handRows.length) insertHands(handRows);
  const actionRows = result.decisions.map((d) => ({
    hand_id: d.handId,
    experiment_id: experimentId,
    street: "decision",
    position: d.explanation.position,
    action: d.explanation.selectedAction,
    amount_bb: d.explanation.amountBB ?? null,
    explanation_json: JSON.stringify(d.explanation),
  }));
  if (actionRows.length) insertActions(actionRows);
}

export async function startLive(config: Partial<SimulationConfig> & { name?: string }): Promise<string> {
  if (live.running) throw new Error("A simulation is already running");
  const experimentId = randomUUID();
  const full = defaultSimulationConfig({
    hands: config.hands ?? 200,
    seed: config.seed ?? Date.now() % 1_000_000,
    mode: config.mode ?? "baseline",
    accuracy: config.accuracy ?? "fast",
    ...(config.table ? { table: config.table } : {}),
    ...(config.players ? { players: config.players } : {}),
    storeExplanations: true,
    storeEveryHand: true,
  });
  insertExperiment({
    id: experimentId,
    name: config.name ?? `${full.mode} × ${full.hands}`,
    mode: full.mode,
    hands: full.hands,
    seed: full.seed,
    accuracy: full.accuracy,
    status: "running",
    created_at: Date.now(),
    finished_at: null,
    config_json: JSON.stringify(full),
    analytics_json: null,
    uncertainty_json: null,
    hero_hud_json: null,
    elapsed_ms: null,
  });

  live.running = true;
  live.paused = false;
  live.stopFlag = false;
  live.experimentId = experimentId;
  live.handsPlayed = 0;
  live.targetHands = full.hands;
  live.lastDecision = null;
  live.lastHeroDecision = null;
  live.lastHand = null;
  emit({ type: "status", live: snapshot() });

  const startedAt = Date.now();
  const handBuffer: HandInsert[] = [];
  const actionBuffer: Parameters<typeof insertActions>[0] = [];

  setImmediate(() => {
    try {
      const result = runSimulation({
        ...full,
        shouldStop: () => live.stopFlag,
        onDecision: (event) => {
          live.lastDecision = event;
          if (event.isHero) live.lastHeroDecision = event;
          live.table = event.state;
          if (event.isHero) {
            actionBuffer.push({
              hand_id: event.handId,
              experiment_id: experimentId,
              street: event.street,
              position: event.position,
              action: event.decision.action,
              amount_bb: event.decision.amountBB ?? null,
              explanation_json: JSON.stringify(event.decision.explanation),
            });
          }
          emit({ type: "decision", event, live: snapshot() });
          if (live.speed !== "max") {
            const until = Date.now() + delayFor(live.speed);
            while (Date.now() < until) {
              /* paced live view */
            }
          }
          while (live.paused && !live.stopFlag) {
            const pauseUntil = Date.now() + 40;
            while (Date.now() < pauseUntil) {
              /* yield-ish pause */
            }
          }
        },
        onHand: (event) => {
          live.lastHand = event;
          live.handsPlayed = event.index + 1;
          handBuffer.push({
            id: event.history.handId,
            experiment_id: experimentId,
            seed: event.history.seed,
            position: event.result.position,
            hole_cards: event.result.holeCards,
            board: event.history.board.join(" "),
            pot_type: event.history.potType,
            pot_bb: event.history.pots.reduce((s, p) => s + p.amountChips, 0) / 100,
            profit_bb: event.result.profitBb,
            ev_bb: event.result.evBb,
            showdown: event.history.showdown ? 1 : 0,
            history_json: JSON.stringify(event.history),
            created_at: event.history.finishedAt,
          });
          if (handBuffer.length >= 25) {
            insertHands(handBuffer.splice(0));
            insertActions(actionBuffer.splice(0));
          }
          emit({ type: "hand", event, live: snapshot() });
        },
      });
      if (handBuffer.length) insertHands(handBuffer.splice(0));
      if (actionBuffer.length) insertActions(actionBuffer.splice(0));
      persistMeta(experimentId, result);
    } catch (error) {
      updateExperiment(experimentId, { status: "failed", finished_at: Date.now() });
      emit({ type: "error", error: String(error) });
    } finally {
      live.running = false;
      live.paused = false;
      emit({ type: "status", live: snapshot() });
    }
  });

  return experimentId;
}

export function stopLive(): void {
  live.stopFlag = true;
  live.paused = false;
}

export function setSpeed(speed: Speed): void {
  live.speed = speed;
  emit({ type: "status", live: snapshot() });
}

export function setPaused(paused: boolean): void {
  live.paused = paused;
  emit({ type: "status", live: snapshot() });
}

export function snapshot(): LiveSnapshot {
  const { stopFlag: _, ...rest } = live;
  return rest;
}

export function runHeadless(spec: {
  name: string;
  mode: "baseline" | "exploitative";
  hands: number;
  seed: number;
  accuracy?: "fast" | "standard" | "precise";
  population?: string[];
}): SimulationResult {
  const id = randomUUID();
  insertExperiment({
    id,
    name: spec.name,
    mode: spec.mode,
    hands: spec.hands,
    seed: spec.seed,
    accuracy: spec.accuracy ?? "fast",
    status: "running",
    created_at: Date.now(),
    finished_at: null,
    config_json: JSON.stringify(spec),
    analytics_json: null,
    uncertainty_json: null,
    hero_hud_json: null,
    elapsed_ms: null,
  });
  const result = runExperiment(spec);
  persistHandsFromResult(id, result);
  persistMeta(id, result);
  return result;
}

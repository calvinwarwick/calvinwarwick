import {
  ARCHETYPES,
  DEFAULT_TABLE_CONFIG,
  mixedStrategyForType,
  rangeToMatrix,
  strategyMatrix,
  compareExperiments,
  type Situation,
} from "@poker-lab/core";
import type { FastifyInstance } from "fastify";
import {
  dashboardFromLatest,
  db,
  getExperiment,
  getHand,
  getSetting,
  listExperiments,
  queryHands,
  setSetting,
} from "./db.js";
import { runHeadless, setPaused, setSpeed, snapshot, startLive, stopLive, type Speed } from "./live.js";

const DEFAULT_SETTINGS = {
  dollarSb: 0.1,
  dollarBb: 0.25,
  defaultBuyInBb: 100,
  minBuyInBb: 40,
  maxBuyInBb: 200,
  rakePercent: 0.05,
  rakeCapBb: 12,
  noFlopNoDrop: true,
  accuracy: "fast",
  mode: "baseline",
  showVillainCards: true,
};

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({ ok: true, product: "poker-lab", mode: "offline-research" }));

  app.get("/api/dashboard", async () => {
    const latest = dashboardFromLatest();
    const experiments = listExperiments();
    return { latest, experiments, settings: getSetting("ui", DEFAULT_SETTINGS) };
  });

  app.get("/api/experiments", async () => ({ experiments: listExperiments() }));

  app.get("/api/experiments/:id", async (req) => {
    const { id } = req.params as { id: string };
    const experiment = getExperiment(id);
    if (!experiment) return { error: "not_found" };
    return {
      experiment,
      analytics: experiment.analytics_json ? JSON.parse(experiment.analytics_json) : null,
      uncertainty: experiment.uncertainty_json ? JSON.parse(experiment.uncertainty_json) : null,
    };
  });

  app.post("/api/experiments", async (req) => {
    const body = req.body as {
      name: string;
      mode: "baseline" | "exploitative";
      hands: number;
      seed: number;
      accuracy?: "fast" | "standard" | "precise";
      population?: string[];
    };
    const result = runHeadless(body);
    return { ok: true, analytics: result.analytics, hands: result.handsPlayed };
  });

  app.post("/api/experiments/compare", async (req) => {
    const { a, b } = req.body as { a: string; b: string };
    const ea = getExperiment(a);
    const eb = getExperiment(b);
    if (!ea?.uncertainty_json || !eb?.uncertainty_json) return { error: "missing_results" };
    const ua = JSON.parse(ea.uncertainty_json);
    const ub = JSON.parse(eb.uncertainty_json);
    return {
      a: { experiment: ea, uncertainty: ua, analytics: ea.analytics_json ? JSON.parse(ea.analytics_json) : null },
      b: { experiment: eb, uncertainty: ub, analytics: eb.analytics_json ? JSON.parse(eb.analytics_json) : null },
      comparison: compareExperiments(ua, ub),
    };
  });

  app.get("/api/hands", async (req) => {
    const q = req.query as Record<string, string>;
    return queryHands({
      experimentId: q.experimentId,
      position: q.position,
      potType: q.potType,
      hole: q.hole,
      action: q.action,
      minEv: q.minEv ? Number(q.minEv) : undefined,
      maxEv: q.maxEv ? Number(q.maxEv) : undefined,
      minProfit: q.minProfit ? Number(q.minProfit) : undefined,
      maxProfit: q.maxProfit ? Number(q.maxProfit) : undefined,
      limit: q.limit ? Number(q.limit) : 40,
      offset: q.offset ? Number(q.offset) : 0,
    });
  });

  app.get("/api/hands/:id", async (req) => {
    const hand = getHand((req.params as { id: string }).id);
    if (!hand) return { error: "not_found" };
    return hand;
  });

  app.get("/api/opponents", async (req) => {
    const experimentId = (req.query as { experimentId?: string }).experimentId;
    const latest = experimentId ?? (listExperiments()[0]?.id as string | undefined);
    if (!latest) return { opponents: ARCHETYPES };
    const rows = db.prepare("SELECT * FROM opponents WHERE experiment_id = ?").all(latest);
    return {
      experimentId: latest,
      archetypes: ARCHETYPES,
      opponents: rows.map((r) => ({
        ...(r as object),
        hud: JSON.parse((r as { hud_json: string }).hud_json),
      })),
    };
  });

  app.get("/api/strategy", async (req) => {
    const q = req.query as Record<string, string>;
    const situation: Situation = {
      street: (q.street as Situation["street"]) ?? "preflop",
      potType: (q.potType as Situation["potType"]) ?? "limped",
      position: (q.position as Situation["position"]) ?? "BTN",
      opener: q.opener as Situation["opener"],
      facing: (q.facing as Situation["facing"]) ?? "unopened",
      stackBb: q.stackBb ? Number(q.stackBb) : 100,
      headsUp: q.headsUp === "1",
      multiway: q.headsUp !== "1",
    };
    const raise = strategyMatrix(situation, "raise");
    const call = strategyMatrix(situation, "call");
    const fold = strategyMatrix(situation, "fold");
    const selected = q.hand ? mixedStrategyForType(q.hand, situation) : null;
    return { situation, raise, call, fold, selected, matrixHint: rangeToMatrix(new Float64Array(1326)) };
  });

  app.get("/api/analytics", async (req) => {
    const id = (req.query as { experimentId?: string }).experimentId ?? listExperiments()[0]?.id;
    if (!id) return { empty: true };
    const experiment = getExperiment(id);
    return {
      experiment,
      analytics: experiment?.analytics_json ? JSON.parse(experiment.analytics_json) : null,
      uncertainty: experiment?.uncertainty_json ? JSON.parse(experiment.uncertainty_json) : null,
    };
  });

  app.get("/api/settings", async () => ({
    settings: getSetting("ui", DEFAULT_SETTINGS),
    table: DEFAULT_TABLE_CONFIG,
    archetypes: ARCHETYPES,
  }));

  app.put("/api/settings", async (req) => {
    const settings = { ...DEFAULT_SETTINGS, ...(req.body as object) };
    setSetting("ui", settings);
    return { settings };
  });

  app.get("/api/live", async () => snapshot());

  app.post("/api/live/start", async (req) => {
    const body = (req.body ?? {}) as Parameters<typeof startLive>[0];
    const id = await startLive(body);
    return { experimentId: id, live: snapshot() };
  });

  app.post("/api/live/stop", async () => {
    stopLive();
    return snapshot();
  });

  app.post("/api/live/pause", async (req) => {
    const { paused } = req.body as { paused: boolean };
    setPaused(paused);
    return snapshot();
  });

  app.post("/api/live/speed", async (req) => {
    const { speed } = req.body as { speed: Speed };
    setSpeed(speed);
    return snapshot();
  });

  app.get("/api/archetypes", async () => ({ archetypes: ARCHETYPES }));
}

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = process.env.POKER_LAB_DATA ?? path.resolve(process.cwd(), "../../data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "poker-lab.db");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  hands INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  accuracy TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  config_json TEXT NOT NULL,
  analytics_json TEXT,
  uncertainty_json TEXT,
  hero_hud_json TEXT,
  elapsed_ms INTEGER
);

CREATE TABLE IF NOT EXISTS hands (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  position TEXT NOT NULL,
  hole_cards TEXT NOT NULL,
  board TEXT NOT NULL,
  pot_type TEXT NOT NULL,
  pot_bb REAL NOT NULL,
  profit_bb REAL NOT NULL,
  ev_bb REAL NOT NULL,
  showdown INTEGER NOT NULL,
  history_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hands_exp ON hands(experiment_id);
CREATE INDEX IF NOT EXISTS idx_hands_pos ON hands(position);
CREATE INDEX IF NOT EXISTS idx_hands_pot ON hands(pot_type);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  street TEXT NOT NULL,
  position TEXT NOT NULL,
  action TEXT NOT NULL,
  amount_bb REAL,
  explanation_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_hand ON actions(hand_id);

CREATE TABLE IF NOT EXISTS opponents (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  archetype_id TEXT NOT NULL,
  hud_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`);

export interface ExperimentRow {
  id: string;
  name: string;
  mode: string;
  hands: number;
  seed: number;
  accuracy: string;
  status: string;
  created_at: number;
  finished_at: number | null;
  config_json: string;
  analytics_json: string | null;
  uncertainty_json: string | null;
  hero_hud_json: string | null;
  elapsed_ms: number | null;
}

export function insertExperiment(row: ExperimentRow): void {
  db.prepare(
    `INSERT INTO experiments (id,name,mode,hands,seed,accuracy,status,created_at,finished_at,config_json,analytics_json,uncertainty_json,hero_hud_json,elapsed_ms)
     VALUES (@id,@name,@mode,@hands,@seed,@accuracy,@status,@created_at,@finished_at,@config_json,@analytics_json,@uncertainty_json,@hero_hud_json,@elapsed_ms)`,
  ).run(row);
}

export function updateExperiment(id: string, patch: Partial<ExperimentRow>): void {
  const keys = Object.keys(patch) as (keyof ExperimentRow)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE experiments SET ${sets} WHERE id = @id`).run({ ...patch, id });
}

export function listExperiments(): ExperimentRow[] {
  return db.prepare("SELECT * FROM experiments ORDER BY created_at DESC").all() as ExperimentRow[];
}

export function getExperiment(id: string): ExperimentRow | undefined {
  return db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as ExperimentRow | undefined;
}

export interface HandInsert {
  id: string;
  experiment_id: string;
  seed: number;
  position: string;
  hole_cards: string;
  board: string;
  pot_type: string;
  pot_bb: number;
  profit_bb: number;
  ev_bb: number;
  showdown: number;
  history_json: string;
  created_at: number;
}

export const insertHands = db.transaction((rows: HandInsert[]) => {
  const stmt = db.prepare(
    `INSERT INTO hands (id,experiment_id,seed,position,hole_cards,board,pot_type,pot_bb,profit_bb,ev_bb,showdown,history_json,created_at)
     VALUES (@id,@experiment_id,@seed,@position,@hole_cards,@board,@pot_type,@pot_bb,@profit_bb,@ev_bb,@showdown,@history_json,@created_at)`,
  );
  for (const row of rows) stmt.run(row);
});

export const insertActions = db.transaction(
  (
    rows: {
      hand_id: string;
      experiment_id: string;
      street: string;
      position: string;
      action: string;
      amount_bb: number | null;
      explanation_json: string | null;
    }[],
  ) => {
    const stmt = db.prepare(
      `INSERT INTO actions (hand_id,experiment_id,street,position,action,amount_bb,explanation_json)
       VALUES (@hand_id,@experiment_id,@street,@position,@action,@amount_bb,@explanation_json)`,
    );
    for (const row of rows) stmt.run(row);
  },
);

export function replaceOpponents(
  experimentId: string,
  rows: { id: string; name: string; archetype_id: string; hud_json: string }[],
): void {
  db.prepare("DELETE FROM opponents WHERE experiment_id = ?").run(experimentId);
  const stmt = db.prepare(
    "INSERT INTO opponents (id,experiment_id,name,archetype_id,hud_json) VALUES (@id,@experiment_id,@name,@archetype_id,@hud_json)",
  );
  const tx = db.transaction(() => {
    for (const row of rows) stmt.run({ ...row, experiment_id: experimentId });
  });
  tx();
}

export function queryHands(filters: {
  experimentId?: string;
  position?: string;
  potType?: string;
  hole?: string;
  action?: string;
  minEv?: number;
  maxEv?: number;
  minProfit?: number;
  maxProfit?: number;
  limit?: number;
  offset?: number;
}): { rows: Record<string, unknown>[]; total: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.experimentId) {
    where.push("h.experiment_id = @experimentId");
    params.experimentId = filters.experimentId;
  }
  if (filters.position) {
    where.push("h.position = @position");
    params.position = filters.position;
  }
  if (filters.potType) {
    where.push("h.pot_type = @potType");
    params.potType = filters.potType;
  }
  if (filters.hole) {
    where.push("h.hole_cards LIKE @hole");
    params.hole = `%${filters.hole}%`;
  }
  if (filters.minEv !== undefined) {
    where.push("h.ev_bb >= @minEv");
    params.minEv = filters.minEv;
  }
  if (filters.maxEv !== undefined) {
    where.push("h.ev_bb <= @maxEv");
    params.maxEv = filters.maxEv;
  }
  if (filters.minProfit !== undefined) {
    where.push("h.profit_bb >= @minProfit");
    params.minProfit = filters.minProfit;
  }
  if (filters.maxProfit !== undefined) {
    where.push("h.profit_bb <= @maxProfit");
    params.maxProfit = filters.maxProfit;
  }
  if (filters.action) {
    where.push("EXISTS (SELECT 1 FROM actions a WHERE a.hand_id = h.id AND a.action = @action)");
    params.action = filters.action;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) as n FROM hands h ${clause}`).get(params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT h.* FROM hands h ${clause} ORDER BY h.created_at DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: filters.limit ?? 50, offset: filters.offset ?? 0 }) as Record<string, unknown>[];
  return { rows, total };
}

export function getHand(id: string): Record<string, unknown> | undefined {
  const hand = db.prepare("SELECT * FROM hands WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!hand) return undefined;
  const actions = db.prepare("SELECT * FROM actions WHERE hand_id = ? ORDER BY id").all(id);
  return { ...hand, actions };
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as T) : fallback;
}

export function setSetting(key: string, value: unknown): void {
  db.prepare("INSERT INTO settings (key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(
    key,
    JSON.stringify(value),
  );
}

export function dashboardFromLatest(): Record<string, unknown> | null {
  const exp = db.prepare("SELECT * FROM experiments WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1").get() as
    | ExperimentRow
    | undefined;
  if (!exp?.analytics_json) return null;
  return {
    experiment: exp,
    analytics: JSON.parse(exp.analytics_json),
    uncertainty: exp.uncertainty_json ? JSON.parse(exp.uncertainty_json) : null,
    heroHud: exp.hero_hud_json ? JSON.parse(exp.hero_hud_json) : null,
  };
}

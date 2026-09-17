export const POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;
export type Position = (typeof POSITIONS)[number];

export const STREETS = ["preflop", "flop", "turn", "river"] as const;
export type Street = (typeof STREETS)[number];

export const ACTION_TYPES = ["FOLD", "CHECK", "CALL", "BET", "RAISE"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type PotType = "limped" | "single-raised" | "3bet" | "4bet" | "5bet";
export type StrategyMode = "baseline" | "exploitative";
export type Accuracy = "fast" | "standard" | "precise";

export type Suit = "c" | "d" | "h" | "s";
export type RankChar = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";

export interface TableConfig {
  seats: number;
  /** Internal chips per big blind. Default 100 (1 chip = 0.01 BB). */
  chipsPerBb: number;
  smallBlindChips: number;
  bigBlindChips: number;
  dollarSb: number;
  dollarBb: number;
  defaultBuyInBb: number;
  minBuyInBb: number;
  maxBuyInBb: number;
  rakePercent: number;
  rakeCapBb: number;
  noFlopNoDrop: boolean;
}

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  seats: 6,
  chipsPerBb: 100,
  smallBlindChips: 40,
  bigBlindChips: 100,
  dollarSb: 0.1,
  dollarBb: 0.25,
  defaultBuyInBb: 100,
  minBuyInBb: 40,
  maxBuyInBb: 200,
  rakePercent: 0.05,
  rakeCapBb: 12,
  noFlopNoDrop: true,
};

export interface LegalAction {
  type: ActionType;
  /** Minimum size to (chips) for BET/RAISE. */
  minToChips?: number;
  /** Maximum size to (chips) for BET/RAISE. */
  maxToChips?: number;
  /** Call amount in chips. */
  callChips?: number;
}

export interface ActionRecord {
  playerId: string;
  playerName: string;
  position: Position;
  street: Street;
  action: ActionType | "POST_SB" | "POST_BB";
  amountToChips?: number;
  amountAddedChips?: number;
  allIn?: boolean;
  isIncompleteRaise?: boolean;
}

export interface AgentActionRecord {
  player: Position;
  action: string;
  amountBB?: number;
}

export interface AgentGameState {
  position: Position;
  heroStackBB: number;
  villainStacksBB: Record<string, number>;
  holeCards: string[];
  board: string[];
  potBB: number;
  toCallBB: number;
  currentBetBB: number;
  minRaiseToBB?: number;
  maxRaiseToBB?: number;
  street: Street;
  potType: PotType;
  isHeadsUp: boolean;
  isMultiway: boolean;
  spr: number;
  effectiveStackBB: number;
  actionHistory: AgentActionRecord[];
  legalActions: ActionType[];
}

export interface MixedStrategy {
  fold: number;
  check: number;
  call: number;
  bet: number;
  raise: number;
  sizesBB: Record<string, number>;
}

export interface ExploitRecord {
  name: string;
  evidence: string;
  sampleSize: number;
  confidence: number;
  baselineAction: string;
  adjustedAction: string;
  estimatedEvDiffBB: number;
}

export interface EvBreakdown {
  action: ActionType;
  amountBB?: number;
  evBB: number;
  details: string;
}

export interface DecisionExplanation {
  action: ActionType;
  amountBB?: number;
  confidence: number;
  potBB: number;
  heroEquity: number;
  estimatedFoldEquity: number;
  heroHandStrength: string;
  potOdds: number;
  requiredEquity: number;
  spr: number;
  effectiveStackBB: number;
  position: Position;
  boardTexture?: BoardTexture;
  rangeAdvantage?: number;
  nutAdvantage?: number;
  blockers: string[];
  draws: string[];
  showdownValue: string;
  impliedOddsBB?: number;
  baselineStrategy: MixedStrategy;
  opponentAdjustment?: string;
  finalStrategy: MixedStrategy;
  selectedAction: ActionType;
  estimatedEvBB: number;
  evs: EvBreakdown[];
  exploits: ExploitRecord[];
  notes: string[];
}

export interface AgentDecision {
  action: ActionType;
  amountBB?: number;
  explanation: DecisionExplanation;
}

export interface BoardTexture {
  paired: "unpaired" | "paired" | "two-pair" | "trips";
  suits: "rainbow" | "two-tone" | "monotone";
  connected: "disconnected" | "semi-connected" | "connected";
  height: "high" | "medium" | "low";
  dynamism: "static" | "semi-dynamic" | "dynamic";
  wetness: number;
}

export interface PotAward {
  amountChips: number;
  eligibleIds: string[];
  winnerIds: string[];
  split: boolean;
}

export interface SeatSnapshot {
  id: string;
  name: string;
  seat: number;
  position: Position;
  stackChips: number;
  holeCards?: string[];
  folded: boolean;
  allIn: boolean;
  isHero: boolean;
  archetype?: string;
}

export interface HandHistory {
  handId: string;
  seed: number;
  startedAt: number;
  finishedAt: number;
  buttonSeat: number;
  config: TableConfig;
  seats: SeatSnapshot[];
  board: string[];
  actions: ActionRecord[];
  pots: PotAward[];
  rakeChips: number;
  winners: { playerId: string; amountChips: number; evChips: number }[];
  potType: PotType;
  showdown: boolean;
  heroId: string;
  heroProfitChips: number;
  heroEvChips: number;
}

export interface PlayerHudStats {
  hands: number;
  vpip: StatEstimate;
  pfr: StatEstimate;
  threeBet: StatEstimate;
  foldTo3Bet: StatEstimate;
  fourBet: StatEstimate;
  ats: StatEstimate;
  foldToSteal: StatEstimate;
  flopCBet: StatEstimate;
  turnCBet: StatEstimate;
  riverBet: StatEstimate;
  foldToFlopCBet: StatEstimate;
  foldToTurnCBet: StatEstimate;
  checkRaise: StatEstimate;
  wtsd: StatEstimate;
  wsd: StatEstimate;
  aggressionFrequency: StatEstimate;
}

export interface StatEstimate {
  opportunities: number;
  successes: number;
  observed: number | null;
  estimate: number;
  priorMean: number;
  confidence: number;
  sampleSize: number;
}

export interface ArchetypePrior {
  id: string;
  label: string;
  description: string;
  vpip: number;
  pfr: number;
  threeBet: number;
  foldTo3Bet: number;
  fourBet: number;
  ats: number;
  foldToSteal: number;
  flopCBet: number;
  turnCBet: number;
  riverBet: number;
  foldToFlopCBet: number;
  foldToTurnCBet: number;
  checkRaise: number;
  wtsd: number;
  wsd: number;
  aggression: number;
  looseness: number;
  bluffFrequency: number;
  callDownFrequency: number;
}

export interface UncertaintyReport {
  sampleSize: number;
  observedWinrateBb100: number;
  evWinrateBb100: number;
  stdDevBb100: number;
  stdErrorBb100: number;
  ci95: [number, number];
  evCi95: [number, number];
  note: string;
}

export function chipsToBb(chips: number, chipsPerBb = 100): number {
  return chips / chipsPerBb;
}

export function bbToChips(bb: number, chipsPerBb = 100): number {
  return Math.round(bb * chipsPerBb);
}

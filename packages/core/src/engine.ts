import { formatCards, shuffledDeck } from "./cards.js";
import { SeededRng } from "./rng.js";
import { applyRake, awardPots, buildSidePots, splitChips } from "./pots.js";
import {
  DEFAULT_TABLE_CONFIG,
  chipsToBb,
  type ActionRecord,
  type ActionType,
  type AgentActionRecord,
  type AgentGameState,
  type HandHistory,
  type LegalAction,
  type Position,
  type PotType,
  type SeatSnapshot,
  type Street,
  type TableConfig,
} from "./types.js";

export interface Seat {
  id: string;
  name: string;
  seat: number;
  stack: number;
  committed: number;
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  hole: number[];
  hasActedThisRound: boolean;
  isHero: boolean;
  archetype?: string;
}

export interface TableState {
  config: TableConfig;
  seats: Seat[];
  button: number;
  street: Street;
  board: number[];
  currentBet: number;
  lastFullRaiseSize: number;
  lastFullRaiseTo: number;
  toAct: number | null;
  actionLog: ActionRecord[];
  handId: string;
  seed: number;
  startedAt: number;
  deck: number[];
  bettingOpen: boolean;
  flopSeen: boolean;
  raisesThisStreet: number;
  limps: number;
  potType: PotType;
  complete: boolean;
  lastAggressor: number | null;
  lastHistory?: HandHistory;
}

const POSITION_OFFSETS_6MAX: Record<Position, number> = {
  BTN: 0,
  SB: 1,
  BB: 2,
  UTG: 3,
  HJ: 4,
  CO: 5,
};

export function positionForSeat(seat: number, button: number, seatCount: number): Position {
  const offset = (seat - button + seatCount) % seatCount;
  const found = (Object.entries(POSITION_OFFSETS_6MAX) as [Position, number][]).find(([, o]) => o === offset);
  return found?.[0] ?? "UTG";
}

export function createSeats(
  stacksBb: number[],
  names: string[],
  heroIndex: number,
  archetypes: (string | undefined)[],
  config: TableConfig,
): Seat[] {
  return stacksBb.map((bb, seat) => ({
    id: `seat-${seat}`,
    name: names[seat] ?? `P${seat + 1}`,
    seat,
    stack: Math.round(bb * config.chipsPerBb),
    committed: 0,
    totalCommitted: 0,
    folded: false,
    allIn: false,
    hole: [],
    hasActedThisRound: false,
    isHero: seat === heroIndex,
    archetype: archetypes[seat],
  }));
}

export function startHand(args: {
  seats: Seat[];
  button: number;
  seed: number;
  handId: string;
  config?: TableConfig;
}): TableState {
  const config = args.config ?? DEFAULT_TABLE_CONFIG;
  const rng = new SeededRng(args.seed);
  const deck = shuffledDeck(rng);
  const seats = args.seats.map((s) => ({
    ...s,
    committed: 0,
    totalCommitted: 0,
    folded: false,
    allIn: s.stack <= 0,
    hole: [] as number[],
    hasActedThisRound: false,
  }));

  for (const seat of seats) {
    if (seat.stack > 0) {
      seat.hole = [deck.pop()!, deck.pop()!];
      seat.allIn = false;
    } else {
      seat.folded = true;
      seat.allIn = true;
    }
  }

  const state: TableState = {
    config,
    seats,
    button: args.button,
    street: "preflop",
    board: [],
    currentBet: 0,
    lastFullRaiseSize: config.bigBlindChips,
    lastFullRaiseTo: config.bigBlindChips,
    toAct: null,
    actionLog: [],
    handId: args.handId,
    seed: args.seed,
    startedAt: Date.now(),
    deck,
    bettingOpen: true,
    flopSeen: false,
    raisesThisStreet: 0,
    limps: 0,
    potType: "limped",
    complete: false,
    lastAggressor: null,
  };

  postBlind(state, seatAtPosition(state, "SB"), config.smallBlindChips, "POST_SB");
  postBlind(state, seatAtPosition(state, "BB"), config.bigBlindChips, "POST_BB");
  state.currentBet = config.bigBlindChips;
  state.lastFullRaiseSize = config.bigBlindChips;
  state.lastFullRaiseTo = config.bigBlindChips;
  state.toAct = firstToAct(state);
  if (livePlayers(state).length < 2) {
    finishHand(state);
  }
  return state;
}

function seatAtPosition(state: TableState, position: Position): Seat {
  return state.seats.find((s) => positionForSeat(s.seat, state.button, state.config.seats) === position)!;
}

function postBlind(state: TableState, seat: Seat, amount: number, kind: "POST_SB" | "POST_BB"): void {
  const posted = Math.min(amount, seat.stack);
  seat.stack -= posted;
  seat.committed += posted;
  seat.totalCommitted += posted;
  if (seat.stack === 0) seat.allIn = true;
  state.actionLog.push({
    playerId: seat.id,
    playerName: seat.name,
    position: positionOf(state, seat),
    street: "preflop",
    action: kind,
    amountToChips: seat.committed,
    amountAddedChips: posted,
    allIn: seat.allIn,
  });
}

export function positionOf(state: TableState, seat: Seat): Position {
  return positionForSeat(seat.seat, state.button, state.config.seats);
}

export function potChips(state: TableState): number {
  return state.seats.reduce((sum, s) => sum + s.totalCommitted, 0);
}

export function livePlayers(state: TableState): Seat[] {
  return state.seats.filter((s) => !s.folded && s.hole.length === 2);
}

export function playersWhoCanAct(state: TableState): Seat[] {
  return livePlayers(state).filter((s) => !s.allIn && s.stack > 0);
}

function firstToAct(state: TableState): number | null {
  const order = actionOrder(state);
  return order[0] ?? null;
}

function actionOrder(state: TableState): number[] {
  const startPos: Position = state.street === "preflop" ? "UTG" : "SB";
  const startOffset = POSITION_OFFSETS_6MAX[startPos];
  const seats: number[] = [];
  for (let i = 0; i < state.config.seats; i++) {
    const seatIndex = (state.button + startOffset + i) % state.config.seats;
    const seat = state.seats[seatIndex]!;
    if (!seat.folded && !seat.allIn && seat.stack > 0) seats.push(seatIndex);
  }
  return seats;
}

export function legalActions(state: TableState, seatIndex?: number): LegalAction[] {
  if (state.complete || state.toAct === null) return [];
  const idx = seatIndex ?? state.toAct;
  const seat = state.seats[idx];
  if (!seat || seat.folded || seat.allIn || state.toAct !== idx) return [];

  const toCall = state.currentBet - seat.committed;
  const actions: LegalAction[] = [];

  if (toCall <= 0) {
    actions.push({ type: "CHECK" });
    if (seat.stack > 0) {
      const minTo = Math.min(seat.committed + seat.stack, seat.committed + state.config.bigBlindChips);
      const maxTo = seat.committed + seat.stack;
      actions.push({ type: "BET", minToChips: minTo, maxToChips: maxTo });
    }
  } else {
    actions.push({ type: "FOLD" });
    actions.push({ type: "CALL", callChips: Math.min(toCall, seat.stack) });
    if (seat.stack > toCall) {
      const minRaiseTo = state.currentBet + state.lastFullRaiseSize;
      const maxTo = seat.committed + seat.stack;
      const minTo = Math.min(maxTo, minRaiseTo);
      if (maxTo > state.currentBet) {
        actions.push({ type: "RAISE", minToChips: minTo, maxToChips: maxTo });
      }
    }
  }
  return actions;
}

export function applyAction(
  state: TableState,
  action: ActionType,
  amountToChips?: number,
): void {
  if (state.complete || state.toAct === null) {
    throw new Error("Hand is not awaiting an action");
  }
  const seat = state.seats[state.toAct]!;
  const legal = legalActions(state);
  const match = legal.find((a) => a.type === action);
  if (!match) throw new Error(`Illegal action ${action} for ${seat.name}`);

  let added = 0;
  let to = seat.committed;
  let incomplete = false;

  if (action === "FOLD") {
    seat.folded = true;
  } else if (action === "CHECK") {
    // no chips
  } else if (action === "CALL") {
    const need = Math.min(state.currentBet - seat.committed, seat.stack);
    added = need;
    seat.stack -= added;
    seat.committed += added;
    seat.totalCommitted += added;
    to = seat.committed;
    if (seat.stack === 0) seat.allIn = true;
  } else if (action === "BET" || action === "RAISE") {
    const minTo = match.minToChips ?? state.currentBet + state.lastFullRaiseSize;
    const maxTo = match.maxToChips ?? seat.committed + seat.stack;
    const target = clamp(amountToChips ?? minTo, seat.committed + 1, maxTo);
    added = target - seat.committed;
    if (added > seat.stack) {
      added = seat.stack;
    }
    seat.stack -= added;
    seat.committed += added;
    seat.totalCommitted += added;
    to = seat.committed;
    if (seat.stack === 0) seat.allIn = true;

    const raiseSize = to - state.currentBet;
    const isFull = raiseSize >= state.lastFullRaiseSize || to === maxTo && raiseSize >= state.lastFullRaiseSize;
    if (to > state.currentBet) {
      if (raiseSize >= state.lastFullRaiseSize) {
        state.lastFullRaiseSize = raiseSize;
        state.lastFullRaiseTo = to;
        for (const other of state.seats) {
          if (other !== seat && !other.folded && !other.allIn) other.hasActedThisRound = false;
        }
        state.raisesThisStreet += 1;
        state.lastAggressor = seat.seat;
        updatePotType(state);
      } else {
        incomplete = true;
        for (const other of state.seats) {
          if (other !== seat && !other.folded && !other.allIn && other.committed < to) {
            other.hasActedThisRound = false;
          }
        }
      }
      state.currentBet = to;
    }
    void isFull;
  }

  if (state.street === "preflop" && action === "CALL" && state.currentBet === state.config.bigBlindChips) {
    state.limps += 1;
  }

  seat.hasActedThisRound = true;
  state.actionLog.push({
    playerId: seat.id,
    playerName: seat.name,
    position: positionOf(state, seat),
    street: state.street,
    action,
    amountToChips: action === "FOLD" || action === "CHECK" ? undefined : to,
    amountAddedChips: added || undefined,
    allIn: seat.allIn,
    isIncompleteRaise: incomplete || undefined,
  });

  advance(state);
}

function updatePotType(state: TableState): void {
  if (state.street !== "preflop") return;
  const raises = state.raisesThisStreet;
  if (raises <= 0) state.potType = "limped";
  else if (raises === 1) state.potType = "single-raised";
  else if (raises === 2) state.potType = "3bet";
  else if (raises === 3) state.potType = "4bet";
  else state.potType = "5bet";
}

function advance(state: TableState): void {
  const alive = livePlayers(state);
  if (alive.length <= 1) {
    finishHand(state);
    return;
  }

  const next = nextToAct(state);
  if (next !== null) {
    state.toAct = next;
    return;
  }

  endStreet(state);
}

function nextToAct(state: TableState): number | null {
  const order = actionOrder(state);
  for (const idx of order) {
    const seat = state.seats[idx]!;
    const needsToMatch = seat.committed < state.currentBet;
    const canStillAct = !seat.hasActedThisRound || needsToMatch;
    if (canStillAct) return idx;
  }
  return null;
}

function endStreet(state: TableState): void {
  for (const seat of state.seats) {
    seat.committed = 0;
    seat.hasActedThisRound = false;
  }
  state.currentBet = 0;
  state.lastFullRaiseSize = state.config.bigBlindChips;
  state.lastFullRaiseTo = 0;
  state.raisesThisStreet = 0;
  state.lastAggressor = null;

  const alive = livePlayers(state);
  const withChips = alive.filter((s) => !s.allIn && s.stack > 0);
  const canBet = withChips.length >= 2;

  if (state.street === "preflop") {
    dealBoard(state, 3);
    state.street = "flop";
    state.flopSeen = true;
  } else if (state.street === "flop") {
    dealBoard(state, 1);
    state.street = "turn";
  } else if (state.street === "turn") {
    dealBoard(state, 1);
    state.street = "river";
  } else {
    finishHand(state);
    return;
  }

  if (!canBet) {
    runOut(state);
    finishHand(state);
    return;
  }

  state.toAct = firstToAct(state);
  if (state.toAct === null) {
    runOut(state);
    finishHand(state);
  }
}

function dealBoard(state: TableState, n: number): void {
  state.deck.pop(); // burn
  for (let i = 0; i < n; i++) state.board.push(state.deck.pop()!);
}

function runOut(state: TableState): void {
  while (state.board.length < 5) {
    if (state.board.length === 0) {
      dealBoard(state, 3);
      state.flopSeen = true;
    } else {
      dealBoard(state, 1);
    }
  }
}

export function finishHand(state: TableState): HandHistory {
  if (state.complete && state.lastHistory) return state.lastHistory;
  state.complete = true;
  state.toAct = null;
  state.bettingOpen = false;

  const alive = livePlayers(state);
  if (alive.length === 1 && state.board.length < 5) {
    // uncontested — no runout required
  } else if (alive.length > 1 && state.board.length < 5) {
    runOut(state);
  }

  const contributors = state.seats.map((s) => ({
    id: s.id,
    totalCommitted: s.totalCommitted,
    folded: s.folded,
    hole: s.hole,
  }));
  const pots = buildSidePots(contributors);
  const totalPot = pots.reduce((s, p) => s + p.amountChips, 0);
  const rakeCap = Math.round(state.config.rakeCapBb * state.config.chipsPerBb);
  const { rake } = applyRake(
    totalPot,
    state.config.rakePercent,
    rakeCap,
    state.flopSeen,
    state.config.noFlopNoDrop,
  );

  let remainingRake = rake;
  const awards = awardPots(pots, contributors, state.board);
  const won = new Map<string, number>();
  const awardedPots = awards.map((award) => {
    let amount = award.amountChips;
    const take = Math.min(remainingRake, amount);
    amount -= take;
    remainingRake -= take;
    const shares = splitChips(amount, Math.max(1, award.winnerIds.length));
    award.winnerIds.forEach((id, i) => {
      won.set(id, (won.get(id) ?? 0) + (shares[i] ?? 0));
    });
    return {
      amountChips: amount,
      eligibleIds: pots[award.potIndex]?.eligibleIds ?? award.winnerIds,
      winnerIds: award.winnerIds,
      split: award.split,
    };
  });

  for (const seat of state.seats) {
    seat.stack += won.get(seat.id) ?? 0;
  }

  const hero = state.seats.find((s) => s.isHero) ?? state.seats[0]!;
  const heroProfit = (won.get(hero.id) ?? 0) - hero.totalCommitted;
  const showdown = alive.length > 1 && state.board.length === 5;

  const history: HandHistory = {
    handId: state.handId,
    seed: state.seed,
    startedAt: state.startedAt,
    finishedAt: Date.now(),
    buttonSeat: state.button,
    config: state.config,
    seats: state.seats.map((s) => snapshotSeat(state, s)),
    board: formatCards(state.board),
    actions: state.actionLog,
    pots: awardedPots,
    rakeChips: rake,
    winners: state.seats
      .filter((s) => (won.get(s.id) ?? 0) > 0)
      .map((s) => ({
        playerId: s.id,
        amountChips: won.get(s.id) ?? 0,
        evChips: (won.get(s.id) ?? 0) - s.totalCommitted,
      })),
    potType: state.potType,
    showdown,
    heroId: hero.id,
    heroProfitChips: heroProfit,
    heroEvChips: heroProfit,
  };
  state.lastHistory = history;
  return history;
}

function snapshotSeat(state: TableState, seat: Seat): SeatSnapshot {
  return {
    id: seat.id,
    name: seat.name,
    seat: seat.seat,
    position: positionOf(state, seat),
    stackChips: seat.stack,
    holeCards: seat.hole.length ? formatCards(seat.hole) : undefined,
    folded: seat.folded,
    allIn: seat.allIn,
    isHero: seat.isHero,
    archetype: seat.archetype,
  };
}

export function toAgentState(state: TableState, heroId?: string): AgentGameState {
  const hero = (heroId ? state.seats.find((s) => s.id === heroId) : undefined)
    ?? state.seats.find((s) => s.isHero)
    ?? state.seats[0]!;
  const chipsPerBb = state.config.chipsPerBb;
  const villains: Record<string, number> = {};
  for (const seat of state.seats) {
    if (seat.id === hero.id || seat.folded) continue;
    villains[positionOf(state, seat)] = chipsToBb(seat.stack, chipsPerBb);
  }
  const legal = state.toAct === hero.seat ? legalActions(state) : [];
  const toCall = Math.max(0, state.currentBet - hero.committed);
  const pot = potChips(state);
  const effective = Math.min(
    hero.stack,
    ...state.seats.filter((s) => s.id !== hero.id && !s.folded).map((s) => s.stack),
  );
  const raise = legal.find((a) => a.type === "RAISE" || a.type === "BET");
  const history: AgentActionRecord[] = state.actionLog
    .filter((a) => a.action !== "POST_SB" && a.action !== "POST_BB")
    .map((a) => ({
      player: a.position,
      action: a.action.toLowerCase(),
      amountBB: a.amountToChips !== undefined ? chipsToBb(a.amountToChips, chipsPerBb) : undefined,
    }));

  return {
    position: positionOf(state, hero),
    heroStackBB: chipsToBb(hero.stack, chipsPerBb),
    villainStacksBB: villains,
    holeCards: formatCards(hero.hole),
    board: formatCards(state.board),
    potBB: chipsToBb(pot, chipsPerBb),
    toCallBB: chipsToBb(toCall, chipsPerBb),
    currentBetBB: chipsToBb(state.currentBet, chipsPerBb),
    minRaiseToBB: raise?.minToChips !== undefined ? chipsToBb(raise.minToChips, chipsPerBb) : undefined,
    maxRaiseToBB: raise?.maxToChips !== undefined ? chipsToBb(raise.maxToChips, chipsPerBb) : undefined,
    street: state.street,
    potType: state.potType,
    isHeadsUp: livePlayers(state).length === 2,
    isMultiway: livePlayers(state).length > 2,
    spr: pot > 0 ? effective / pot : effective / state.config.bigBlindChips,
    effectiveStackBB: chipsToBb(effective || hero.stack, chipsPerBb),
    actionHistory: history,
    legalActions: legal.map((a) => a.type),
  };
}

export function rotateButton(button: number, seats: number): number {
  return (button + 1) % seats;
}

export function formatHandHistory(history: HandHistory): string {
  const lines: string[] = [];
  const bb = history.config.chipsPerBb;
  lines.push(`Poker Lab Hand #${history.handId} — NLHE 6-max $${history.config.dollarSb}/$${history.config.dollarBb}`);
  lines.push(`Seed ${history.seed}  Button seat ${history.buttonSeat}  Pot type ${history.potType}`);
  for (const seat of history.seats) {
    const cards = seat.holeCards?.join(" ") ?? "--";
    lines.push(
      `  ${seat.position.padEnd(3)} ${seat.name.padEnd(16)} stack ${chipsToBb(seat.stackChips, bb).toFixed(1)} BB  ${cards}`,
    );
  }
  lines.push(`Board: [${history.board.join(" ")}]`);
  for (const action of history.actions) {
    const amt =
      action.amountToChips !== undefined ? ` to ${chipsToBb(action.amountToChips, bb).toFixed(2)} BB` : "";
    lines.push(`  ${action.street.padEnd(7)} ${action.position} ${action.action}${amt}${action.allIn ? " (all-in)" : ""}`);
  }
  lines.push(`Rake: ${chipsToBb(history.rakeChips, bb).toFixed(2)} BB`);
  for (const w of history.winners) {
    lines.push(`  ${w.playerId} wins ${chipsToBb(w.amountChips, bb).toFixed(2)} BB`);
  }
  return lines.join("\n");
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

import { evaluateHand } from "./evaluator.js";

export interface PotContributor {
  id: string;
  totalCommitted: number;
  folded: boolean;
  hole: number[];
}

export interface BuiltPot {
  amountChips: number;
  eligibleIds: string[];
  contributorIds: string[];
}

export function buildSidePots(players: PotContributor[]): BuiltPot[] {
  const contributors = players.filter((p) => p.totalCommitted > 0);
  if (contributors.length === 0) return [];

  const levels = [...new Set(contributors.map((p) => p.totalCommitted))].sort((a, b) => a - b);
  const pots: BuiltPot[] = [];
  let previous = 0;

  for (const level of levels) {
    const layer = contributors.filter((p) => p.totalCommitted >= level);
    const amount = (level - previous) * layer.length;
    const eligible = layer.filter((p) => !p.folded).map((p) => p.id);
    if (amount > 0) {
      pots.push({
        amountChips: amount,
        eligibleIds: eligible,
        contributorIds: layer.map((p) => p.id),
      });
    }
    previous = level;
  }

  return pots;
}

export function awardPots(
  pots: BuiltPot[],
  players: PotContributor[],
  board: number[],
): { potIndex: number; amountChips: number; winnerIds: string[]; split: boolean }[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  return pots.map((pot, potIndex) => {
    const eligible = pot.eligibleIds
      .map((id) => byId.get(id))
      .filter((p): p is PotContributor => Boolean(p) && p.hole.length >= 2);

    if (eligible.length === 0) {
      return { potIndex, amountChips: pot.amountChips, winnerIds: [], split: false };
    }
    if (eligible.length === 1 || board.length < 5) {
      return {
        potIndex,
        amountChips: pot.amountChips,
        winnerIds: [eligible[0]!.id],
        split: false,
      };
    }

    let best = -1;
    const winnerIds: string[] = [];
    for (const player of eligible) {
      const rank = evaluateHand([...player.hole, ...board]);
      if (rank > best) {
        best = rank;
        winnerIds.length = 0;
        winnerIds.push(player.id);
      } else if (rank === best) {
        winnerIds.push(player.id);
      }
    }
    return {
      potIndex,
      amountChips: pot.amountChips,
      winnerIds,
      split: winnerIds.length > 1,
    };
  });
}

export function splitChips(amount: number, winnerCount: number): number[] {
  if (winnerCount <= 0) return [];
  const base = Math.floor(amount / winnerCount);
  const remainder = amount - base * winnerCount;
  return Array.from({ length: winnerCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function applyRake(
  potChips: number,
  rakePercent: number,
  rakeCapChips: number,
  flopSeen: boolean,
  noFlopNoDrop: boolean,
): { netPot: number; rake: number } {
  if (potChips <= 0) return { netPot: 0, rake: 0 };
  if (noFlopNoDrop && !flopSeen) return { netPot: potChips, rake: 0 };
  const raw = Math.floor(potChips * rakePercent);
  const rake = Math.min(raw, rakeCapChips, potChips);
  return { netPot: potChips - rake, rake };
}

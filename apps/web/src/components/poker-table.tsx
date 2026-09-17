import { PlayingCard } from "@/components/playing-card";
import { cn } from "@/lib/utils";

const SEAT_POS = [
  "bottom-4 left-1/2 -translate-x-1/2",
  "bottom-16 left-8",
  "top-16 left-8",
  "top-4 left-1/2 -translate-x-1/2",
  "top-16 right-8",
  "bottom-16 right-8",
];

export function PokerTable({
  seats,
  board,
  potBB,
  actor,
  showCards,
}: {
  seats: {
    name: string;
    position: string;
    stackBB: number;
    hole?: string[];
    folded?: boolean;
    isHero?: boolean;
    archetype?: string;
  }[];
  board: string[];
  potBB: number;
  actor?: string;
  showCards?: boolean;
}) {
  return (
    <div className="relative mx-auto aspect-[1.6/1] w-full max-w-3xl">
      <div className="absolute inset-8 rounded-[999px] border-8 border-felt-edge bg-felt shadow-[inset_0_0_80px_rgba(0,0,0,0.35)]" />
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <PlayingCard key={i} card={board[i]} hidden={!board[i]} />
          ))}
        </div>
        <div className="rounded-full bg-black/40 px-3 py-1 font-mono text-xs">Pot {potBB.toFixed(1)} BB</div>
      </div>
      {seats.map((seat, i) => (
        <div key={seat.position} className={cn("absolute w-40", SEAT_POS[i] ?? SEAT_POS[0])}>
          <div
            className={cn(
              "rounded-lg border bg-card/95 p-2 shadow-lg",
              seat.folded && "opacity-40",
              actor === seat.position && "border-primary",
              seat.isHero && "border-primary/60",
            )}
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium">{seat.position}</span>
              <span className="text-muted-foreground">{seat.stackBB.toFixed(1)} BB</span>
            </div>
            <div className="truncate text-xs text-muted-foreground">{seat.name}</div>
            <div className="mt-1 flex gap-1">
              <PlayingCard card={seat.hole?.[0]} hidden={!showCards && !seat.isHero} small />
              <PlayingCard card={seat.hole?.[1]} hidden={!showCards && !seat.isHero} small />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

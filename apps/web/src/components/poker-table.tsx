import { PlayingCard } from "@/components/playing-card";
import { cn } from "@/lib/utils";

const POSITION_CLASS: Record<string, string> = {
  SB: "bottom-[6%] left-1/2 -translate-x-1/2",
  BB: "bottom-[18%] left-[8%]",
  UTG: "top-[18%] left-[8%]",
  HJ: "top-[6%] left-1/2 -translate-x-1/2",
  CO: "top-[18%] right-[8%]",
  BTN: "bottom-[18%] right-[8%]",
};

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
    <div className="relative mx-auto h-[420px] w-full max-w-3xl">
      <div className="absolute inset-10 rounded-[999px] border-8 border-felt-edge bg-felt shadow-[inset_0_0_80px_rgba(0,0,0,0.35)]" />
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <PlayingCard key={i} card={board[i]} hidden={!board[i]} />
          ))}
        </div>
        <div className="rounded-full bg-black/40 px-3 py-1 font-mono text-xs">Pot {potBB.toFixed(1)} BB</div>
      </div>
      {seats.map((seat) => (
        <div key={seat.position} className={cn("absolute w-36", POSITION_CLASS[seat.position] ?? POSITION_CLASS.SB)}>
          <div
            className={cn(
              "rounded-lg border bg-card/95 p-2 shadow-lg",
              seat.folded && "opacity-40",
              actor === seat.position && "ring-2 ring-primary",
              seat.isHero && "border-primary/70",
            )}
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium">{seat.position}</span>
              <span className="font-mono text-muted-foreground">{Math.min(seat.stackBB, 999).toFixed(1)} BB</span>
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

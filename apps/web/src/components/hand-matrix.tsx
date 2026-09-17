import { cn } from "@/lib/utils";

const MATRIX_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

export function HandMatrix({
  cells,
  onSelect,
  selected,
}: {
  cells: { type: string; frequency: number }[];
  onSelect?: (type: string) => void;
  selected?: string;
}) {
  const map = new Map(cells.map((c) => [c.type, c.frequency]));
  return (
    <div className="inline-grid grid-cols-13 gap-px rounded-lg border border-border bg-border p-px">
      {MATRIX_RANKS.map((rowRank, row) =>
        MATRIX_RANKS.map((colRank, col) => {
          const type = row === col ? `${rowRank}${colRank}` : col > row ? `${rowRank}${colRank}s` : `${colRank}${rowRank}o`;
          const freq = map.get(type) ?? 0;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onSelect?.(type)}
              className={cn(
                "h-7 w-7 text-[9px] font-medium",
                selected === type && "ring-2 ring-primary",
              )}
              style={{
                background: `color-mix(in oklab, var(--color-primary) ${Math.round(freq * 100)}%, oklch(0.2 0 0))`,
                color: freq > 0.45 ? "oklch(0.16 0.04 145)" : "oklch(0.85 0 0)",
              }}
              title={`${type} ${(freq * 100).toFixed(0)}%`}
            >
              {type}
            </button>
          );
        }),
      )}
    </div>
  );
}

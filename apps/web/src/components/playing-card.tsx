import { cn } from "@/lib/utils";

export function PlayingCard({
  card,
  hidden,
  small,
}: {
  card?: string;
  hidden?: boolean;
  small?: boolean;
}) {
  if (hidden || !card) {
    return (
      <div
        className={cn(
          "rounded border border-zinc-700 bg-zinc-800 shadow-sm",
          small ? "h-9 w-6" : "h-12 w-8",
        )}
      />
    );
  }
  const rank = card[0];
  const suit = card[1];
  const red = suit === "h" || suit === "d";
  const glyph = { s: "♠", h: "♥", d: "♦", c: "♣" }[suit ?? ""] ?? suit;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded border bg-zinc-100 font-mono font-semibold shadow-sm",
        red ? "border-red-300 text-red-600" : "border-zinc-300 text-zinc-900",
        small ? "h-9 w-6 text-[10px]" : "h-12 w-8 text-xs",
      )}
    >
      <span>{rank}</span>
      <span className="-mt-0.5">{glyph}</span>
    </div>
  );
}

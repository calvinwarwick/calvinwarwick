import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "outline" | "good" | "bad" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        variant === "default" && "bg-primary/15 text-primary",
        variant === "outline" && "border border-border text-muted-foreground",
        variant === "good" && "bg-emerald-500/15 text-emerald-400",
        variant === "bad" && "bg-red-500/15 text-red-400",
        variant === "muted" && "bg-secondary text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

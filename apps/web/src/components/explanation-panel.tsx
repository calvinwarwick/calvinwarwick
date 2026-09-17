import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmt, pct, signed } from "@/lib/utils";

export function ExplanationPanel({ explanation }: { explanation?: Record<string, any> | null }) {
  if (!explanation) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Decision explanation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Waiting for the next hero decision. Every action stores equity, EV, mix frequencies, and any exploit
          adjustments.
        </CardContent>
      </Card>
    );
  }

  const mix = explanation.finalStrategy ?? {};
  const baseline = explanation.baselineStrategy ?? {};

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Decision explanation</CardTitle>
          <Badge>{explanation.action}{explanation.amountBB ? ` ${fmt(explanation.amountBB)} BB` : ""}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Confidence" value={pct(explanation.confidence)} />
          <Metric label="Pot" value={`${fmt(explanation.potBB)} BB`} />
          <Metric label="Hero equity" value={pct(explanation.heroEquity)} />
          <Metric label="Fold equity" value={pct(explanation.estimatedFoldEquity)} />
          <Metric label="Required equity" value={pct(explanation.requiredEquity)} />
          <Metric label="Estimated EV" value={`${signed(explanation.estimatedEvBB ?? 0)} BB`} />
        </div>
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Baseline strategy</div>
          <MixBar mix={baseline} />
        </div>
        {explanation.opponentAdjustment && (
          <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed">
            <div className="mb-1 font-medium text-primary">Opponent adjustment</div>
            {explanation.opponentAdjustment}
          </div>
        )}
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Final strategy</div>
          <MixBar mix={mix} />
        </div>
        {explanation.heroHandStrength && (
          <div className="text-xs text-muted-foreground">
            {explanation.heroHandStrength}
            {explanation.draws?.length ? ` · ${explanation.draws.join(", ")}` : ""}
            {explanation.showdownValue ? ` · ${explanation.showdownValue}` : ""}
          </div>
        )}
        {explanation.evs?.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">EV breakdown</div>
            {explanation.evs.map((ev: any, i: number) => (
              <div key={i} className="rounded-md bg-secondary/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                <span className="text-foreground">{ev.action}</span> {ev.amountBB ? `${fmt(ev.amountBB)} BB ` : ""}
                {signed(ev.evBB)} BB — {ev.details}
              </div>
            ))}
          </div>
        )}
        {explanation.exploits?.map((ex: any, i: number) => (
          <div key={i} className="rounded-md border border-primary/20 p-3 text-xs">
            <div className="font-medium">{ex.name}</div>
            <div className="mt-1 text-muted-foreground">{ex.evidence}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">n={ex.sampleSize}</Badge>
              <Badge variant="outline">conf {pct(ex.confidence)}</Badge>
              <Badge variant="muted">{signed(ex.estimatedEvDiffBB)} BB</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function MixBar({ mix }: { mix: Record<string, number> }) {
  const parts = [
    ["Fold", mix.fold, "bg-zinc-500"],
    ["Check", mix.check, "bg-sky-500"],
    ["Call", mix.call, "bg-amber-500"],
    ["Bet", mix.bet, "bg-emerald-500"],
    ["Raise", mix.raise, "bg-primary"],
  ].filter(([, v]) => (v as number) > 0.01) as [string, number, string][];
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
        {parts.map(([label, v, color]) => (
          <div key={label} className={color} style={{ width: `${v * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {parts.map(([label, v]) => (
          <span key={label}>
            {label} {pct(v)}
          </span>
        ))}
      </div>
    </div>
  );
}

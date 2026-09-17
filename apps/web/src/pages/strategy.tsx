import { useEffect, useState } from "react";
import { HandMatrix } from "@/components/hand-matrix";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { pct } from "@/lib/utils";

export function StrategyPage() {
  const [filters, setFilters] = useState({
    position: "BTN",
    facing: "open",
    potType: "single-raised",
    opener: "CO",
    stackBb: "100",
  });
  const [data, setData] = useState<any>(null);
  const [hand, setHand] = useState("A5s");

  useEffect(() => {
    const q = new URLSearchParams({ ...filters, hand, street: "preflop" });
    api(`/api/strategy?${q}`).then(setData).catch(() => setData(null));
  }, [filters, hand]);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Strategy explorer</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          13×13 visualisation of 1,326 combinations. Frequencies are mixed, not “AK = raise” rules.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        {Object.entries(filters).map(([k, v]) => (
          <label key={k} className="text-xs text-muted-foreground">
            <div className="mb-1 capitalize">{k}</div>
            <input
              className="h-9 rounded-md border border-border bg-transparent px-2"
              value={v}
              onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[auto_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Raise frequency</CardTitle>
            <CardDescription>Click a cell such as A5s to inspect the mix.</CardDescription>
          </CardHeader>
          <CardContent>
            <HandMatrix cells={data?.raise ?? []} selected={hand} onSelect={setHand} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{hand}</CardTitle>
            <CardDescription>
              {filters.position} vs {filters.opener} {filters.facing} · {filters.stackBb} BB
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data?.selected ? (
              <>
                <Row label="Raise" value={pct(data.selected.raise)} />
                <Row label="Call" value={pct(data.selected.call)} />
                <Row label="Fold" value={pct(data.selected.fold)} />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Example: BTN vs CO 2.5 BB open can mix a 3-bet, a flat, and a fold on the same combo. The sampled
                  action is drawn from this distribution with a seeded RNG.
                </p>
              </>
            ) : (
              <div className="text-muted-foreground">Select a combo.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

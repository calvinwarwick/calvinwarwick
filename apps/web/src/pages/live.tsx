import { useEffect, useMemo, useState } from "react";
import { ExplanationPanel } from "@/components/explanation-panel";
import { PokerTable } from "@/components/poker-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, liveSocket } from "@/lib/api";

const SPEEDS = ["1x", "10x", "100x", "max"] as const;

export function LivePage() {
  const [live, setLive] = useState<any>({ running: false, speed: "10x", handsPlayed: 0 });
  const [showCards, setShowCards] = useState(true);
  const [hands, setHands] = useState(200);
  const [mode, setMode] = useState<"baseline" | "exploitative">("baseline");
  const [seed, setSeed] = useState(42);

  useEffect(() => {
    api("/api/live").then(setLive).catch(() => undefined);
    const ws = liveSocket();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.live) setLive(msg.live);
    };
    return () => ws.close();
  }, []);

  const seats = useMemo(() => {
    const history = live.lastHand?.history;
    if (history?.seats) {
      return history.seats.map((s: any) => ({
        name: s.name,
        position: s.position,
        stackBB: s.stackChips / 100,
        hole: s.holeCards,
        folded: s.folded,
        isHero: s.isHero,
        archetype: s.archetype,
      }));
    }
    return [
      { name: "Hero", position: "BTN", stackBB: 100, isHero: true, hole: ["As", "Jh"] },
      { name: "Nora TAG", position: "SB", stackBB: 91, hole: [] },
      { name: "Luis LAG", position: "BB", stackBB: 148, hole: [] },
      { name: "Rita Rec", position: "UTG", stackBB: 100, hole: [] },
      { name: "Stan Station", position: "HJ", stackBB: 80, hole: [] },
      { name: "Omar Overagg", position: "CO", stackBB: 110, hole: [] },
    ];
  }, [live]);

  const board = live.lastHand?.history?.board ?? live.lastDecision?.state?.board ?? [];
  const pot = live.lastDecision?.state?.potBB ?? live.lastHand?.history?.pots?.reduce((s: number, p: any) => s + p.amountChips, 0) / 100 ?? 1.5;

  return (
    <div className="grid gap-6 p-8 xl:grid-cols-[1.4fr_0.8fr]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Live simulation</h1>
            <p className="text-sm text-muted-foreground">Watch the agent act on structured NL25 state — not screenshots.</p>
          </div>
          <Badge variant={live.running ? "good" : "muted"}>{live.running ? "Running" : "Idle"}</Badge>
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <Field label="Hands">
              <input className="field" type="number" value={hands} onChange={(e) => setHands(Number(e.target.value))} />
            </Field>
            <Field label="Seed">
              <input className="field" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
            </Field>
            <Field label="Mode">
              <select className="field" value={mode} onChange={(e) => setMode(e.target.value as "baseline" | "exploitative")}>
                <option value="baseline">Baseline</option>
                <option value="exploitative">Exploitative</option>
              </select>
            </Field>
            <Button onClick={() => api("/api/live/start", { method: "POST", body: JSON.stringify({ hands, seed, mode, name: `Live ${mode}` }) })} disabled={live.running}>
              Start
            </Button>
            <Button variant="outline" onClick={() => api("/api/live/stop", { method: "POST" })}>
              Stop
            </Button>
            <Button variant="ghost" onClick={() => api("/api/live/pause", { method: "POST", body: JSON.stringify({ paused: !live.paused }) })}>
              {live.paused ? "Resume" : "Pause"}
            </Button>
            <div className="flex gap-1">
              {SPEEDS.map((s) => (
                <Button key={s} size="sm" variant={live.speed === s ? "default" : "outline"} onClick={() => api("/api/live/speed", { method: "POST", body: JSON.stringify({ speed: s }) })}>
                  {s}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showCards} onChange={(e) => setShowCards(e.target.checked)} />
              Show hole cards
            </label>
            <div className="ml-auto font-mono text-xs text-muted-foreground">
              {live.handsPlayed}/{live.targetHands || hands}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <PokerTable
              seats={seats}
              board={board}
              potBB={Number(pot) || 0}
              actor={live.lastDecision?.position}
              showCards={showCards}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Current action</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {live.lastDecision ? (
              <div>
                <span className="text-foreground">{live.lastDecision.actor}</span> ({live.lastDecision.position}) chose{" "}
                <span className="text-primary">{live.lastDecision.decision.action}</span>
                {live.lastDecision.decision.amountBB ? ` ${live.lastDecision.decision.amountBB} BB` : ""} on {live.lastDecision.street}.
              </div>
            ) : (
              "Start a simulation to stream table state and agent decisions."
            )}
          </CardContent>
        </Card>
      </div>
      <ExplanationPanel explanation={(live.lastHeroDecision ?? live.lastDecision)?.decision?.explanation} />
      <style>{`.field{height:2.25rem;border-radius:0.5rem;border:1px solid var(--color-border);background:transparent;padding:0 0.6rem;color:inherit;width:7rem}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-muted-foreground">
      <div className="mb-1">{label}</div>
      {children}
    </label>
  );
}

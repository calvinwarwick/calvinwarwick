import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { pct } from "@/lib/utils";

export function OpponentsPage() {
  const [data, setData] = useState<any>({ opponents: [], archetypes: [] });

  useEffect(() => {
    api("/api/opponents").then(setData).catch(() => setData({ opponents: [], archetypes: [] }));
  }, []);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Opponent explorer</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Population priors plus observed HUD stats. Confidence stays low until the sample is large enough to outweigh
          the prior.
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        {(data.opponents?.length ? data.opponents : data.archetypes ?? []).map((o: any) => {
          const hud = o.hud ?? o;
          return (
            <Card key={o.id ?? o.label}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{o.name ?? o.label}</CardTitle>
                  <Badge variant="outline">{o.archetype_id ?? o.id}</Badge>
                </div>
                <CardDescription>{o.description ?? "Simulated opponent with Bayesian HUD tracking."}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                {hud.vpip ? (
                  <>
                    <Stat name="VPIP" stat={hud.vpip} />
                    <Stat name="PFR" stat={hud.pfr} />
                    <Stat name="3Bet" stat={hud.threeBet} />
                    <Stat name="Fold to 3bet" stat={hud.foldTo3Bet} />
                    <Stat name="4Bet" stat={hud.fourBet} />
                    <Stat name="ATS" stat={hud.ats} />
                    <Stat name="Fold to steal" stat={hud.foldToSteal} />
                    <Stat name="Flop c-bet" stat={hud.flopCBet} />
                    <Stat name="Fold flop c-bet" stat={hud.foldToFlopCBet} />
                    <Stat name="WTSD" stat={hud.wtsd} />
                    <Stat name="W$SD" stat={hud.wsd} />
                    <Stat name="Agg freq" stat={hud.aggressionFrequency} />
                  </>
                ) : (
                  <>
                    <div>VPIP {pct(o.vpip)}</div>
                    <div>PFR {pct(o.pfr)}</div>
                    <div>3Bet {pct(o.threeBet)}</div>
                    <div>Fold3 {pct(o.foldTo3Bet)}</div>
                    <div>ATS {pct(o.ats)}</div>
                    <div>CBet {pct(o.flopCBet)}</div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ name, stat }: { name: string; stat: any }) {
  return (
    <div className="rounded-md bg-secondary/40 p-2">
      <div className="text-muted-foreground">{name}</div>
      <div className="font-mono text-sm">{pct(stat.estimate)}</div>
      <div className="text-[10px] text-muted-foreground">
        obs {stat.observed === null ? "—" : pct(stat.observed)} · n={stat.sampleSize} · conf {pct(stat.confidence)}
      </div>
    </div>
  );
}

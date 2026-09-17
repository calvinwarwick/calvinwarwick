import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmt, pct, signed } from "@/lib/utils";

export function DashboardPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api("/api/dashboard").then(setData).catch(() => setData({ latest: null, experiments: [] }));
  }, []);

  const analytics = data?.latest?.analytics;
  const uncertainty = data?.latest?.uncertainty ?? analytics?.uncertainty;
  const bankroll = analytics?.bankroll ?? [];

  return (
    <div className="space-y-6 p-8">
      <header>
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">NL25 research laboratory</div>
        <h1 className="mt-1 text-2xl font-semibold">Dashboard</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Observed win rate, EV, and uncertainty for the latest completed experiment. Short samples are not treated as
          proof that one strategy is better than another.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Stat label="Hands played" value={analytics?.hands ?? 0} />
        <Stat label="BB/100" value={signed(analytics?.bb100 ?? 0)} tone={(analytics?.bb100 ?? 0) >= 0 ? "good" : "bad"} />
        <Stat label="All-in adj. BB/100" value={signed(analytics?.allInAdjBb100 ?? 0)} />
        <Stat label="Total BB" value={signed(analytics?.totalBb ?? 0)} />
        <Stat label="EV" value={signed(analytics?.evBb ?? 0)} />
        <Stat label="VPIP" value={pct(analytics?.vpip ?? 0)} />
        <Stat label="PFR" value={pct(analytics?.pfr ?? 0)} />
        <Stat label="3Bet" value={pct(analytics?.threeBet ?? 0)} />
        <Stat label="WTSD" value={pct(analytics?.wtsd ?? 0)} />
        <Stat label="W$SD" value={pct(analytics?.wsd ?? 0)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Bankroll (BB)</CardTitle>
            <CardDescription>Cumulative profit and EV path. Variance is expected.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {bankroll.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={bankroll}>
                  <XAxis dataKey="hand" hide />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="bb" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="ev" stroke="#94a3b8" fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty>Run a live or headless experiment to populate the bankroll path.</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Uncertainty</CardTitle>
            <CardDescription>Observed results are not a ranking by themselves.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {uncertainty ? (
              <>
                <Row label="Sample size" value={String(uncertainty.sampleSize)} />
                <Row label="Observed BB/100" value={fmt(uncertainty.observedWinrateBb100)} />
                <Row label="EV BB/100" value={fmt(uncertainty.evWinrateBb100)} />
                <Row label="Std. error" value={fmt(uncertainty.stdErrorBb100)} />
                <Row
                  label="95% CI"
                  value={`[${fmt(uncertainty.ci95?.[0])}, ${fmt(uncertainty.ci95?.[1])}]`}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">{uncertainty.note}</p>
              </>
            ) : (
              <Empty>No completed experiment yet.</Empty>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Experiments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Name</th>
                  <th>Mode</th>
                  <th>Hands</th>
                  <th>Seed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.experiments ?? []).map((e: any) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-2">{e.name}</td>
                    <td>
                      <Badge variant="outline">{e.mode}</Badge>
                    </td>
                    <td className="font-mono">{e.hands}</td>
                    <td className="font-mono">{e.seed}</td>
                    <td>{e.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.experiments?.length && <Empty>No experiments stored yet.</Empty>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "bad" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cnTone(tone)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function cnTone(tone?: "good" | "bad") {
  return [
    "mt-1 font-mono text-xl",
    tone === "good" && "text-emerald-400",
    tone === "bad" && "text-red-400",
  ]
    .filter(Boolean)
    .join(" ");
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-sm text-muted-foreground">{children}</div>;
}

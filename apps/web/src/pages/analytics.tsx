import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmt } from "@/lib/utils";

export function AnalyticsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api("/api/analytics").then(setData).catch(() => setData({ empty: true }));
  }, []);

  const analytics = data?.analytics;
  const pos = Object.entries(analytics?.byPosition ?? {}).map(([k, v]: any) => ({ name: k, ...v }));
  const pots = Object.entries(analytics?.byPotType ?? {}).map(([k, v]: any) => ({ name: k, ...v }));
  const arch = Object.entries(analytics?.byArchetype ?? {}).map(([k, v]: any) => ({ name: k, ...v }));
  const stacks = Object.entries(analytics?.byStack ?? {}).map(([k, v]: any) => ({ name: k, ...v }));

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Position, pot type, starting-hand, stack depth, and archetype breakdowns. Intervals live on the dashboard and
          experiment compare view.
        </p>
      </header>
      {!analytics ? (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">Run an experiment to populate analytics.</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="BB/100 by position" data={pos} />
            <ChartCard title="BB/100 by pot type" data={pots} />
            <ChartCard title="Performance vs archetype" data={arch} />
            <ChartCard title="Stack depth" data={stacks} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Starting hands</CardTitle>
              <CardDescription>Highest cumulative profit in the current sample — not a ranking of true EV.</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">Hand</th>
                    <th>N</th>
                    <th>Profit BB</th>
                    <th>EV BB</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics.startingHands ?? []).slice(0, 20).map((h: any) => (
                    <tr key={h.hand} className="border-t border-border">
                      <td className="py-2 font-mono">{h.hand}</td>
                      <td>{h.hands}</td>
                      <td className="font-mono">{fmt(h.profitBb)}</td>
                      <td className="font-mono">{fmt(h.evBb)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, data }: { title: string; data: any[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="bb100" fill="var(--color-primary)" radius={4} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

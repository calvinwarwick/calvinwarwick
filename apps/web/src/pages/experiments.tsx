import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmt } from "@/lib/utils";

export function ExperimentsPage() {
  const [experiments, setExperiments] = useState<any[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [cmp, setCmp] = useState<any>(null);
  const [form, setForm] = useState({ name: "Baseline 500", mode: "baseline", hands: 200, seed: 42 });
  const [busy, setBusy] = useState(false);

  function reload() {
    api<{ experiments: any[] }>("/api/experiments").then((d) => setExperiments(d.experiments ?? []));
  }

  useEffect(() => {
    reload();
  }, []);

  async function run() {
    setBusy(true);
    try {
      await api("/api/experiments", { method: "POST", body: JSON.stringify(form) });
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    if (!a || !b) return;
    setCmp(await api("/api/experiments/compare", { method: "POST", body: JSON.stringify({ a, b }) }));
  }

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Experiments</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Compare baseline vs exploitative on the same seed. Headless runs can scale to hundreds of thousands of hands.
          Overlapping intervals mean you cannot claim superiority.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>New experiment</CardTitle>
          <CardDescription>Identical seeds reduce experimental noise across strategy modes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="inp" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="baseline">baseline</option>
            <option value="exploitative">exploitative</option>
          </select>
          <input className="inp w-28" type="number" value={form.hands} onChange={(e) => setForm({ ...form, hands: Number(e.target.value) })} />
          <input className="inp w-28" type="number" value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) })} />
          <Button onClick={run} disabled={busy}>
            {busy ? "Running…" : "Run headless"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Stored experiments</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">A</th>
                <th>B</th>
                <th>Name</th>
                <th>Mode</th>
                <th>Hands</th>
                <th>Seed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td>
                    <input type="radio" name="a" onChange={() => setA(e.id)} />
                  </td>
                  <td>
                    <input type="radio" name="b" onChange={() => setB(e.id)} />
                  </td>
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
          <Button className="mt-4" variant="outline" onClick={compare} disabled={!a || !b}>
            Compare A vs B
          </Button>
        </CardContent>
      </Card>
      {cmp?.comparison && (
        <Card>
          <CardHeader>
            <CardTitle>Comparison</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>Observed Δ BB/100: {fmt(cmp.comparison.observedDelta)}</div>
            <div>EV Δ BB/100: {fmt(cmp.comparison.evDelta)}</div>
            <div>Intervals overlap: {String(cmp.comparison.overlapping)}</div>
            <p className="text-muted-foreground">{cmp.comparison.verdict}</p>
          </CardContent>
        </Card>
      )}
      <style>{`.inp{height:2.25rem;border-radius:0.5rem;border:1px solid var(--color-border);background:transparent;padding:0 0.6rem;color:inherit}`}</style>
    </div>
  );
}

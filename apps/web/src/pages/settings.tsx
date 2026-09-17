import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    api<{ settings: any }>("/api/settings").then((d) => setSettings(d.settings));
  }, []);

  if (!settings) return <div className="p-8 text-sm text-muted-foreground">Loading settings…</div>;

  function update(key: string, value: unknown) {
    setSettings((s: any) => ({ ...s, [key]: value }));
  }

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Configurable NL25 economics, stack depths, and research defaults. This lab never connects to a poker client.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Table economics</CardTitle>
          <CardDescription>Default environment is $0.10/$0.25 NLHE 6-max with a 100 BB buy-in.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Num label="Small blind $" value={settings.dollarSb} onChange={(v) => update("dollarSb", v)} />
          <Num label="Big blind $" value={settings.dollarBb} onChange={(v) => update("dollarBb", v)} />
          <Num label="Default buy-in BB" value={settings.defaultBuyInBb} onChange={(v) => update("defaultBuyInBb", v)} />
          <Num label="Min stack BB" value={settings.minBuyInBb} onChange={(v) => update("minBuyInBb", v)} />
          <Num label="Max stack BB" value={settings.maxBuyInBb} onChange={(v) => update("maxBuyInBb", v)} />
          <Num label="Rake percent" value={settings.rakePercent} onChange={(v) => update("rakePercent", v)} step={0.005} />
          <Num label="Rake cap BB" value={settings.rakeCapBb} onChange={(v) => update("rakeCapBb", v)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Agent defaults</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <label className="text-sm">
            <div className="mb-1 text-muted-foreground">Mode</div>
            <select className="h-9 rounded-md border border-border bg-transparent px-2" value={settings.mode} onChange={(e) => update("mode", e.target.value)}>
              <option value="baseline">baseline</option>
              <option value="exploitative">exploitative</option>
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-muted-foreground">Accuracy</div>
            <select className="h-9 rounded-md border border-border bg-transparent px-2" value={settings.accuracy} onChange={(e) => update("accuracy", e.target.value)}>
              <option value="fast">fast</option>
              <option value="standard">standard</option>
              <option value="precise">precise</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.noFlopNoDrop} onChange={(e) => update("noFlopNoDrop", e.target.checked)} />
            No flop, no drop
          </label>
        </CardContent>
      </Card>
      <Button onClick={() => api("/api/settings", { method: "PUT", body: JSON.stringify(settings) })}>Save settings</Button>
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="text-sm">
      <div className="mb-1 text-muted-foreground">{label}</div>
      <input
        className="h-9 w-full rounded-md border border-border bg-transparent px-2 font-mono"
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

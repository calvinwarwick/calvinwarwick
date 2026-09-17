import { useEffect, useState } from "react";
import { ExplanationPanel } from "@/components/explanation-panel";
import { PlayingCard } from "@/components/playing-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmt, signed } from "@/lib/utils";

export function HandsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [cursor, setCursor] = useState(0);
  const [filters, setFilters] = useState({ position: "", potType: "", hole: "", action: "" });

  useEffect(() => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
    api<{ rows: any[] }>(`/api/hands?${q}`).then((d) => setRows(d.rows ?? [])).catch(() => setRows([]));
  }, [filters]);

  async function open(id: string) {
    const hand = await api<any>(`/api/hands/${id}`);
    setSelected(hand);
    setCursor(0);
  }

  const history = selected?.history_json ? JSON.parse(selected.history_json) : null;
  const explanations = (selected?.actions ?? []).filter((a: any) => a.explanation_json);
  const current = explanations[cursor];

  return (
    <div className="grid gap-6 p-8 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Hand explorer</h1>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input className="filter" placeholder="Position" value={filters.position} onChange={(e) => setFilters({ ...filters, position: e.target.value })} />
          <input className="filter" placeholder="Pot type" value={filters.potType} onChange={(e) => setFilters({ ...filters, potType: e.target.value })} />
          <input className="filter" placeholder="Hole cards" value={filters.hole} onChange={(e) => setFilters({ ...filters, hole: e.target.value })} />
          <input className="filter" placeholder="Action" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        </div>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Hand</th>
                  <th>Pos</th>
                  <th>Type</th>
                  <th>Profit</th>
                  <th>EV</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t border-border hover:bg-secondary/50" onClick={() => open(r.id)}>
                    <td className="px-4 py-2 font-mono text-xs">{r.hole_cards}</td>
                    <td>{r.position}</td>
                    <td>
                      <Badge variant="outline">{r.pot_type}</Badge>
                    </td>
                    <td className="font-mono">{signed(r.profit_bb)}</td>
                    <td className="font-mono">{signed(r.ev_bb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <div className="p-6 text-sm text-muted-foreground">No stored hands yet. Run a simulation first.</div>}
          </CardContent>
        </Card>
        {history && (
          <Card>
            <CardHeader>
              <CardTitle>Street reconstruction</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-1">
                {history.board.map((c: string) => (
                  <PlayingCard key={c} card={c} />
                ))}
              </div>
              <div className="space-y-1 font-mono text-xs text-muted-foreground">
                {history.actions.map((a: any, i: number) => (
                  <div key={i}>
                    {a.street.padEnd(8)} {a.position} {a.action}
                    {a.amountToChips ? ` ${fmt(a.amountToChips / 100)} BB` : ""}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0}>
            Previous decision
          </Button>
          <Button variant="outline" onClick={() => setCursor((c) => Math.min(explanations.length - 1, c + 1))} disabled={cursor >= explanations.length - 1}>
            Next decision
          </Button>
        </div>
        <ExplanationPanel explanation={current ? JSON.parse(current.explanation_json) : null} />
      </div>
      <style>{`.filter{height:2.25rem;border-radius:0.5rem;border:1px solid var(--color-border);background:transparent;padding:0 0.6rem;color:inherit}`}</style>
    </div>
  );
}

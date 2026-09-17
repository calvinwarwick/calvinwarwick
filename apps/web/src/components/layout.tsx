import {
  Beaker,
  ChartNoAxesCombined,
  FlaskConical,
  LayoutDashboard,
  Play,
  Settings,
  Spade,
  Users,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/live", label: "Live Simulation", icon: Play },
  { to: "/hands", label: "Hands", icon: Spade },
  { to: "/strategy", label: "Strategy", icon: FlaskConical },
  { to: "/opponents", label: "Opponents", icon: Users },
  { to: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { to: "/experiments", label: "Experiments", icon: Beaker },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-border bg-card/80">
        <div className="px-5 py-5">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Offline lab</div>
          <div className="mt-1 font-semibold">Poker Lab</div>
          <div className="text-xs text-muted-foreground">NLHE $0.10/$0.25 · 6-max</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground",
                  isActive && "bg-secondary text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
          Research simulation only. No real-money play, no client automation, no private game-state capture.
        </div>
      </aside>
      <main className="ml-60 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}

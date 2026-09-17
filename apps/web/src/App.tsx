import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout";
import { AnalyticsPage } from "@/pages/analytics";
import { DashboardPage } from "@/pages/dashboard";
import { ExperimentsPage } from "@/pages/experiments";
import { HandsPage } from "@/pages/hands";
import { LivePage } from "@/pages/live";
import { OpponentsPage } from "@/pages/opponents";
import { SettingsPage } from "@/pages/settings";
import { StrategyPage } from "@/pages/strategy";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/hands" element={<HandsPage />} />
        <Route path="/strategy" element={<StrategyPage />} />
        <Route path="/opponents" element={<OpponentsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/experiments" element={<ExperimentsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

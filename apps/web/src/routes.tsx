import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useSettings } from './api.ts';
import Onboarding from './onboarding/Onboarding.tsx';
import ChoreReducersPage from './pages/ChoreReducersPage.tsx';
import DesignPreviewPage from './pages/DesignPreviewPage.tsx';
import HomePage from './pages/HomePage.tsx';
import ListsPage from './pages/ListsPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import WorkflowPage from './pages/WorkflowPage.tsx';
import AppShell from './shell/AppShell.tsx';

/**
 * M5 Task 5: until `settings.onboarded` is true, every in-app route redirects
 * to /welcome. While settings load a placeholder renders (neither the
 * protected page nor a redirect flash), and /welcome itself renders outside
 * the shell with no nav rail.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const location = useLocation();
  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!settings.onboarded && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }
  return children;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="welcome" element={<Onboarding />} />
      <Route
        element={
          <OnboardingGate>
            <AppShell />
          </OnboardingGate>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="reducers" element={<ChoreReducersPage />} />
        <Route path="reducers/:workflowId" element={<WorkflowPage />} />
        <Route path="lists" element={<ListsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="design" element={<DesignPreviewPage />} />
      </Route>
    </Routes>
  );
}

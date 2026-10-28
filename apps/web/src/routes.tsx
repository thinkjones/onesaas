import { Route, Routes } from 'react-router';
import ChoreReducersPage from './pages/ChoreReducersPage.tsx';
import HomePage from './pages/HomePage.tsx';
import ListsPage from './pages/ListsPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import WorkflowPage from './pages/WorkflowPage.tsx';
import AppShell from './shell/AppShell.tsx';

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="reducers" element={<ChoreReducersPage />} />
        <Route path="reducers/:workflowId" element={<WorkflowPage />} />
        <Route path="lists" element={<ListsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

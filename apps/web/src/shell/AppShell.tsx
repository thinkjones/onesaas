import { Outlet, useLocation } from 'react-router';
import { useWorkflows } from '../api.ts';
import TellMeMoreFallback from '../explain/TellMeMoreFallback.tsx';
import Sidebar from './Sidebar.tsx';
import TopBar from './TopBar.tsx';

export default function AppShell() {
  // Floating Craft shell (design-system-prompt §4): sidebar and main are
  // rounded panels on the window backdrop with an 8px gap; the main panel
  // carries the sky canvas gradient, a TopBar (§6), and the scrolling content
  // column. Only .content scrolls. Under Tauri's Overlay title bar the window
  // drags from the sidebar strip + the top bar (both carry
  // data-tauri-drag-region); browsers ignore the attribute.
  const location = useLocation();
  const workflowsQuery = useWorkflows();
  // Bug #7: first-time Automate (no chores yet, or still loading) hides the
  // sidebar AND the top bar so the pure prompt stands alone; chrome appears
  // with the first chore.
  const hideNav =
    location.pathname === '/automate' &&
    (workflowsQuery.data === undefined || workflowsQuery.data.length === 0);
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-window">
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {/* Off-workflow "Tell me more" routing (renders nothing). */}
        <TellMeMoreFallback />
        {/* The sidebar carries its own panel chrome (Craft §5). */}
        {!hideNav && <Sidebar />}
        <main className="bg-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius)] border border-border shadow-sm">
          {!hideNav && <TopBar />}
          <div className="min-w-0 flex-1 overflow-y-auto px-8 pt-3 pb-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

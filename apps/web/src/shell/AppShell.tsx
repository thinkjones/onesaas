import { Outlet, useLocation } from 'react-router';
import { isTauri, useWorkflows } from '../api.ts';
import TellMeMoreFallback from '../explain/TellMeMoreFallback.tsx';
import NavRail from './NavRail.tsx';

export default function AppShell() {
  // Floating Craft shell (Bug #2, CRM look): sidebar and main are rounded
  // panels on the window backdrop; the main panel carries the sky canvas
  // gradient. Flow-based (min-h-screen) so page scrolling is unchanged.
  // Under Tauri's Overlay title bar (Bug #6) a thin drag strip sits above
  // the panels so the frameless window can be moved; browsers never render
  // it, so web layout is untouched.
  const inTauri = isTauri();
  const location = useLocation();
  const workflowsQuery = useWorkflows();
  // Bug #7: first-time Automate (no chores yet, or still loading) hides the
  // sidebar so the pure prompt stands alone; it appears with the first chore.
  const hideNav =
    location.pathname === '/automate' &&
    (workflowsQuery.data === undefined || workflowsQuery.data.length === 0);
  return (
    <div className="flex min-h-screen flex-col bg-window">
      {inTauri && <div data-tauri-drag-region aria-hidden className="h-7 w-full shrink-0" />}
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {/* Off-workflow "Tell me more" routing (renders nothing). */}
        <TellMeMoreFallback />
        {/* Capped so larger text sizes don't eat the content column (238px is
            w-56 at the 17px default root — identical there, bounded above). */}
        {!hideNav && (
          <aside className="w-56 max-w-[238px] shrink-0 rounded-[var(--radius)] border border-border bg-sidebar shadow-sm">
            <NavRail />
          </aside>
        )}
        <main className="bg-canvas min-w-0 flex-1 rounded-[var(--radius)] border border-border p-6 shadow-sm">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

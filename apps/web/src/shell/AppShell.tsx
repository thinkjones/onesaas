import { Outlet } from 'react-router';
import TellMeMoreFallback from '../explain/TellMeMoreFallback.tsx';
import NavRail from './NavRail.tsx';

export default function AppShell() {
  // Floating Craft shell (Bug #2, CRM look): sidebar and main are rounded
  // panels on the window backdrop; the main panel carries the sky canvas
  // gradient. Flow-based (min-h-screen) so page scrolling is unchanged.
  return (
    <div className="flex min-h-screen gap-2 bg-window p-2">
      {/* Off-workflow "Tell me more" routing (renders nothing). */}
      <TellMeMoreFallback />
      {/* Capped so larger text sizes don't eat the content column (238px is
          w-56 at the 17px default root — identical there, bounded above). */}
      <aside className="w-56 max-w-[238px] shrink-0 rounded-[var(--radius)] border border-border bg-sidebar shadow-sm">
        <NavRail />
      </aside>
      <main className="bg-canvas min-w-0 flex-1 rounded-[var(--radius)] border border-border p-6 shadow-sm">
        <Outlet />
      </main>
    </div>
  );
}

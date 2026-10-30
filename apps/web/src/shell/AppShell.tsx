import { Outlet } from 'react-router';
import NavRail from './NavRail.tsx';

export default function AppShell() {
  return (
    <div className="flex min-h-screen">
      {/* Capped so larger text sizes don't eat the content column (238px is
          w-56 at the 17px default root — identical there, bounded above). */}
      <aside className="w-56 max-w-[238px] shrink-0 border-r">
        <NavRail />
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

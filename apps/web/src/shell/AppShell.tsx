import { Outlet } from 'react-router';
import NavRail from './NavRail.tsx';

export default function AppShell() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r">
        <NavRail />
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

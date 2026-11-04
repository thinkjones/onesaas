import { Outlet, useLocation } from 'react-router';
import { isTauri } from '../api.ts';
import TellMeMoreFallback from '../explain/TellMeMoreFallback.tsx';
import { useDesktopFocus } from './DesktopFocus.ts';
import FloatingBar from './FloatingBar.tsx';

/**
 * One full-screen board with the floating bar over it, Miro style: no sidebar
 * and no fixed chrome. An automation's canvas fills the whole board; every
 * other screen scrolls beneath the bar.
 */
export default function AppShell() {
  // Extension "open the app" button: no-op in browsers.
  useDesktopFocus();
  const location = useLocation();
  const fullBleed = /^\/reducers\/[^/]+$/.test(location.pathname);
  return (
    <main className="board relative h-screen overflow-hidden">
      {/* Off-workflow "Tell me more" routing (renders nothing). */}
      <TellMeMoreFallback />
      {/* The webview can't be dragged by its hidden title bar: this strip stands in. */}
      {isTauri() && <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-30 h-3" />}
      <FloatingBar />
      <div
        data-testid="shell-content"
        className={
          fullBleed
            ? 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden'
            : 'h-full min-w-0 overflow-y-auto px-6 pt-20 pb-6'
        }
      >
        <Outlet />
      </div>
    </main>
  );
}

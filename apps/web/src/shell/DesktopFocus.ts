import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { isTauri, onAppFocus } from '../api.ts';

/**
 * Desktop focus (the extension's "open the app" button): inside the Tauri
 * shell, app-focus SSE events focus the window and navigate it. Browsers
 * ignore these events entirely. Mounted once in AppShell.
 */
export function useDesktopFocus(): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isTauri()) return;
    return onAppFocus((e) => {
      // Focus first, best-effort: a focus failure must never block
      // navigation. Dynamically imported so browsers never load the API.
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setFocus())
        .catch(() => {});
      navigate(e.hash ? `${e.path}#${e.hash}` : e.path);
    });
  }, [navigate]);
}

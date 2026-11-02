import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { useLiveEvents, useSettings, useTimezoneSync } from './api.ts';
import { Toaster } from './components/ui/sonner.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import { AltClickExplainRoot } from './explain/Explain.tsx';
import AppRoutes from './routes.tsx';
import TextSizeProvider from './theme/TextSizeProvider.tsx';

const queryClient = new QueryClient();

function LiveEvents() {
  useLiveEvents();
  return null;
}

function TimezoneSync() {
  useTimezoneSync();
  return null;
}

/**
 * Applies the stored text size to <html>. Falls back to Normal until
 * settings load; the settings page updates it live via the shared
 * ['settings'] query. Light/dark follows the OS (prefers-color-scheme).
 */
function SettingsTextSize({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  return <TextSizeProvider textSize={settings?.textSize ?? 'normal'}>{children}</TextSizeProvider>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SettingsTextSize>
          <BrowserRouter>
            <LiveEvents />
            <TimezoneSync />
            <AppRoutes />
          </BrowserRouter>
        </SettingsTextSize>
        <AltClickExplainRoot />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

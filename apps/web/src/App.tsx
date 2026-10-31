import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { useLiveEvents, useSettings, useTimezoneSync } from './api.ts';
import { Toaster } from './components/ui/sonner.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import { AltClickExplainRoot } from './explain/Explain.tsx';
import AppRoutes from './routes.tsx';
import ThemeProvider from './theme/ThemeProvider.tsx';

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
 * Applies the stored look (theme + text size) to <html>. Falls back to
 * Morning/Normal until settings load; the settings page updates it live via
 * the shared ['settings'] query.
 */
function SettingsTheme({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  return (
    <ThemeProvider theme={settings?.theme ?? 'morning'} textSize={settings?.textSize ?? 'normal'}>
      {children}
    </ThemeProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SettingsTheme>
          <BrowserRouter>
            <LiveEvents />
            <TimezoneSync />
            <AppRoutes />
          </BrowserRouter>
        </SettingsTheme>
        <AltClickExplainRoot />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

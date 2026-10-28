import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { useLiveEvents } from './api.ts';
import { Toaster } from './components/ui/sonner.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import AppRoutes from './routes.tsx';

const queryClient = new QueryClient();

function LiveEvents() {
  useLiveEvents();
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <LiveEvents />
          <AppRoutes />
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

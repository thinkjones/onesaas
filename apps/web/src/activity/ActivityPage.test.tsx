import type { Run, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ActivityPage from './ActivityPage.tsx';

function workflow(id: string, name: string): Workflow {
  return {
    id,
    name,
    description: `${name}.`,
    version: 1,
    status: 'on',
    trigger: { id: 't', type: 'trigger.manual', title: 'Manual', summary: '', config: {}, inputs: {}, position: { x: 0, y: 0 } },
    steps: [],
    edges: [],
  };
}

function run(id: string, workflowId: string, startedAt: string, status: Run['status']): Run {
  return {
    id,
    workflowId,
    workflowVersion: 1,
    triggerPayload: { email: { fromName: 'Sarah Lee', subject: 'Kitchen tap quote' } },
    status,
    kind: 'live',
    usedSample: false,
    startedAt,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function LocationProbe({ onLocation }: { onLocation: (pathname: string, search: string) => void }) {
  const location = useLocation();
  onLocation(location.pathname, location.search);
  return null;
}

function renderActivity(runs: Run[]) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const json = async () => {
      if (url === '/api/workflows') return [workflow('wf-1', 'Leads'), workflow('wf-2', 'Bookings')];
      if (url === '/api/runs') return runs;
      if (url === '/api/runs/run-new')
        return { story: ['Saved Sarah Lee to customers', 'Drafted a reply for approval'] };
      if (url === '/api/runs/run-old') return { story: [] };
      throw new Error(`unexpected fetch: ${url}`);
    };
    return { ok: true, status: 200, json } as Response;
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let pathname = '/';
  let search = '';
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ActivityPage />} />
          <Route
            path="/reducers/:workflowId"
            element={
              <LocationProbe
                onLocation={(p, s) => {
                  pathname = p;
                  search = s;
                }}
              />
            }
          />
          <Route path="/automate" element={<p>Automate</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { location: () => ({ pathname, search }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ActivityPage', () => {
  test('groups runs under Today and Past with time, reducer, story line and status', async () => {
    renderActivity([
      run('run-old', 'wf-2', daysAgo(10), 'done'),
      run('run-new', 'wf-1', daysAgo(0), 'waiting'),
    ]);
    // Wait for the per-row story queries before asserting row contents.
    await screen.findByText('Drafted a reply for approval');
    expect(screen.getByText('Today')).toBeDefined();
    expect(screen.getByText('Past')).toBeDefined();
    const rows = screen.getAllByRole('link', { name: /Leads|Bookings/ });
    expect(rows.map((r) => r.textContent)).toHaveLength(2);
    // Newest first, with the story's last line; older row falls back to the sender.
    expect(rows[0]!.textContent).toContain('Leads');
    expect(rows[0]!.textContent).toContain('Drafted a reply for approval');
    expect(rows[1]!.textContent).toContain('Bookings');
    expect(rows[1]!.textContent).toContain('Sarah Lee');
  });

  test('clicking a row opens that run in Watch it Run mode', async () => {
    const { location } = renderActivity([run('run-new', 'wf-1', daysAgo(0), 'done')]);
    fireEvent.click(await screen.findByRole('link', { name: /Leads/ }));
    await waitFor(() => {
      expect(location().pathname).toBe('/reducers/wf-1');
    });
    expect(location().search).toBe('?mode=runtime&run=run-new');
  });

  test('empty activity points to Automate', async () => {
    renderActivity([]);
    const link = await screen.findByRole('link', { name: /automate/i });
    fireEvent.click(link);
    expect(await screen.findByText('Automate')).toBeDefined();
  });
});

import type { Run, Workflow } from '@onesaas/shared';
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
            path="/automations/:workflowId"
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
  test('what needs you is a card; everything else is a table row', async () => {
    renderActivity([
      run('run-old', 'wf-2', daysAgo(10), 'done'),
      run('run-new', 'wf-1', daysAgo(0), 'waiting'),
    ]);
    const card = (await screen.findByText('Drafted a reply for approval')).closest('a')!;
    expect(card.textContent).toContain('Leads');
    expect(card.getAttribute('href')).toBe('/automations/wf-1?mode=runs&run=run-new');
    expect(screen.getByRole('columnheader', { name: 'What happened' })).toBeDefined();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Bookings');
    expect(rows[0]!.textContent).toContain('Sarah Lee');
    expect(screen.getByText('Today your automations did one thing. One needs you.')).toBeDefined();
  });

  test('filters narrow by what needs you and by automation', async () => {
    renderActivity([
      run('run-old', 'wf-2', daysAgo(10), 'done'),
      run('run-new', 'wf-1', daysAgo(0), 'waiting'),
    ]);
    await screen.findByText('Drafted a reply for approval');
    fireEvent.click(screen.getByRole('button', { name: 'Needs you' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Drafted a reply for approval')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Drafted a reply for approval')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Needs you' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by automation' }), {
      target: { value: 'wf-2' },
    });
    expect(await screen.findByText(/Nothing needs you right now/)).toBeDefined();
  });

  test('clicking a row opens its automation with that run overlaid', async () => {
    const { location } = renderActivity([run('run-new', 'wf-1', daysAgo(0), 'done')]);
    fireEvent.click((await screen.findAllByRole('row'))[1]!);
    await waitFor(() => {
      expect(location().pathname).toBe('/automations/wf-1');
    });
    expect(location().search).toBe('?mode=runs&run=run-new');
  });

  test('empty activity points to Automate', async () => {
    renderActivity([]);
    const link = await screen.findByRole('link', { name: /automate/i });
    fireEvent.click(link);
    expect(await screen.findByText('Automate')).toBeDefined();
  });
});

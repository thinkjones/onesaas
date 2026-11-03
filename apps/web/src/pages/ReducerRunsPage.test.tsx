import type { Run, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import ReducerRunsPage from './ReducerRunsPage.tsx';

function mkWorkflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Leads',
    description: 'Leads.',
    version: 1,
    status: 'on',
    trigger: { id: 't', type: 'trigger.manual', title: 'Manual', summary: '', config: {}, inputs: {}, position: { x: 0, y: 0 } },
    steps: [],
    edges: [],
  };
}

function mkRun(id: string, startedAt: string): Run {
  return {
    id,
    workflowId: 'wf-1',
    workflowVersion: 1,
    triggerPayload: { email: { fromName: 'Sarah Lee', subject: 'Kitchen tap quote' } },
    status: 'done',
    kind: 'live',
    usedSample: false,
    startedAt,
  };
}

function renderRunsPage(runs: Run[]) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const json = async () => {
      if (url === '/api/workflows') return [mkWorkflow()];
      if (url === '/api/runs?workflowId=wf-1') return runs;
      if (url.startsWith('/api/runs/')) return { story: [] };
      throw new Error(`unexpected fetch: ${url}`);
    };
    return { ok: true, status: 200, json } as Response;
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reducers/wf-1/runs']}>
        <Routes>
          <Route path="/reducers/:workflowId/runs" element={<ReducerRunsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('list review requests that reducer runs and groups them like Activity', async () => {
  const { fetch } = renderRunsPage([
    mkRun('run-new', new Date().toISOString()),
    mkRun('run-old', new Date(Date.now() - 10 * 86_400_000).toISOString()),
  ]);
  expect(await screen.findByRole('region', { name: 'Leads runs' })).toBeDefined();
  expect(screen.getByText('Today')).toBeDefined();
  expect(screen.getByText('Past')).toBeDefined();
  expect(fetch).toHaveBeenCalledWith('/api/runs?workflowId=wf-1');
});

test('run links open Watch it Run mode for that run', async () => {
  renderRunsPage([mkRun('run-new', new Date().toISOString())]);
  await screen.findByRole('region', { name: 'Leads runs' });
  const row = screen.getByRole('link', { name: /Sarah Lee/ });
  expect(row.getAttribute('href')).toBe('/reducers/wf-1?mode=runtime&run=run-new');
});

test('empty list review says no runs yet', async () => {
  renderRunsPage([]);
  expect(await screen.findByText('No runs yet.')).toBeDefined();
});

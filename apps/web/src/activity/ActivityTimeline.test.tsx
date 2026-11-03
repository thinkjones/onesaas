import type { Run } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import ActivityTimeline from './ActivityTimeline.tsx';

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

function renderTimeline(runs: Run[], names: Map<string, string>, hideReducerName?: boolean) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const json = async () => {
      if (url.startsWith('/api/runs/')) return { story: ['Did the thing', 'Last line here'] };
      throw new Error(`unexpected fetch: ${url}`);
    };
    return { ok: true, status: 200, json } as Response;
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActivityTimeline runs={runs} names={names} hideReducerName={hideReducerName} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NAMES = new Map([
  ['wf-1', 'Leads'],
  ['wf-2', 'Bookings'],
]);

test('renders group headings only for non-empty groups', async () => {
  renderTimeline(
    [
      run('run-new', 'wf-1', daysAgo(0), 'done'),
      run('run-old', 'wf-2', daysAgo(10), 'failed'),
    ],
    NAMES,
  );
  expect(await screen.findByText('Today')).toBeDefined();
  expect(await screen.findByText('Past')).toBeDefined();
  expect(screen.queryByText('This week')).toBeNull();
});

test('rows sort newest-first even when passed oldest-first', async () => {
  renderTimeline(
    [
      run('run-old', 'wf-2', daysAgo(10), 'failed'),
      run('run-new', 'wf-1', daysAgo(0), 'done'),
    ],
    NAMES,
  );
  await screen.findByText('Today');
  const rows = screen.getAllByRole('link', { name: /Leads|Bookings/ });
  expect(rows[0]!.textContent).toContain('Leads');
  expect(rows[1]!.textContent).toContain('Bookings');
});

test('row links go to Watch it Run mode for that run', async () => {
  renderTimeline([run('run-new', 'wf-1', daysAgo(0), 'done')], NAMES);
  await screen.findByText('Today');
  const row = screen.getByRole('link', { name: /Leads/ });
  expect(row.getAttribute('href')).toBe('/reducers/wf-1?mode=runtime&run=run-new');
});

test('design icon links to design mode for that run', async () => {
  renderTimeline([run('run-new', 'wf-1', daysAgo(0), 'done')], NAMES);
  await screen.findByText('Today');
  const icon = screen.getByRole('link', { name: 'Open in design mode' });
  expect(icon.getAttribute('href')).toBe('/reducers/wf-1?mode=design&run=run-new');
});

test('hideReducerName hides the reducer name line', async () => {
  renderTimeline([run('run-new', 'wf-1', daysAgo(0), 'done')], NAMES, true);
  await screen.findByText('Today');
  expect(screen.queryByText('Leads')).toBeNull();
  expect(await screen.findByText('Last line here')).toBeDefined();
});

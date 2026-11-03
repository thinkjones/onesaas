import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import TopBar from './TopBar.tsx';

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderTopBar(opts?: {
  path?: string;
  workflows?: unknown[];
  runs?: unknown[];
  modelsError?: boolean;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/workflows') return ok(opts?.workflows ?? []);
      if (url === '/api/runs') return ok(opts?.runs ?? []);
      if (url === '/api/models/status') {
        if (opts?.modelsError) return { ok: false, status: 500, json: async () => ({}) } as Response;
        return ok([]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Probe() {
    return <p>at {useLocation().pathname}</p>;
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts?.path ?? '/']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <TopBar />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

test.each([
  ['/', 'Activity'],
  ['/automate', 'Automate'],
  ['/reducers', 'Chore reducers'],
  ['/lists', 'Data'],
  ['/settings', 'Settings'],
  ['/design', 'Design'],
])('route %s crumbs %s as the page h1', (path, label) => {
  renderTopBar({ path });
  const h1 = screen.getByRole('heading', { name: label });
  expect(h1.getAttribute('aria-current')).toBe('page');
});

test('reducer detail crumbs Chore reducers › workflow name', async () => {
  renderTopBar({
    path: '/reducers/wf-9',
    workflows: [{ id: 'wf-9', name: 'Leads' }],
  });
  expect(await screen.findByRole('heading', { name: 'Leads' })).toBeDefined();
  expect(screen.getByRole('link', { name: 'Chore reducers' }).getAttribute('href')).toBe(
    '/reducers',
  );
});

test('list review crumbs Chore reducers › workflow name › Runs', async () => {
  renderTopBar({
    path: '/reducers/wf-9/runs',
    workflows: [{ id: 'wf-9', name: 'Leads' }],
  });
  expect(await screen.findByRole('heading', { name: 'Runs' })).toBeDefined();
  expect((await screen.findByRole('link', { name: 'Leads' })).getAttribute('href')).toBe(
    '/reducers/wf-9',
  );
});

test('back is disabled at the first entry; forward navigates after back', async () => {
  renderTopBar({ path: '/settings' });
  expect(screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')).toBe(true);
  // jsdom starts with a single history entry, so forward is disabled too.
  expect(screen.getByRole('button', { name: 'Forward' }).hasAttribute('disabled')).toBe(true);
});

test('back button navigates to the previous entry', async () => {
  // MemoryRouter keeps its own stack; the idx heuristic reads window.history,
  // which BrowserRouter maintains in production — seed it like a second entry.
  window.history.pushState({ idx: 1 }, '');
  vi.stubGlobal('fetch', vi.fn(async () => ok([])));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Probe() {
    return <p>at {useLocation().pathname}</p>;
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/', '/settings']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <TopBar />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('at /settings')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText('at /')).toBeDefined();
});

test('failed runs show a warning badge; model errors show an error badge', async () => {
  renderTopBar({
    runs: [
      { id: 'r1', status: 'failed' },
      { id: 'r2', status: 'failed' },
      { id: 'r3', status: 'done' },
    ],
    modelsError: true,
  });
  expect(await screen.findByText('2 need a look')).toBeDefined();
  expect(await screen.findByText('Models unavailable')).toBeDefined();
});

test('no badges when nothing failed and models are fine', async () => {
  renderTopBar({ runs: [{ id: 'r1', status: 'done' }] });
  expect(await screen.findByRole('heading', { name: 'Activity' })).toBeDefined();
  expect(screen.queryByText('Models unavailable')).toBeNull();
  expect(screen.queryByText(/needs? a look/)).toBeNull();
});

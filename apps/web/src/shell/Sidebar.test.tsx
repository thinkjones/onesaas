import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import Sidebar from './Sidebar.tsx';

const SETTINGS = {
  businessName: 'Corner Bakery',
  timezone: 'America/New_York',
  textSize: 'normal',
  sound: { on: true, volume: 0.25 },
  onboarded: true,
  moodFileIds: [],
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderSidebar(path = '/') {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/settings') return ok(SETTINGS);
    if (url === '/api/workflows' && init?.method === 'POST') {
      return ok({ id: 'wf-new', name: 'Untitled chore reducer' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Probe() {
    const location = useLocation();
    return (
      <p>
        at {location.pathname}
        {location.search}
      </p>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <Sidebar />
                <Probe />
              </>
            }
          />
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

test('renders nav links Inbox, Automate, Data and footer Settings', () => {
  renderSidebar();
  for (const name of ['Inbox', 'Automate', 'Data', 'Settings']) {
    expect(screen.getByRole('link', { name })).toBeDefined();
  }
});

test('active route gets the active class and aria-current="page"', () => {
  renderSidebar('/lists');
  const active = screen.getByRole('link', { name: 'Data' });
  expect(active.getAttribute('aria-current')).toBe('page');
  expect(active.classList.contains('active')).toBe(true);
  expect(screen.getByRole('link', { name: 'Inbox' }).getAttribute('aria-current')).toBeNull();
});

test('create toolbar makes a chore reducer and opens it in design mode', async () => {
  const { fetch } = renderSidebar();
  fireEvent.click(await screen.findByRole('button', { name: 'New chore reducer' }));
  expect(await screen.findByText('at /reducers/wf-new?mode=design')).toBeDefined();
  const posts = fetch.mock.calls.filter(
    ([url, init]) => String(url) === '/api/workflows' && (init as RequestInit)?.method === 'POST',
  );
  expect(posts).toHaveLength(1);
});

test('footer shows the business name once settings load', async () => {
  renderSidebar();
  expect(await screen.findByText('Corner Bakery')).toBeDefined();
});

test('each nav link keeps an Explain button outside the link', () => {
  renderSidebar();
  for (const name of ['Inbox', 'Automate', 'Data', 'Settings']) {
    expect(screen.getByRole('button', { name: `Explain ${name}` })).toBeDefined();
    // The accessible name stays exactly the label (icon + ? excluded).
    expect(screen.getByRole('link', { name }).textContent).toBe(name);
  }
});

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

const WF1 = { id: 'wf-1', name: 'Morning triage' };
const WF2 = { id: 'wf-2', name: 'File receipts' };

const CUSTOMERS = {
  name: 'customers',
  label: 'Customers',
  columns: [],
  displayField: 'name',
  count: 5,
};
const ORDERS = {
  name: 'orders',
  label: 'Orders',
  columns: [],
  displayField: 'name',
  count: 2,
};

function renderSidebar(
  path = '/',
  seed?: { workflows?: unknown[]; lists?: unknown[] },
) {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/settings') return ok(SETTINGS);
    if (url === '/api/workflows' && init?.method === 'POST') {
      return ok({ id: 'wf-new', name: 'Untitled chore reducer' });
    }
    if (url === '/api/workflows') return ok(seed?.workflows ?? []);
    if (url === '/api/lists') return ok(seed?.lists ?? []);
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

test('renders nav links Activity, Automate, Data and footer Settings', () => {
  renderSidebar();
  for (const name of ['Activity', 'Automate', 'Data', 'Settings']) {
    expect(screen.getByRole('link', { name })).toBeDefined();
  }
});

test('active route gets the active class and aria-current="page"', () => {
  renderSidebar('/lists');
  const active = screen.getByRole('link', { name: 'Data' });
  expect(active.getAttribute('aria-current')).toBe('page');
  expect(active.classList.contains('active')).toBe(true);
  expect(screen.getByRole('link', { name: 'Activity' }).getAttribute('aria-current')).toBeNull();
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
  for (const name of ['Activity', 'Automate', 'Data', 'Settings']) {
    expect(screen.getByRole('button', { name: `Explain ${name}` })).toBeDefined();
    // The accessible name stays exactly the label (icon + ? excluded).
    expect(screen.getByRole('link', { name }).textContent).toBe(name);
  }
});

test('chore reducers list underneath Automate, before Data', async () => {
  renderSidebar('/', { workflows: [WF1, WF2], lists: [] });
  const first = await screen.findByRole('link', { name: 'Morning triage' });
  expect(first.getAttribute('href')).toBe('/reducers/wf-1');
  expect(screen.getByRole('link', { name: 'File receipts' }).getAttribute('href')).toBe(
    '/reducers/wf-2',
  );
  // DOM order pins the placement: Automate, then its reducers, then Data.
  const automate = screen.getByRole('link', { name: 'Automate' });
  const data = screen.getByRole('link', { name: 'Data' });
  expect(automate.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(first.compareDocumentPosition(data) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('stored lists show underneath Data as label and count', async () => {
  renderSidebar('/', { workflows: [], lists: [CUSTOMERS, ORDERS] });
  const customers = await screen.findByRole('link', { name: 'Customers · 5' });
  expect(customers.getAttribute('href')).toBe('/lists?table=customers');
  expect(screen.getByRole('link', { name: 'Orders · 2' }).getAttribute('href')).toBe(
    '/lists?table=orders',
  );
  const data = screen.getByRole('link', { name: 'Data' });
  expect(data.compareDocumentPosition(customers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('the open reducer row is marked current', async () => {
  renderSidebar('/reducers/wf-1', { workflows: [WF1, WF2], lists: [] });
  const current = await screen.findByRole('link', { name: 'Morning triage' });
  expect(current.getAttribute('aria-current')).toBe('page');
  expect(current.classList.contains('active')).toBe(true);
  expect(screen.getByRole('link', { name: 'File receipts' }).getAttribute('aria-current')).toBeNull();
});

test('the selected list row is marked current', async () => {
  renderSidebar('/lists?table=orders', { workflows: [], lists: [CUSTOMERS, ORDERS] });
  const current = await screen.findByRole('link', { name: 'Orders · 2' });
  expect(current.getAttribute('aria-current')).toBe('page');
  expect(current.classList.contains('active')).toBe(true);
  expect(screen.getByRole('link', { name: 'Customers · 5' }).getAttribute('aria-current')).toBeNull();
});

test('no sublists render when there is nothing to show', async () => {
  renderSidebar('/', { workflows: [], lists: [] });
  // Settle: the (empty) queries resolve, so a stray sublist would appear.
  await screen.findByRole('link', { name: 'Automate' });
  await screen.findByText('Corner Bakery');
  expect(screen.queryByTestId('sidebar-reducers')).toBeNull();
  expect(screen.queryByTestId('sidebar-lists')).toBeNull();
});

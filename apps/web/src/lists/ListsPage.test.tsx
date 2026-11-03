import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ListsPage from './ListsPage.tsx';
import type { ListSummary, ViewDef } from './types.ts';

const TABLE: ListSummary = {
  name: 'customers',
  label: 'Customers',
  columns: [{ name: 'name', label: 'Name', type: 'text' }],
  displayField: 'name',
  count: 5,
};

const ORDERS: ListSummary = {
  name: 'orders',
  label: 'Orders',
  columns: [{ name: 'name', label: 'Name', type: 'text' }],
  displayField: 'name',
  count: 2,
};

const PIN: ViewDef = {
  id: 'v1',
  table: 'customers',
  kind: 'stat',
  title: 'How many',
  pinned: true,
  config: { stat: { op: 'count' } },
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function err(status: number, message: string): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: message }),
    json: async () => ({ error: message }),
  } as Response;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc-search">{location.search}</span>;
}

function renderLists(opts?: {
  views?: ViewDef[];
  viewData?: (id: string) => Response;
  rows?: Record<string, unknown>[];
  total?: number;
  tables?: ListSummary[];
  entry?: string;
}) {
  const tables = opts?.tables ?? [TABLE];
  const rows = opts?.rows ?? [{ id: 1, name: 'A' }];
  const total = opts?.total ?? rows.length;
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/api/lists') return ok(tables);
    if (url.startsWith('/api/lists/') && url.includes('/rows')) return ok({ rows, total });
    if (url === '/api/views') return ok(opts?.views ?? []);
    if (url.startsWith('/api/views/') && url.endsWith('/data')) {
      const id = url.slice('/api/views/'.length, -'/data'.length);
      return opts?.viewData ? opts.viewData(id) : ok({ value: 3 });
    }
    if (url === '/api/settings')
      return ok({
        timezone: '',
        textSize: 'normal',
        sound: { on: true, volume: 0.25 },
        onboarded: false,
        moodFileIds: [],
      });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts?.entry ?? '/lists']}>
        <ListsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ListsPage', () => {
  test('a pinned number whose data fails shows an error and keeps Unpin', async () => {
    renderLists({
      views: [PIN],
      viewData: () => err(400, 'Unknown column: naem for table customers'),
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't load this number. Try again.");
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeDefined();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  test('a truncated row list says how many of the total are shown', async () => {
    renderLists({
      rows: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      total: 5,
    });
    expect(await screen.findByText('Showing 2 of 5')).toBeDefined();
  });

  test('a complete row list shows no truncation note', async () => {
    renderLists({
      rows: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      total: 2,
    });
    await screen.findByText('A');
    expect(screen.queryByText(/Showing \d+ of \d+/)).toBeNull();
  });

  test('?table= selects that table on landing', async () => {
    renderLists({ tables: [TABLE, ORDERS], entry: '/lists?table=orders' });
    expect(await screen.findByRole('region', { name: 'Orders' })).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Customers' })).toBeNull();
  });

  test('an unknown ?table= falls back to the first table', async () => {
    renderLists({ tables: [TABLE, ORDERS], entry: '/lists?table=nope' });
    expect(await screen.findByRole('region', { name: 'Customers' })).toBeDefined();
  });

  test('clicking a list writes ?table= to the URL', async () => {
    renderLists({ tables: [TABLE, ORDERS] });
    expect(await screen.findByRole('region', { name: 'Customers' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Orders · 2' }));
    expect(await screen.findByRole('region', { name: 'Orders' })).toBeDefined();
    expect(screen.getByTestId('loc-search').textContent).toBe('?table=orders');
  });
});

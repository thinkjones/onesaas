import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { ModelStatus } from '../api.ts';
import SettingsPage from './SettingsPage.tsx';

const SETTINGS = {
  timezone: 'America/New_York',
  textSize: 'normal',
  sound: { on: true, volume: 0.25 },
  onboarded: true,
  moodFileIds: [],
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const SPARK_ROWS: ModelStatus[] = [
  { role: 'builder', provider: 'meta', model: 'muse-spark-1.3', healthy: true },
  { role: 'planner', provider: 'meta', model: 'muse-wonder-1.0', healthy: true },
  {
    role: 'triage',
    provider: 'meta',
    model: 'muse-spark-1.3',
    healthy: true,
    note: "Glimmer isn't running on this computer",
  },
  { role: 'vision', provider: 'meta', model: 'muse-spark-1.3', healthy: true },
];

function renderSettings(
  models: ModelStatus[] | 'hang',
  onNavigate?: (path: string) => void,
  health: 'up' | 'down' = 'up',
  debug?: { events: Array<{ t: string; msg: string }> } | 'fail',
) {
  let settings: Record<string, unknown> = { ...SETTINGS };
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    // The Tauri shell calls absolute loopback URLs; browsers use relative paths.
    const url = String(input).replace('http://127.0.0.1:8787', '');
    if (url === '/api/settings') {
      if (init?.method === 'PUT') {
        settings = { ...settings, ...JSON.parse(String(init.body)) };
      }
      return ok(settings);
    }
    if (url === '/api/data/reset' && init?.method === 'POST') return ok({ ok: true });
    if (url === '/api/models/status') {
      if (models === 'hang') return new Promise<Response>(() => {});
      return ok(models);
    }
    if (url === '/api/pairing/status') return ok({ paired: false, connected: false });
    if (url === '/api/debug/events') {
      if (debug === 'fail') throw new Error('unreachable');
      return ok({ events: debug?.events ?? [] });
    }
    if (url === '/health') {
      if (health === 'down') throw new Error('unreachable');
      return ok({ ok: true });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function LocationProbe() {
    const location = useLocation();
    useEffect(() => {
      onNavigate?.(location.pathname);
    }, [location.pathname]);
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <LocationProbe />
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('healthy glimmer shows the on-this-computer sentence plus one line per role', async () => {
  renderSettings(
    SPARK_ROWS.map((r) =>
      r.role === 'triage'
        ? { role: 'triage' as const, provider: 'glimmer' as const, model: 'glimmer-1', healthy: true }
        : r,
    ),
  );
  expect(
    await screen.findByText(/Inbox sorting runs on this computer/),
  ).toBeDefined();
  expect(await screen.findByText('Building automations: Muse Spark')).toBeDefined();
  expect(await screen.findByText('Big plans: Muse Wonder')).toBeDefined();
  expect(await screen.findByText('Reading web pages: Muse Spark')).toBeDefined();
});

test('spark fallback shows the fallback sentence', async () => {
  renderSettings(SPARK_ROWS);
  expect(
    await screen.findByText(
      "Inbox sorting is using Muse Spark (Glimmer isn't running on this computer).",
    ),
  ).toBeDefined();
  expect(await screen.findByText('Building automations: Muse Spark')).toBeDefined();
  expect(await screen.findByText('Big plans: Muse Wonder')).toBeDefined();
});

test('unhealthy glimmer also shows the fallback sentence', async () => {
  renderSettings(
    SPARK_ROWS.map((r) =>
      r.role === 'triage'
        ? {
            role: 'triage' as const,
            provider: 'glimmer' as const,
            model: 'glimmer-1',
            healthy: false,
            note: "Glimmer isn't running on this computer",
          }
        : r,
    ),
  );
  expect(
    await screen.findByText(
      "Inbox sorting is using Muse Spark (Glimmer isn't running on this computer).",
    ),
  ).toBeDefined();
});

test('thinking shows a checking line while the status loads', async () => {
  renderSettings('hang');
  expect(await screen.findByText('Checking which model handles what…')).toBeDefined();
});

test('unknown model ids render raw instead of guessing a family', async () => {
  renderSettings(
    SPARK_ROWS.map((r) =>
      r.role === 'builder'
        ? { ...r, model: 'muse-spark-9.9-future' }
        : r.role === 'planner'
          ? { ...r, model: 'muse-wonder-next' }
          : r,
    ),
  );
  expect(await screen.findByText('Building automations: muse-spark-9.9-future')).toBeDefined();
  expect(await screen.findByText('Big plans: muse-wonder-next')).toBeDefined();
});

test('unknown future roles render the raw role id', async () => {
  renderSettings([
    ...SPARK_ROWS,
    {
      role: 'scheduler' as unknown as ModelStatus['role'],
      provider: 'meta',
      model: 'muse-spark-1.3',
      healthy: true,
    },
  ]);
  expect(await screen.findByText('scheduler: Muse Spark')).toBeDefined();
});

test('reset data posts only on the second tap, then lands on welcome', async () => {
  const seen: string[] = [];
  const { fetch } = renderSettings(SPARK_ROWS, (path) => seen.push(path));
  const button = await screen.findByRole('button', { name: 'Reset data' });
  fireEvent.click(button);
  expect(await screen.findByRole('button', { name: 'Yes, reset data' })).toBeDefined();
  expect(fetch.mock.calls.some(([url]) => String(url) === '/api/data/reset')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Yes, reset data' }));
  await screen.findByRole('button', { name: 'Reset data' });
  expect(
    fetch.mock.calls.some(
      ([url, init]) => String(url) === '/api/data/reset' && (init as RequestInit).method === 'POST',
    ),
  ).toBe(true);
  expect(seen.at(-1)).toBe('/welcome');
});

test('reset onboarding flips onboarded off, then lands on welcome', async () => {
  const seen: string[] = [];
  const { fetch } = renderSettings(SPARK_ROWS, (path) => seen.push(path));
  fireEvent.click(await screen.findByRole('button', { name: 'Reset onboarding' }));
  expect(await screen.findByRole('button', { name: 'Yes, reset onboarding' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, reset onboarding' }));
  await screen.findByRole('button', { name: 'Reset onboarding' });
  const puts = fetch.mock.calls.filter(
    ([url, init]) => String(url) === '/api/settings' && (init as RequestInit | undefined)?.method === 'PUT',
  );
  expect(puts).toHaveLength(1);
  expect(JSON.parse(String((puts[0]![1] as RequestInit).body))).toEqual({ onboarded: false });
  expect(seen.at(-1)).toBe('/welcome');
});

test('an armed reset button disarms after five seconds', async () => {
  renderSettings(SPARK_ROWS);
  await screen.findByRole('button', { name: 'Reset data' });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Reset data' }));
  expect(screen.getByRole('button', { name: 'Yes, reset data' })).toBeDefined();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByRole('button', { name: 'Reset data' })).toBeDefined();
});

test('services shows window type, api base + health, and bridge state', async () => {
  renderSettings(SPARK_ROWS);
  expect(await screen.findByText('Services')).toBeDefined();
  expect(await screen.findByText('This window: Browser tab')).toBeDefined();
  expect(await screen.findByText(`App API: ${window.location.origin} (Running)`)).toBeDefined();
  expect(await screen.findByText('Extension bridge: ws://127.0.0.1:8787/ext (Not connected)')).toBeDefined();
});

test('services shows desktop shell + loopback api inside Tauri', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  renderSettings(SPARK_ROWS);
  expect(await screen.findByText('This window: Desktop app')).toBeDefined();
  expect(await screen.findByText('App API: http://127.0.0.1:8787 (Running)')).toBeDefined();
});

test('services shows api down when health is unreachable', async () => {
  renderSettings(SPARK_ROWS, undefined, 'down');
  expect(await screen.findByText(/App API: .* \(Down\)/)).toBeDefined();
});

test('diagnostics shows the server event log newest last', async () => {
  renderSettings(SPARK_ROWS, undefined, 'up', {
    events: [
      { t: '2026-05-01T12:00:01.000Z', msg: 'hello valid=true' },
      { t: '2026-05-01T12:00:02.000Z', msg: 'pair code=123456 redeemed=true' },
    ],
  });
  const log = await screen.findByTestId('server-log');
  expect(log.textContent ?? '').toContain('[12:00:01] hello valid=true');
  expect(log.textContent ?? '').toContain('[12:00:02] pair code=123456 redeemed=true');
});

test('diagnostics refresh reloads the server log', async () => {
  const debug = { events: [{ t: '2026-05-01T12:00:01.000Z', msg: 'first-line' }] };
  renderSettings(SPARK_ROWS, undefined, 'up', debug);
  const log = await screen.findByTestId('server-log');
  expect(log.textContent ?? '').toContain('first-line');
  debug.events = [{ t: '2026-05-01T12:00:09.000Z', msg: 'second-line' }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh log' }));
  await vi.waitFor(() => expect(log.textContent ?? '').toContain('second-line'));
});

test('diagnostics shows an error when the server log is unreachable', async () => {
  renderSettings(SPARK_ROWS, undefined, 'up', 'fail');
  expect(await screen.findByText('Could not load the server log.')).toBeDefined();
});

test('diagnostics points at the extension-side log', async () => {
  renderSettings(SPARK_ROWS);
  expect(
    await screen.findByText('Extension side: open the extension popup, then “Connection log”.'),
  ).toBeDefined();
});

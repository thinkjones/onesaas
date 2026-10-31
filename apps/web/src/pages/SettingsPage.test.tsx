import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ModelStatus } from '../api.ts';
import SettingsPage from './SettingsPage.tsx';

const SETTINGS = {
  timezone: 'America/New_York',
  theme: 'morning',
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

function renderSettings(models: ModelStatus[] | 'hang') {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/api/settings') return ok(SETTINGS);
    if (url === '/api/models/status') {
      if (models === 'hang') return new Promise<Response>(() => {});
      return ok(models);
    }
    if (url === '/api/pairing/status') return ok({ paired: false, connected: false });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
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
    await screen.findByText('Inbox sorting runs on this computer (Muse Glimmer) ✓'),
  ).toBeDefined();
  expect(await screen.findByText('Building chore reducers: Muse Spark')).toBeDefined();
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
  expect(await screen.findByText('Building chore reducers: Muse Spark')).toBeDefined();
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
  expect(await screen.findByText('Building chore reducers: muse-spark-9.9-future')).toBeDefined();
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

import type { Run, StepInstance, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router';
import { type RunDetail } from '../api.ts';
import RuntimeView from './RuntimeView.tsx';

// ReactFlow needs ResizeObserver (absent in jsdom), so the canvas is a stub —
// these tests exercise URL pinning and the list/detail branches, not the graph.
vi.mock('../canvas/WorkflowCanvas.tsx', () => ({
  default: ({ workflow }: { workflow: Workflow }) => (
    <div data-testid="canvas">{workflow.id}</div>
  ),
}));

function step(id: string): StepInstance {
  return {
    id,
    type: 'ai.extract',
    title: id,
    summary: `${id} summary.`,
    config: {},
    inputs: {},
    position: { x: 0, y: 0 },
  };
}

const WF: Workflow = {
  id: 'flow-1',
  name: 'Test flow',
  description: 'Test flow.',
  version: 1,
  status: 'on',
  trigger: step('trigger'),
  steps: [step('extract')],
  edges: [{ from: 'trigger', to: 'extract' }],
};

function makeRun(id: string, fromName: string): Run {
  return {
    id,
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: { email: { fromName } },
    status: 'done',
    kind: 'live',
    usedSample: false,
    startedAt: '2026-10-28T10:42:00.000Z',
  };
}

function makeDetail(run: Run, story: string[]): RunDetail {
  return {
    run,
    steps: [
      {
        id: `sr-${run.id}`,
        runId: run.id,
        stepId: 'extract',
        status: 'done',
        output: { name: 'x' },
        startedAt: run.startedAt,
      },
    ],
    story,
    workflow: WF,
  };
}

const ALICE = makeRun('run-alice', 'Alice');
const BOB = makeRun('run-bob', 'Bob');
const CARA = makeRun('run-cara', 'Cara');
const BOB_DETAIL = makeDetail(BOB, ['Bob started this run.', 'Bob approved the reply.']);
const ALICE_DETAIL = makeDetail(ALICE, ['Alice started this run.']);
const CARA_DETAIL = makeDetail(CARA, ['Cara started this run.']);

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
}

function seed(client: QueryClient, runs: Run[], details: RunDetail[]): void {
  client.setQueryData(['runs', 'flow-1'], runs);
  for (const d of details) client.setQueryData(['run', d.run.id], d);
}

/**
 * Exposes the live location so tests can assert pin-back without a live
 * server. MemoryRouter (not the data router) is deliberate: data-router
 * navigations construct undici Requests that blow up on jsdom's AbortSignal.
 */
function LocationProbe() {
  const [params] = useSearchParams();
  const location = useLocation();
  return (
    <>
      <span data-testid="pinned-run">{params.get('run') ?? 'none'}</span>
      <span data-testid="pinned-step">{params.get('step') ?? 'none'}</span>
      <span data-testid="loc-path">{location.pathname}</span>
    </>
  );
}

function renderRuntime(client: QueryClient, initialEntry: string) {
  const navRef: { current: ((delta: number) => void) | null } = { current: null };
  function NavCapture() {
    const navigate = useNavigate();
    useEffect(() => {
      navRef.current = navigate;
    }, [navigate]);
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/first', initialEntry]} initialIndex={1}>
        <RuntimeView workflowId="flow-1" />
        <LocationProbe />
        <NavCapture />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { navRef };
}

// Seeded caches mean no fetch should ever fire in the pinning tests; the
// error/loading tests below re-stub fetch per test.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (): Promise<Response> => {
      throw new Error('unexpected fetch — seed the query cache instead');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RuntimeView run pinning', () => {
  test('landing without ?run= pins the newest id into the URL via replace', async () => {
    const client = makeClient();
    seed(client, [BOB, ALICE], [BOB_DETAIL, ALICE_DETAIL]);
    const { navRef } = renderRuntime(client, '/');
    await waitFor(() => {
      expect(screen.getByTestId('pinned-run').textContent).toBe('run-bob');
    });
    // Replace, not push: going back skips the unpinned URL and lands on the
    // entry before it. (A push would land back on '/' with ?run= bare.)
    act(() => {
      navRef.current!(-1);
    });
    expect(screen.getByTestId('loc-path').textContent).toBe('/first');
  });

  test('a stale ?run= is rewritten to newest and ?step= is preserved', async () => {
    const client = makeClient();
    seed(client, [BOB, ALICE], [BOB_DETAIL, ALICE_DETAIL]);
    renderRuntime(client, '/?run=run-gone&step=extract');
    await waitFor(() => {
      expect(screen.getByTestId('pinned-run').textContent).toBe('run-bob');
    });
    expect(screen.getByTestId('pinned-step').textContent).toBe('extract');
  });

  test('a newer run arriving after the pin does not yank the selection', async () => {
    const client = makeClient();
    seed(client, [BOB, ALICE], [BOB_DETAIL, ALICE_DETAIL]);
    renderRuntime(client, '/');
    await waitFor(() => {
      expect(screen.getByTestId('pinned-run').textContent).toBe('run-bob');
    });
    // A newer run arrives via SSE invalidation (the runs refetch grows the
    // list). Its detail is pre-cached so no fetch fires — what this test
    // exercises is selection stability, not the fetch.
    await act(async () => {
      client.setQueryData(['run', CARA.id], CARA_DETAIL);
      client.setQueryData(['runs', 'flow-1'], [CARA, BOB, ALICE]);
    });
    // Settle: a yank would land synchronously on the rerender, but give any
    // stray async write a chance to show itself too.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId('pinned-run').textContent).toBe('run-bob');
    expect(screen.getByRole('option', { name: /Cara/ })).toBeDefined();
    expect(
      screen.getByRole('option', { name: /Bob/ }).getAttribute('aria-selected'),
    ).toBe('true');
    // The story header still shows Bob's run (first line is story-only; the
    // last line appears twice: the list row's preview + the story itself).
    expect(screen.getByText('Bob started this run.')).toBeDefined();
    expect(screen.getAllByText('Bob approved the reply.')).toHaveLength(2);
  });
});

describe('RuntimeView detail branches', () => {
  test('detail 404 shows the error AND the runs list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'Unknown run: run-bob' }),
      })),
    );
    const client = makeClient();
    seed(client, [BOB], []);
    renderRuntime(client, '/?run=run-bob');
    expect(await screen.findByText("Couldn't load this run")).toBeDefined();
    expect(screen.getByRole('listbox', { name: 'Runs' })).toBeDefined();
    expect(screen.getByRole('option', { name: /Bob/ })).toBeDefined();
  });

  test('run-switch loading keeps the runs list mounted', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const client = makeClient();
    seed(client, [BOB], []);
    renderRuntime(client, '/?run=run-bob');
    expect(screen.getByText('Loading run…')).toBeDefined();
    expect(screen.getByRole('listbox', { name: 'Runs' })).toBeDefined();
  });
});

describe('RuntimeView canvas', () => {
  test('the canvas container has a definite height', async () => {
    // Same collapse as design mode (see the DesignView canvas test):
    // WorkflowCanvas is mocked here, but the real container div wraps it.
    const client = makeClient();
    seed(client, [BOB, ALICE], [BOB_DETAIL, ALICE_DETAIL]);
    renderRuntime(client, '/');
    await waitFor(() => {
      expect(screen.getByTestId('pinned-run').textContent).toBe('run-bob');
    });
    const container = screen.getByTestId('canvas').parentElement;
    expect(container?.className).toMatch(/(?<![\w-])h-\[\d+px\]/);
  });
});

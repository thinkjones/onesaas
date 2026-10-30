import type { Run, StepInstance, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type RunDetail, type Settings, type WorkflowDetail } from '../api.ts';
import DesignView from '../design/DesignView.tsx';
import RuntimeView from '../runtime/RuntimeView.tsx';

// M5 Task 4 D1 regression: the mood backdrop paints at z-index:-1, so its
// canvas container must create a stacking context (`isolate`); otherwise the
// container's own opaque bg-card background paints above the backdrop and
// hides it. ReactFlow needs ResizeObserver (absent in jsdom), so the canvas
// is a stub — these tests lock in the stacking classes, not the graph.
vi.mock('../canvas/WorkflowCanvas.tsx', () => ({
  default: ({ workflow }: { workflow: Workflow }) => (
    <div data-testid="canvas">{workflow.id}</div>
  ),
}));

function step(id: string, title: string): StepInstance {
  return {
    id,
    type: 'ai.extract',
    title,
    summary: `${title}.`,
    config: {},
    inputs: {},
    position: { x: 0, y: 0 },
  };
}

const TRIGGER = step('trigger', 'Manual trigger');

const WF: Workflow = {
  id: 'flow-1',
  name: 'Test flow',
  description: 'Test flow.',
  version: 1,
  status: 'draft',
  trigger: TRIGGER,
  steps: [step('s1', 'Pick out the details')],
  edges: [{ from: 'trigger', to: 's1' }],
};

const DETAIL: WorkflowDetail = { ...WF, problems: [] };

const SETTINGS: Settings = {
  timezone: 'UTC',
  theme: 'morning',
  textSize: 'normal',
  sound: { on: false, volume: 0.5 },
  onboarded: true,
  moodFileIds: [],
};

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
}

beforeEach(() => {
  vi.stubGlobal('EventSource', class {
    onmessage: ((msg: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;
    close(): void {}
  });
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

function expectIsolatedBackdrop(container: HTMLElement): void {
  const backdrop = container.querySelector('.mood-backdrop');
  expect(backdrop).not.toBeNull();
  const parent = backdrop!.parentElement!;
  // The stacking context that keeps the z-index:-1 backdrop above the
  // container's own opaque background yet below the canvas content.
  expect(parent.classList.contains('isolate')).toBe(true);
  expect(parent.classList.contains('relative')).toBe(true);
  // The canvas still mounts inside the same container, above the backdrop.
  expect(parent.querySelector('[data-testid="canvas"]')).not.toBeNull();
}

test('DesignView canvas container isolates the mood backdrop stacking context', async () => {
  const client = makeClient();
  client.setQueryData(['workflow', 'flow-1'], DETAIL);
  client.setQueryData(['settings'], SETTINGS);
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/design/flow-1']}>
        <DesignView workflowId="flow-1" onRequestRuntime={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('canvas')).toBeDefined();
  });
  expectIsolatedBackdrop(container);
});

test('RuntimeView canvas container isolates the mood backdrop stacking context', async () => {
  const run: Run = {
    id: 'run-1',
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'done',
    kind: 'live',
    usedSample: false,
    startedAt: '2026-10-28T10:42:00.000Z',
  };
  const runDetail: RunDetail = {
    run,
    steps: [],
    story: ['Run one started.'],
    workflow: { ...WF, status: 'on' },
  };
  const client = makeClient();
  client.setQueryData(['runs', 'flow-1'], [run]);
  client.setQueryData(['run', 'run-1'], runDetail);
  client.setQueryData(['settings'], SETTINGS);
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?run=run-1']}>
        <RuntimeView workflowId="flow-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('canvas')).toBeDefined();
  });
  expectIsolatedBackdrop(container);
});

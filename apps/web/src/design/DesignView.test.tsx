import type { StepInstance, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WorkflowDetail } from '../api.ts';
import DesignView from './DesignView.tsx';

function step(id: string, title: string, position = { x: 500, y: 100 }): StepInstance {
  return {
    id,
    type: 'ai.extract',
    title,
    summary: `${title}.`,
    config: { instructions: 'Read it.', fields: [] },
    inputs: {},
    position,
  };
}

const TRIGGER: StepInstance = {
  id: 'trigger',
  type: 'trigger.manual',
  title: 'Manual trigger',
  summary: 'Runs when you start it by hand.',
  config: {},
  inputs: {},
  position: { x: 100, y: 100 },
};

function detail(
  steps: StepInstance[] = [step('s1', 'Pick out the details')],
  problems: WorkflowDetail['problems'] = [],
): WorkflowDetail {
  const wf: Workflow = {
    id: 'flow-1',
    name: 'Test flow',
    description: 'Test flow.',
    version: 1,
    status: 'draft',
    trigger: TRIGGER,
    steps,
    edges: steps.map((s) => ({ from: 'trigger', to: s.id })),
  };
  return { ...wf, problems };
}

// Captures EventSource subscribers so tests can deliver agent events.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {}
}

function emitAgent(workflowId: string, event: unknown): void {
  const data = JSON.stringify({ type: 'agent', workflowId, event });
  for (const inst of FakeEventSource.instances) inst.onmessage?.({ data });
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    return { ok: true, status: 200, json: async () => handler(url, init) } as Response;
  });
}

function renderDesign(
  initialDetail: WorkflowDetail,
  opts?: {
    entry?: string;
    onRequestRuntime?: () => void;
    onBuilt?: (info: { stepId: string; title: string }) => void;
    fetchHandler?: (url: string, init?: RequestInit) => unknown;
  },
) {
  const fetch = mockFetch(
    opts?.fetchHandler ??
      ((url, init) => {
        if (url === '/api/workflows/flow-1') return initialDetail;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          return { ok: true, workflow: initialDetail, note: 'Done.' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRequestRuntime = opts?.onRequestRuntime ?? (() => {});
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts?.entry ?? '/reducers/flow-1']}>
        <Toaster />
        <DesignView workflowId="flow-1" onRequestRuntime={onRequestRuntime} onBuilt={opts?.onBuilt} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, fetch, client };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DesignView ghosts', () => {
  const PLAN = {
    type: 'plan',
    ghosts: [
      { id: 'ghost-a', type: 'gmail.read', title: 'Read the email', summary: 'Reads it.' },
      { id: 'ghost-b', type: 'table.upsert', title: 'Save the customer', summary: 'Saves it.' },
      { id: 'ghost-c', type: 'ai.write', title: 'Write the reply', summary: 'Writes it.' },
    ],
    edges: [
      { from: 'ghost-a', to: 'ghost-b' },
      { from: 'ghost-b', to: 'ghost-c' },
    ],
  };

  test('a plan event renders 3 ghosts; built for the 2nd title leaves 2 ghosts and 1 real node', async () => {
    const onBuilt = vi.fn();
    const d = detail([step('save-1', 'Save the customer')]);
    const { container } = renderDesign(d, { onBuilt });
    // The real step is there from the start; no ghosts until the plan arrives.
    expect(await screen.findByText('Save the customer')).toBeDefined();
    expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(0);

    act(() => emitAgent('flow-1', PLAN));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(3);
    });

    act(() => emitAgent('flow-1', { type: 'built', stepId: 'save-1' }));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(2);
    });
    // The matching ghost is gone; the real box (not a ghost) remains.
    expect(container.querySelector('[data-step-id="save-1"]')).not.toBeNull();
    expect(screen.getAllByText('Save the customer')).toHaveLength(1);
    expect(onBuilt).toHaveBeenCalledWith({ stepId: 'save-1', title: 'Save the customer' });
  });

  test('duplicate ghost titles match in order (first unmatched wins)', async () => {
    const onBuilt = vi.fn();
    const d = detail([step('save-1', 'Save the customer')]);
    const { container } = renderDesign(d, { onBuilt });
    await screen.findByText('Save the customer');
    act(() =>
      emitAgent('flow-1', {
        type: 'plan',
        ghosts: [
          { id: 'ghost-a', type: 'table.upsert', title: 'Save the customer', summary: 'Saves it.' },
          { id: 'ghost-b', type: 'table.upsert', title: 'Save the customer', summary: 'Saves it twice.' },
        ],
        edges: [],
      }),
    );
    await waitFor(() => {
      expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(2);
    });
    act(() => emitAgent('flow-1', { type: 'built', stepId: 'save-1' }));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(1);
    });
    // The surviving ghost is the second one; the real box is there too.
    expect(screen.getByText('Saves it twice.')).toBeDefined();
    expect(screen.queryByText('Saves it.')).toBeNull();
    expect(container.querySelector('[data-step-id="save-1"]')).not.toBeNull();
    expect(onBuilt).toHaveBeenCalledWith({ stepId: 'save-1', title: 'Save the customer' });
  });

  test('events for other workflows are ignored', async () => {
    const { container } = renderDesign(detail());
    await screen.findByText('Pick out the details');
    act(() => emitAgent('other-flow', PLAN));
    // Let any misrouted render flush.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(0);
  });
});

describe('DesignView problems and turn on', () => {
  test('two problems replace "Turn on" with "2 things to fix before turning on"', async () => {
    renderDesign(
      detail([step('s1', 'Pick out the details'), step('s2', 'Write the reply')], [
        { stepId: 's1', problem: "This step isn't set up yet: instructions is missing." },
        { stepId: 's2', problem: 'Nothing leads to this step yet.' },
      ]),
    );
    expect(await screen.findByText('2 things to fix before turning on')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
    // Each troubled box shows its problem in an amber badge.
    expect(screen.getByText("This step isn't set up yet: instructions is missing.")).toBeDefined();
    expect(screen.getByText('Nothing leads to this step yet.')).toBeDefined();
  });

  test('one problem reads "1 thing to fix before turning on"', async () => {
    renderDesign(detail([step('s1', 'Pick out the details')], [
      { stepId: 's1', problem: 'Nothing leads to this step yet.' },
    ]));
    expect(await screen.findByText('1 thing to fix before turning on')).toBeDefined();
  });

  test('"Turn on" calls setStatus(on) and switches to runtime mode', async () => {
    const onRequestRuntime = vi.fn();
    const { fetch } = renderDesign(detail(), { onRequestRuntime });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/workflows/flow-1/ops',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const opsCalls = fetch.mock.calls.filter((c) => String(c[0]).endsWith('/ops'));
    expect(opsCalls).toHaveLength(1);
    expect(JSON.parse(String((opsCalls[0]![1] as RequestInit).body))).toEqual({
      op: 'setStatus',
      args: ['on'],
    });
    await waitFor(() => {
      expect(onRequestRuntime).toHaveBeenCalledTimes(1);
    });
  });

  test('a refused turn-on toasts the server error and stays in design', async () => {
    const onRequestRuntime = vi.fn();
    const initial = detail();
    renderDesign(initial, {
      onRequestRuntime,
      fetchHandler: (url, init) => {
        if (url === '/api/workflows/flow-1') return initial;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          return { ok: false, error: 'Cannot turn on yet: "Pick out the details": bad.' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(
      await screen.findByText('Cannot turn on yet: "Pick out the details": bad.'),
    ).toBeDefined();
    expect(onRequestRuntime).not.toHaveBeenCalled();
  });
});

describe('DesignView palette', () => {
  test('the palette groups catalog steps with plain names and descriptions', async () => {
    renderDesign(detail());
    for (const group of ['When…', 'Get…', 'Work out…', 'Save…', 'Do…']) {
      expect(await screen.findByText(group)).toBeDefined();
    }
    // Each entry shows the catalog description, not the type id.
    expect(screen.getByText('Reads details out of text.')).toBeDefined();
    expect(screen.queryByText('ai.extract')).toBeNull();
  });

  test('clicking a palette step adds it after the selected step and opens its settings', async () => {
    const initial = detail();
    const added = step('extract-1', 'Extract details');
    const afterAdd: WorkflowDetail = {
      ...initial,
      steps: [...initial.steps, added],
      edges: [...initial.edges, { from: 's1', to: 'extract-1' }],
    };
    // Stateful like the server: the post-op refetch must see the new step.
    let current = initial;
    const { fetch } = renderDesign(initial, {
      entry: '/reducers/flow-1?step=s1',
      fetchHandler: (url, init) => {
        if (url === '/api/workflows/flow-1') return current;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          current = afterAdd;
          return { ok: true, workflow: afterAdd, note: 'Added step "Extract details".' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Extract details' }));
    await waitFor(() => {
      expect(fetch.mock.calls.some((c) => String(c[0]).endsWith('/ops'))).toBe(true);
    });
    const opsCall = fetch.mock.calls.find((c) => String(c[0]).endsWith('/ops'))!;
    expect(JSON.parse(String((opsCall[1] as RequestInit).body))).toEqual({
      op: 'addStep',
      args: [
        {
          type: 'ai.extract',
          title: 'Extract details',
          summary: 'Reads details out of text.',
          config: {},
          inputs: {},
          after: 's1',
        },
      ],
    });
    // The new step is selected: its settings open.
    expect(await screen.findByRole('heading', { name: 'Settings for Extract details' })).toBeDefined();
  });
});

describe('DesignView try it', () => {
  test('"Try it" shows the story strip and each box explains itself', async () => {
    const initial = detail();
    const testResponse = {
      run: {
        id: 'run-test-1',
        workflowId: 'flow-1',
        workflowVersion: 1,
        triggerPayload: {},
        status: 'done',
        kind: 'test',
        usedSample: true,
        startedAt: '2026-10-29T10:42:00.000Z',
      },
      steps: [
        { id: 'sr-1', runId: 'run-test-1', stepId: 'trigger', status: 'done', why: 'Started manually.', startedAt: '2026-10-29T10:42:00.000Z' },
        { id: 'sr-2', runId: 'run-test-1', stepId: 's1', status: 'done', why: 'I read the details out of the email.', startedAt: '2026-10-29T10:42:00.000Z' },
      ],
      usedSample: true,
      story: [
        'Tested with a sample email because none was open in Gmail.',
        'Runs when you start it by hand. → I read the details out of the email.',
      ],
    };
    renderDesign(initial, {
      fetchHandler: (url, init) => {
        if (url === '/api/workflows/flow-1') return initial;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          return { ok: true, workflow: initial, note: 'Done.' };
        }
        if (url === '/api/workflows/flow-1/test' && init?.method === 'POST') return testResponse;
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Try it' }));
    // The story strip…
    expect(
      await screen.findByText('Tested with a sample email because none was open in Gmail.'),
    ).toBeDefined();
    // …and the per-box why under the title.
    expect(screen.getByText('I read the details out of the email.')).toBeDefined();
  });
});

import type { StepInstance, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { Toaster, toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PENDING_BUILT_TIMEOUT_MS, type WorkflowDetail } from '../api.ts';
import type { UseAgentResult } from '../agent/useAgent.ts';
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

function makeAgent(overrides?: Partial<UseAgentResult>): UseAgentResult {
  return {
    transcript: [],
    busy: false,
    sendError: null,
    historyPending: false,
    historyError: false,
    send: vi.fn(async () => {}),
    ...overrides,
  };
}

function LocationProbe({ onLocation }: { onLocation: (pathname: string) => void }) {
  const location = useLocation();
  onLocation(location.pathname);
  return null;
}

function renderDesign(
  initialDetail: WorkflowDetail,
  opts?: {
    entry?: string;
      onBuilt?: (info: { stepId: string; title: string }) => void;
    fetchHandler?: (url: string, init?: RequestInit) => unknown;
    agent?: UseAgentResult;
    logActivity?: (text: string) => void;
    onLocation?: (pathname: string) => void;
  },
) {
  const fetch = mockFetch(
    opts?.fetchHandler ??
      ((url, init) => {
        if (url === '/api/workflows/flow-1' && init?.method === 'DELETE') return { deleted: true };
        if (url === '/api/workflows/flow-1') return initialDetail;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          return { ok: true, workflow: initialDetail, note: 'Done.' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const agent = opts?.agent ?? makeAgent();
  const logActivity = opts?.logActivity ?? (() => {});
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts?.entry ?? '/reducers/flow-1']}>
        <Toaster />
        <DesignView
          workflowId="flow-1"
          agent={agent}
          logActivity={logActivity}
          onBuilt={opts?.onBuilt}
        />
        {opts?.onLocation && <LocationProbe onLocation={opts.onLocation} />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, fetch, client, agent, logActivity };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  // Sonner's toast store is module-global: a previous test's still-alive
  // toast would re-render in the next test's fresh Toaster.
  toast.dismiss();
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

describe('DesignView built failure', () => {
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
  const LOAD_ERROR =
    "Couldn't load the new step. Check your connection — the agent's work is saved.";

  function withSave1(): WorkflowDetail {
    return detail([step('s1', 'Pick out the details'), step('save-1', 'Save the customer')]);
  }

  test('a built whose refetch fails toasts, then still matches when the step lands late', async () => {
    const onBuilt = vi.fn();
    const initial = detail([step('s1', 'Pick out the details')]);
    let current = initial;
    let failDetail = false;
    const { container, client } = renderDesign(initial, {
      onBuilt,
      fetchHandler: (url, init) => {
        if (url === '/api/workflows/flow-1') {
          if (failDetail) throw new Error('offline');
          return current;
        }
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          return { ok: true, workflow: current, note: 'Done.' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    await screen.findByText('Pick out the details');
    act(() => emitAgent('flow-1', PLAN));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(3);
    });

    // The agent built the step server-side, but the refetch fails (offline):
    // a plain-words error surfaces instead of stranding the ghost silently.
    failDetail = true;
    act(() => emitAgent('flow-1', { type: 'built', stepId: 'save-1' }));
    expect(await screen.findByText(LOAD_ERROR)).toBeDefined();

    // Back online with the step present: it still swaps its ghost in.
    failDetail = false;
    current = withSave1();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['workflow', 'flow-1'] });
    });
    await waitFor(() => {
      expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(2);
    });
    expect(onBuilt).toHaveBeenCalledWith({ stepId: 'save-1', title: 'Save the customer' });
  });

  test('a built that never lands toasts after the timeout, then still matches late', async () => {
    const onBuilt = vi.fn();
    const initial = detail([step('s1', 'Pick out the details')]);
    let current = initial;
    const { container, client } = renderDesign(initial, {
      onBuilt,
      fetchHandler: (url, init) => {
        // A silently-hung read: succeeds but the step never appears.
        if (url === '/api/workflows/flow-1') return current;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          return { ok: true, workflow: current, note: 'Done.' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    await screen.findByText('Pick out the details');
    act(() => emitAgent('flow-1', PLAN));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(3);
    });

    try {
      vi.useFakeTimers();
      act(() => emitAgent('flow-1', { type: 'built', stepId: 'save-1' }));
      await act(async () => {
        vi.advanceTimersByTime(PENDING_BUILT_TIMEOUT_MS - 1);
      });
      expect(screen.queryByText(LOAD_ERROR)).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      // Sonner paints toasts behind a setTimeout(0); flush it without
      // reaching the toast's 4s auto-dismiss.
      await act(async () => {
        vi.advanceTimersByTime(10);
      });
      expect(screen.getByText(LOAD_ERROR)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }

    // The step lands on a later refetch: its ghost still matches.
    current = withSave1();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['workflow', 'flow-1'] });
    });
    await waitFor(() => {
      expect(container.querySelectorAll('[data-ghost="true"]')).toHaveLength(2);
    });
    expect(onBuilt).toHaveBeenCalledWith({ stepId: 'save-1', title: 'Save the customer' });
  });
});

describe('DesignView problems and turn on', () => {
  test('two problems replace "Publish" with "2 things to fix before publishing"', async () => {
    renderDesign(
      detail([step('s1', 'Pick out the details'), step('s2', 'Write the reply')], [
        { stepId: 's1', problem: "This step isn't set up yet: instructions is missing." },
        { stepId: 's2', problem: 'Nothing leads to this step yet.' },
      ]),
    );
    expect(await screen.findByText('2 things to fix before publishing')).toBeDefined();
    expect(screen.queryByRole('switch', { name: 'Published' })).toBeNull();
    // Each troubled box shows its problem in an amber badge.
    expect(screen.getByText("This step isn't set up yet: instructions is missing.")).toBeDefined();
    expect(screen.getByText('Nothing leads to this step yet.')).toBeDefined();
  });

  test('one problem reads "1 thing to fix before publishing"', async () => {
    renderDesign(detail([step('s1', 'Pick out the details')], [
      { stepId: 's1', problem: 'Nothing leads to this step yet.' },
    ]));
    expect(await screen.findByText('1 thing to fix before publishing')).toBeDefined();
  });

  test('"Publish" calls setStatus(on) and stays on the canvas', async () => {
    const { fetch } = renderDesign(detail());
    fireEvent.click(await screen.findByRole('switch', { name: 'Published' }));
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
    expect(await screen.findByText('Published. It now runs on its own.')).toBeDefined();
    expect(screen.getByText('Pick out the details')).toBeDefined();
  });

  test('a refused publish toasts the server error', async () => {
    const initial = detail();
    renderDesign(initial, {
      fetchHandler: (url, init) => {
        if (url === '/api/workflows/flow-1') return initial;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          return { ok: false, error: 'Cannot turn on yet: "Pick out the details": bad.' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    fireEvent.click(await screen.findByRole('switch', { name: 'Published' }));
    expect(
      await screen.findByText('Cannot turn on yet: "Pick out the details": bad.'),
    ).toBeDefined();
    expect(screen.queryByText('Published. It now runs on its own.')).toBeNull();
  });
});

describe('DesignView node chat', () => {
  // NOTE: ReactFlow leaves unmeasured nodes visibility:hidden in jsdom,
  // which wipes computed accessible names inside the canvas (aria-labels
  // read back as ""). Role+name queries cannot work there, so in-canvas
  // UI is matched by stable attribute/text instead: toolbar buttons by
  // aria-label attribute, the chat box by placeholder, options by title
  // text scoped to the listbox. In a real browser the nodes are measured
  // (hover reveals the toolbar) and the names compute normally.
  const openChat = async (stepTitle: string) => {
    await screen.findByText(stepTitle);
    const add = document.querySelector(`[aria-label="Add a step after ${stepTitle}"]`);
    if (!add) throw new Error(`add-after button for ${stepTitle} missing`);
    fireEvent.click(add);
    return screen.findByPlaceholderText('Name a step type, or just describe it…');
  };

  const clickOption = async (title: string) => {
    // The option title can also name a canvas node, so scope the text to
    // the chat dropdown (the listbox needs no name filter, so a role
    // query still works for it).
    const listbox = await screen.findByRole('listbox', { hidden: true });
    const option = within(listbox).getByText(title).closest('[role="option"]');
    if (!option) throw new Error(`option for ${title} missing`);
    fireEvent.click(option);
  };

  test('the dropdown groups catalog steps with plain names and descriptions', async () => {
    renderDesign(detail());
    const box = await openChat('Pick out the details');
    fireEvent.change(box, { target: { value: 'a' } });
    for (const group of ['When…', 'Get…', 'Work out…', 'Save…', 'Do…']) {
      expect(await screen.findByText(group)).toBeDefined();
    }
    // Each entry shows the catalog description, not the type id.
    fireEvent.change(box, { target: { value: 'extract' } });
    expect(await screen.findByText('Reads details out of text.')).toBeDefined();
    expect(screen.queryByText('ai.extract')).toBeNull();
  });

  test('picking a type adds it after the anchor step and opens its settings', async () => {
    const initial = detail();
    const added = step('extract-1', 'Extract details');
    const afterAdd: WorkflowDetail = {
      ...initial,
      steps: [...initial.steps, added],
      edges: [...initial.edges, { from: 's1', to: 'extract-1' }],
    };
    // Stateful like the server: the post-op refetch must see the new step.
    let current = initial;
    const logActivity = vi.fn();
    const { fetch } = renderDesign(initial, {
      logActivity,
      fetchHandler: (url, init) => {
        if (url === '/api/workflows/flow-1') return current;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          current = afterAdd;
          return { ok: true, workflow: afterAdd, note: 'Added step "Extract details".' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    const box = await openChat('Pick out the details');
    fireEvent.change(box, { target: { value: 'extract' } });
    await clickOption('Extract details');
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
    // The new step is selected: its settings open. The mini history and the
    // RHS log both record the add.
    expect(await screen.findByTestId('design-inspector')).toBeDefined();
    expect(await screen.findByText('Added "Extract details".')).toBeDefined();
    expect(logActivity).toHaveBeenCalledWith('Added "Extract details".');
  });

  test('picking an existing step adds a copy after the anchor step', async () => {
    const s2 = step('s2', 'Write the reply');
    const initial = detail([step('s1', 'Pick out the details'), s2]);
    // Stateful like the server: the post-op refetch must see the new step.
    let current = initial;
    const { fetch } = renderDesign(initial, {
      fetchHandler: (url, init) => {
        if (url === '/api/workflows/flow-1') return current;
        if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
          const copy = step('s3', 'Write the reply');
          current = { ...current, steps: [...current.steps, copy] };
          return { ok: true, workflow: current, note: 'Added step "Write the reply".' };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    const box = await openChat('Pick out the details');
    fireEvent.change(box, { target: { value: 'reply' } });
    expect(await screen.findByText('In this automation')).toBeDefined();
    await clickOption('Write the reply');
    await waitFor(() => {
      expect(fetch.mock.calls.some((c) => String(c[0]).endsWith('/ops'))).toBe(true);
    });
    const opsCall = fetch.mock.calls.find((c) => String(c[0]).endsWith('/ops'))!;
    expect(JSON.parse(String((opsCall[1] as RequestInit).body))).toEqual({
      op: 'addStep',
      args: [
        {
          type: 'ai.extract',
          title: 'Write the reply',
          summary: 'Write the reply.',
          config: { instructions: 'Read it.', fields: [] },
          inputs: {},
          after: 's1',
        },
      ],
    });
    expect(await screen.findByText('Added a copy of "Write the reply".')).toBeDefined();
  });

  test('picking a "When" step swaps the trigger', async () => {
    const { fetch } = renderDesign(detail());
    const box = await openChat('Manual trigger');
    fireEvent.change(box, { target: { value: 'gmail button' } });
    await clickOption('Gmail button');
    await waitFor(() => {
      expect(fetch.mock.calls.some((c) => String(c[0]).endsWith('/ops'))).toBe(true);
    });
    const opsCall = fetch.mock.calls.find((c) => String(c[0]).endsWith('/ops'))!;
    expect(JSON.parse(String((opsCall[1] as RequestInit).body))).toEqual({
      op: 'setTrigger',
      args: [{ type: 'trigger.gmailButton', config: {} }],
    });
  });

  test('free text goes to the agent with node context and logs the touch', async () => {
    const agent = makeAgent();
    const logActivity = vi.fn();
    renderDesign(detail(), { agent, logActivity });
    const box = await openChat('Pick out the details');
    fireEvent.change(box, { target: { value: 'zzz-no-such-step' } });
    expect(screen.queryByRole('listbox', { hidden: true })).toBeNull();
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => {
      expect(agent.send).toHaveBeenCalledWith(
        'About the "Pick out the details" step: zzz-no-such-step',
      );
    });
    expect(await screen.findByText('Sent — follow along in the chat.')).toBeDefined();
    expect(logActivity).toHaveBeenCalledWith('Asked about "Pick out the details".');
  });
});

describe('DesignView start', () => {
  test('a step-free workflow opens on the Start chat box, not the canvas', async () => {
    renderDesign(detail([]));
    expect(
      await screen.findByRole('heading', { name: 'What should this automation do?' }),
    ).toBeDefined();
    expect(
      screen.getByRole('textbox', { name: 'Describe the automation' }),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try it' })).toBeNull();
  });

  test('a conversation started elsewhere hides Start so the plan can draw', async () => {
    renderDesign(detail([]), {
      agent: makeAgent({ transcript: [{ kind: 'dad', text: 'Log my jobs', at: 1 }] }),
    });
    await screen.findByTestId('design-titlebar');
    expect(screen.queryByRole('heading', { name: 'What should this automation do?' })).toBeNull();
  });

  test('a suggestion chip fills the Start box without submitting', async () => {
    const agent = makeAgent();
    renderDesign(detail([]), { agent });
    fireEvent.click(await screen.findByRole('button', { name: 'Keep track of bookings' }));
    expect(
      (screen.getByRole('textbox', { name: 'Describe the automation' }) as HTMLTextAreaElement).value,
    ).toBe('Keep track of bookings');
    expect(agent.send).not.toHaveBeenCalled();
  });

  test('submitting the Start box sends the first turn and opens the workspace', async () => {
    const agent = makeAgent();
    renderDesign(detail([]), { agent });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Describe the automation' }), {
      target: { value: 'Sort my inbox' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Build it' }));
    await waitFor(() => {
      expect(agent.send).toHaveBeenCalledWith('Sort my inbox');
    });
    // The Start box is gone; the workspace top bar fades in.
    expect(await screen.findByRole('button', { name: 'Try it' })).toBeDefined();
    expect(screen.queryByRole('textbox', { name: 'Describe the automation' })).toBeNull();
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

describe('DesignView canvas', () => {
  test('the canvas container fills its parent (definite height via the h-full chain)', async () => {
    // ReactFlow sizes itself to 100% of its parent: a min-height-only
    // container collapses it to 0px (an invisible canvas no layout-blind
    // jsdom test can see). The chain is AppShell content → WorkflowPage →
    // DesignView root → this wrapper; pin this link here.
    renderDesign(detail());
    await screen.findByText('Pick out the details');
    const container = document.querySelector('.react-flow')?.parentElement;
    expect(container?.className).toContain('h-full');
    expect(container?.className).toContain('w-full');
  });
});

const openMore = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /^More/ }));
};

describe('DesignView title bar', () => {
  test('the bar holds the mode switch, Try it and Published; the rest is in the ⋯ menu', async () => {
    renderDesign(detail());
    await screen.findByText('Pick out the details');
    const bar = screen.getByTestId('design-titlebar');
    expect(within(bar).getByRole('button', { name: 'Design' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(bar).getByRole('button', { name: /^Runs/ })).toBeDefined();
    expect(within(bar).getByRole('button', { name: 'Try it' })).toBeDefined();
    expect(within(bar).getByRole('switch', { name: 'Published' })).toBeDefined();
    // Delete is never out in the bar.
    expect(within(bar).queryByRole('button', { name: 'Delete' })).toBeNull();
    openMore();
    for (const name of ['Rename', 'Copy name and id', 'Delete']) {
      expect(within(bar).getByRole('menuitem', { name })).toBeDefined();
    }
  });

  test('Rename sends the rename op', async () => {
    const { fetch } = renderDesign(detail());
    await screen.findByText('Pick out the details');
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Automation name' });
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      const ops = fetch.mock.calls.filter((c) => String(c[0]).endsWith('/ops'));
      expect(JSON.parse(String((ops[0]![1] as RequestInit).body))).toEqual({
        op: 'rename',
        args: [{ name: 'New name' }],
      });
    });
  });

  test('copy button copies name and id, then toasts', async () => {
    const writeText = vi.fn(async () => {});
    const orig = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    try {
      renderDesign(detail());
      await screen.findByText('Pick out the details');
      openMore();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy name and id' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('Test flow (flow-1)'));
      expect(await screen.findByText('Copied name and id.')).toBeDefined();
    } finally {
      if (orig) Object.defineProperty(globalThis.navigator, 'clipboard', orig);
      else Reflect.deleteProperty(globalThis.navigator, 'clipboard');
    }
  });
});

describe('DesignView inspector', () => {
  test('a selected node shows its settings in the overlay panel', async () => {
    renderDesign(detail(), { entry: '/reducers/flow-1?mode=design&step=s1' });
    const panel = await screen.findByTestId('design-inspector');
    expect(within(panel).getByText('Pick out the details')).toBeDefined();
  });

  test('Close dismisses the inspector', async () => {
    renderDesign(detail(), { entry: '/reducers/flow-1?mode=design&step=s1' });
    const panel = await screen.findByTestId('design-inspector');
    fireEvent.click(panel.querySelector('[aria-label="Close"]')!);
    await waitFor(() => expect(screen.queryByTestId('design-inspector')).toBeNull());
  });
});

describe('DesignView delete', () => {
  test('delete arms, confirms DELETEs, and lands on Automate', async () => {
    let pathname = '';
    const { fetch } = renderDesign(detail(), {
      onLocation: (p) => {
        pathname = p;
      },
    });
    await screen.findByText('Pick out the details');
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    // The first press only arms it: nothing is deleted yet.
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/workflows/flow-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Yes, delete' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/workflows/flow-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    await waitFor(() => expect(pathname).toBe('/automate'));
  });
});

describe('DesignView start title bar', () => {
  test('start screen offers rename, copy, and delete but no Try it', async () => {
    renderDesign(detail([]));
    await screen.findByRole('heading', { name: 'What should this automation do?' });
    const bar = screen.getByTestId('design-titlebar');
    expect(within(bar).queryByRole('button', { name: 'Try it' })).toBeNull();
    openMore();
    expect(within(bar).getByRole('menuitem', { name: 'Rename' })).toBeDefined();
    expect(within(bar).getByRole('menuitem', { name: 'Copy name and id' })).toBeDefined();
    expect(within(bar).getByRole('menuitem', { name: 'Delete' })).toBeDefined();
  });
});

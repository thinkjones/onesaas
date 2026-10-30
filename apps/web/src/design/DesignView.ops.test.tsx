import type { StepInstance, Workflow } from '@dad/shared';
import type { ReactFlowProps } from '@xyflow/react';
import { ReactFlow } from '@xyflow/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WorkflowDetail } from '../api.ts';
import DesignView from './DesignView.tsx';

// Capture the props DesignView passes through to ReactFlow so tests can drive
// canvas changes directly (no drag simulation needed).
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return { ...actual, ReactFlow: vi.fn(() => null) };
});

const ReactFlowMock = ReactFlow as unknown as ReturnType<typeof vi.fn>;

function lastFlowProps(): ReactFlowProps {
  const calls = ReactFlowMock.mock.calls;
  return calls[calls.length - 1]![0] as ReactFlowProps;
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

function step(id: string, title: string): StepInstance {
  return {
    id,
    type: 'ai.extract',
    title,
    summary: `${title}.`,
    config: { instructions: 'Read it.', fields: [] },
    inputs: { text: '{{trigger}}' },
    position: { x: 500, y: 100 },
  };
}

function detail(): WorkflowDetail {
  const wf: Workflow = {
    id: 'flow-1',
    name: 'Test flow',
    description: 'Test flow.',
    version: 1,
    status: 'draft',
    trigger: TRIGGER,
    steps: [step('s1', 'Pick out the details'), step('s2', 'Write the reply')],
    edges: [
      { from: 'trigger', to: 's1' },
      { from: 's1', to: 's2' },
    ],
  };
  return { ...wf, problems: [] };
}

type OpCall = { op: string; args: unknown[] };

function opsCalls(fetch: ReturnType<typeof vi.fn>): OpCall[] {
  return fetch.mock.calls
    .filter((c) => String(c[0]).endsWith('/ops'))
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as OpCall);
}

/**
 * A tiny evolving fake of the ops route: removeStep/addStep/connect/move
 * apply to a local workflow copy so Undo's reconnect/move sequence resolves
 * against changing state, like the real server.
 */
function renderOps(entry = '/reducers/flow-1') {
  let current = detail();
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = async () => {
      if (url === '/api/workflows/flow-1') return current;
      if (url === '/api/workflows/flow-1/ops' && init?.method === 'POST') {
        const { op, args } = JSON.parse(String(init.body)) as OpCall;
        if (op === 'removeStep') {
          const [stepId] = args as [string];
          current = {
            ...current,
            steps: current.steps.filter((s) => s.id !== stepId),
            edges: current.edges.filter((e) => e.from !== stepId && e.to !== stepId),
          };
        } else if (op === 'addStep') {
          const [o] = args as [
            { type: string; title: string; summary: string; config: Record<string, unknown>; inputs: Record<string, string>; after?: string },
          ];
          const id = 'pick-out-the-details-undo1';
          current = {
            ...current,
            steps: [
              ...current.steps,
              { id, type: o.type, title: o.title, summary: o.summary, config: o.config, inputs: o.inputs, position: { x: 0, y: 0 } },
            ],
            edges: o.after ? [...current.edges, { from: o.after, to: id }] : current.edges,
          };
        } else if (op === 'connect') {
          const [o] = args as [{ from: string; to: string; when?: string }];
          current = { ...current, edges: [...current.edges, { ...o }] };
        } else if (op === 'move') {
          const [stepId, position] = args as [string, { x: number; y: number }];
          current = {
            ...current,
            steps: current.steps.map((s) => (s.id === stepId ? { ...s, position } : s)),
          };
        }
        return { ok: true, workflow: current, note: 'Done.' };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    return { ok: true, status: 200, json } as Response;
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Toaster />
        <DesignView workflowId="flow-1" onRequestRuntime={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, fetch };
}

beforeEach(() => {
  ReactFlowMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DesignView canvas ops', () => {
  test('Backspace is the design-mode delete key', async () => {
    renderOps();
    await waitFor(() => {
      expect(ReactFlowMock.mock.calls.length).toBeGreaterThan(0);
    });
    expect(lastFlowProps().deleteKeyCode).toBe('Backspace');
  });

  test('drag sends move with the drop position', async () => {
    const { fetch } = renderOps();
    await waitFor(() => {
      expect(ReactFlowMock.mock.calls.length).toBeGreaterThan(0);
    });
    lastFlowProps().onNodesChange!([
      { id: 's1', type: 'position', position: { x: 525, y: 315 }, dragging: false },
    ]);
    await waitFor(() => {
      expect(opsCalls(fetch)).toEqual([{ op: 'move', args: ['s1', { x: 525, y: 315 }] }]);
    });
  });

  test('connecting two boxes sends connect', async () => {
    const { fetch } = renderOps();
    await waitFor(() => {
      expect(ReactFlowMock.mock.calls.length).toBeGreaterThan(0);
    });
    lastFlowProps().onConnect!({ source: 's1', target: 's2', sourceHandle: null, targetHandle: null });
    await waitFor(() => {
      expect(opsCalls(fetch)).toEqual([{ op: 'connect', args: [{ from: 's1', to: 's2' }] }]);
    });
  });

  test('deleting an edge sends disconnect', async () => {
    const { fetch } = renderOps();
    await waitFor(() => {
      expect(ReactFlowMock.mock.calls.length).toBeGreaterThan(0);
    });
    lastFlowProps().onEdgesChange!([{ id: 'trigger->s1', type: 'remove' }]);
    await waitFor(() => {
      expect(opsCalls(fetch)).toEqual([
        { op: 'disconnect', args: [{ from: 'trigger', to: 's1' }] },
      ]);
    });
  });

  test('deleting a box sends removeStep and offers Undo, which re-adds it with its edges', async () => {
    const { fetch } = renderOps();
    await waitFor(() => {
      expect(ReactFlowMock.mock.calls.length).toBeGreaterThan(0);
    });
    lastFlowProps().onNodesChange!([{ id: 's1', type: 'remove' }]);
    await waitFor(() => {
      expect(opsCalls(fetch)).toEqual([{ op: 'removeStep', args: ['s1'] }]);
    });
    expect(await screen.findByText('Deleted "Pick out the details".')).toBeDefined();

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(opsCalls(fetch)).toHaveLength(4);
    });
    const [, addStep, connect, move] = opsCalls(fetch);
    // Re-added with the exact prior state, after its surviving predecessor…
    expect(addStep).toEqual({
      op: 'addStep',
      args: [
        {
          type: 'ai.extract',
          title: 'Pick out the details',
          summary: 'Pick out the details.',
          config: { instructions: 'Read it.', fields: [] },
          inputs: { text: '{{trigger}}' },
          after: 'trigger',
        },
      ],
    });
    // …the trigger edge came back via `after`; the outgoing edge reconnects…
    expect(connect).toEqual({
      op: 'connect',
      args: [{ from: 'pick-out-the-details-undo1', to: 's2' }],
    });
    // …and the box returns to its old spot.
    expect(move).toEqual({
      op: 'move',
      args: ['pick-out-the-details-undo1', { x: 500, y: 100 }],
    });
  });

  test('the trigger cannot be deleted (no op, plain-words toast)', async () => {
    const { fetch } = renderOps();
    await waitFor(() => {
      expect(ReactFlowMock.mock.calls.length).toBeGreaterThan(0);
    });
    lastFlowProps().onNodesChange!([{ id: 'trigger', type: 'remove' }]);
    expect(await screen.findByText("The start of the reducer can't be deleted.")).toBeDefined();
    expect(opsCalls(fetch)).toEqual([]);
  });

  test('saving the settings form sends updateStep', async () => {
    const { fetch } = renderOps('/reducers/flow-1?step=s1');
    fireEvent.change(await screen.findByLabelText('Instructions'), {
      target: { value: 'Read the catering enquiry.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(opsCalls(fetch)).toEqual([
        {
          op: 'updateStep',
          args: [
            's1',
            {
              config: { instructions: 'Read the catering enquiry.', fields: [] },
              inputs: { text: '{{trigger}}' },
            },
          ],
        },
      ]);
    });
  });

  test('picking a "When" step swaps the trigger', async () => {
    const { fetch } = renderOps();
    fireEvent.click(await screen.findByRole('button', { name: 'Gmail button' }));
    await waitFor(() => {
      expect(opsCalls(fetch)).toEqual([
        { op: 'setTrigger', args: [{ type: 'trigger.gmailButton', config: {} }] },
      ]);
    });
  });
});

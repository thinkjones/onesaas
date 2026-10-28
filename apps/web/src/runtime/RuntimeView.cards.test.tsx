import type { Run, StepInstance, StepRun, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { type RunDetail } from '../api.ts';
import RuntimeView from './RuntimeView.tsx';

// The canvas is a stub that renders the node-extra slot for both steps, so
// these tests prove the Task 6 wiring: which card appears under which status,
// with the question from the workflow config and the proposal from the StepRun.
vi.mock('../canvas/WorkflowCanvas.tsx', () => ({
  default: ({ renderNodeExtra }: { renderNodeExtra?: (stepId: string) => ReactNode }) => (
    <div data-testid="canvas">
      {renderNodeExtra?.('approve')}
      {renderNodeExtra?.('draft')}
    </div>
  ),
}));

function step(id: string, config: Record<string, unknown> = {}): StepInstance {
  return {
    id,
    type: id === 'approve' ? 'approval.ask' : 'gmail.draftReply',
    title: id,
    summary: `${id} summary.`,
    config,
    inputs: {},
    position: { x: 0, y: 0 },
  };
}

function workflow(question?: string): Workflow {
  return {
    id: 'flow-1',
    name: 'Test flow',
    description: 'Test flow.',
    version: 1,
    status: 'on',
    trigger: step('trigger'),
    steps: [
      step('approve', question === undefined ? {} : { question }),
      step('draft'),
    ],
    edges: [
      { from: 'trigger', to: 'approve' },
      { from: 'approve', to: 'draft' },
    ],
  };
}

function stepRun(stepId: string, status: StepRun['status'], extra: Partial<StepRun> = {}): StepRun {
  return {
    id: `sr-${stepId}`,
    runId: 'run-1',
    stepId,
    status,
    startedAt: '2026-10-28T10:42:00.000Z',
    ...extra,
  };
}

function renderWithDetail(detail: RunDetail) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const run: Run = detail.run;
  client.setQueryData(['runs', 'flow-1'], [run]);
  client.setQueryData(['run', run.id], detail);
  // Story last-line queries for the runs list reuse the seeded detail.
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?run=run-1']}>
        <RuntimeView workflowId="flow-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function detailWith(wf: Workflow, steps: StepRun[]): RunDetail {
  return {
    run: {
      id: 'run-1',
      workflowId: 'flow-1',
      workflowVersion: 1,
      triggerPayload: {},
      status: 'waiting',
      startedAt: '2026-10-28T10:42:00.000Z',
    },
    steps,
    story: [],
    workflow: wf,
  };
}

describe('RuntimeView node cards', () => {
  test('a waiting step renders the ApprovalCard with the config question and proposal', () => {
    renderWithDetail(
      detailWith(workflow('Is this reply OK to put in Gmail?'), [
        stepRun('approve', 'waiting', { output: { proposed: { text: 'Hi Sarah!' } } }),
        stepRun('draft', 'pending'),
      ]),
    );
    expect(screen.getByText('Is this reply OK to put in Gmail?')).toBeDefined();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Hi Sarah!');
    expect(screen.getByRole('button', { name: 'Looks good' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Use my changes' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  test('a waiting step without a configured question falls back to "Is this OK to use?"', () => {
    renderWithDetail(
      detailWith(workflow(), [
        stepRun('approve', 'waiting', { output: { proposed: { text: 'Hi Sarah!' } } }),
        stepRun('draft', 'pending'),
      ]),
    );
    expect(screen.getByText('Is this OK to use?')).toBeDefined();
  });

  test('a failed step renders the FailureCard with the error', () => {
    renderWithDetail(
      detailWith(workflow('Is this reply OK to put in Gmail?'), [
        stepRun('approve', 'done', { output: { text: 'Hi Sarah!', decision: 'approved' } }),
        stepRun('draft', 'failed', { error: 'I need Gmail open in Chrome to do this.' }),
      ]),
    );
    expect(screen.getByText('I need Gmail open in Chrome to do this.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Looks good' })).toBeNull();
  });
});

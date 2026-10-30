import type { Run, StepInstance, StepRun, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RunDetail, WorkflowDetail } from '../api.ts';
import { TooltipProvider } from '../components/ui/tooltip.tsx';
import WorkflowPage from './WorkflowPage.tsx';

const TRIGGER: StepInstance = {
  id: 'trigger',
  type: 'trigger.manual',
  title: 'Manual trigger',
  summary: 'Runs when you start it by hand.',
  config: {},
  inputs: {},
  position: { x: 100, y: 100 },
};

const EXTRACT: StepInstance = {
  id: 'extract',
  type: 'ai.extract',
  title: 'Pick out the details',
  summary: 'Reads details out of text.',
  config: { instructions: 'Read it.', fields: [] },
  inputs: { text: '{{trigger}}' },
  position: { x: 500, y: 100 },
};

function workflow(): Workflow {
  return {
    id: 'flow-1',
    name: 'Test flow',
    description: 'Test flow.',
    version: 1,
    status: 'on',
    trigger: TRIGGER,
    steps: [EXTRACT],
    edges: [{ from: 'trigger', to: 'extract' }],
  };
}

const RUN: Run = {
  id: 'run-1',
  workflowId: 'flow-1',
  workflowVersion: 1,
  triggerPayload: {},
  status: 'failed',
  kind: 'live',
  usedSample: false,
  startedAt: '2026-10-29T10:42:00.000Z',
  endedAt: '2026-10-29T10:42:05.000Z',
};

function stepRun(stepId: string, status: StepRun['status'], extra?: Partial<StepRun>): StepRun {
  return {
    id: `sr-${stepId}`,
    runId: 'run-1',
    stepId,
    status,
    startedAt: '2026-10-29T10:42:00.000Z',
    ...extra,
  };
}

const RUN_DETAIL: RunDetail = {
  run: RUN,
  steps: [
    stepRun('trigger', 'done', { why: 'Started manually.' }),
    stepRun('extract', 'failed', { error: 'I could not read the email' }),
  ],
  story: ['Runs when you start it by hand.', 'Stopped at "Pick out the details": I could not read the email'],
  workflow: workflow(),
};

const DESIGN_DETAIL: WorkflowDetail = { ...workflow(), problems: [] };

function LocationProbe({ onSearch }: { onSearch: (search: string) => void }) {
  onSearch(useLocation().search);
  return null;
}

function renderPage(onAgentPrefill: (text: string) => void, onSearch: (search: string) => void) {
  const agentPosts: unknown[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = async () => {
      if (url === '/api/workflows') return [workflow()];
      if (url === '/api/runs?workflowId=flow-1') return [RUN];
      if (url === '/api/runs/run-1') return RUN_DETAIL;
      if (url === '/api/workflows/flow-1') return DESIGN_DETAIL;
      if (url === '/api/workflows/flow-1/ops') return { ok: true, workflow: DESIGN_DETAIL, note: 'ok' };
      if (url === '/api/workflows/flow-1/agent' && init?.method !== 'POST') return [];
      if (url === '/api/workflows/flow-1/agent' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as unknown;
        agentPosts.push(body);
        return {};
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    return { ok: true, status: 202, json } as Response;
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/reducers/flow-1']}>
          <LocationProbe onSearch={onSearch} />
          <Routes>
            <Route path="/reducers/:workflowId" element={<WorkflowPage onAgentPrefill={onAgentPrefill} />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { agentPosts };
}

beforeEach(() => {
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

describe('WorkflowPage fix-this-step seam', () => {
  test('"Fix this step" opens design with the step selected, settings open, and the agent input pre-filled', async () => {
    const onAgentPrefill = vi.fn();
    let search = '';
    renderPage(onAgentPrefill, (s) => {
      search = s;
    });

    // The runtime canvas shows the failed box with its Fix button. Found by
    // text, not role: jsdom has no layout, so React Flow leaves nodes
    // `visibility: hidden` (unmeasured) and role queries exclude them — a
    // test-env artifact, in a real browser the box is visible. Clicks still
    // dispatch, which is what this seam pins.
    fireEvent.click(await screen.findByText('Fix this step'));

    // Design mode, with the failed step selected…
    expect(await screen.findByRole('button', { name: 'Try it' })).toBeDefined();
    expect(
      await screen.findByRole('heading', { name: 'Settings for Pick out the details' }),
    ).toBeDefined();
    expect(search).toContain('mode=design');
    expect(search).toContain('step=extract');
    // …and the agent input pre-filled with the exact handoff string. Task 7's
    // panel consumes this from WorkflowPage's agentPrefill state.
    expect(onAgentPrefill).toHaveBeenCalledWith(
      '"Pick out the details" stopped with: I could not read the email. Can you help me fix it?',
    );
  });
});

describe('WorkflowPage helper panel', () => {
  const HANDOFF =
    '"Pick out the details" stopped with: I could not read the email. Can you help me fix it?';

  function panelInput(): HTMLElement {
    return screen.getByRole('textbox', { name: 'Message the helper' });
  }

  test('the panel shows in runtime mode and is still there in design mode', async () => {
    renderPage(() => {}, () => {});
    // Runtime mode (default): the failed run's Fix button plus the helper panel.
    expect(await screen.findByText('Fix this step')).toBeDefined();
    expect(panelInput()).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    expect(await screen.findByRole('button', { name: 'Try it' })).toBeDefined();
    expect(panelInput()).toBeDefined();
  });

  test('the panel collapses and reopens', async () => {
    renderPage(() => {}, () => {});
    expect(await screen.findByText('Fix this step')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Hide helper' }));
    expect(screen.queryByRole('textbox', { name: 'Message the helper' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show helper' }));
    expect(panelInput()).toBeDefined();
  });

  test('"Fix this step" prefill lands in the panel input, sends, and never resurrects', async () => {
    const { agentPosts } = renderPage(() => {}, () => {});
    fireEvent.click(await screen.findByText('Fix this step'));
    expect(await screen.findByRole('button', { name: 'Try it' })).toBeDefined();
    expect((panelInput() as HTMLTextAreaElement).value).toBe(HANDOFF);

    // Sending delivers the handoff text and clears the input…
    fireEvent.keyDown(panelInput(), { key: 'Enter', code: 'Enter' });
    await screen.findByText(HANDOFF);
    expect(agentPosts).toEqual([{ text: HANDOFF }]);

    // …and a collapse/reopen cycle proves the seam cleared: a stale prefill
    // would refill the remounted panel's input.
    fireEvent.click(screen.getByRole('button', { name: 'Hide helper' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show helper' }));
    expect((panelInput() as HTMLTextAreaElement).value).toBe('');
  });
});

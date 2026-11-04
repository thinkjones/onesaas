import type { Run, StepInstance, StepRun, Workflow } from '@dad/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function LocationProbe({
  onSearch,
  onState,
}: {
  onSearch: (search: string) => void;
  onState?: (state: unknown) => void;
}) {
  const location = useLocation();
  onSearch(location.search);
  onState?.(location.state);
  return null;
}

function renderPage(
  onAgentPrefill: (text: string) => void,
  onSearch: (search: string) => void,
  opts?: { agentPrompt?: string; search?: string; onState?: (state: unknown) => void },
) {
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
  const entry =
    opts?.search === undefined && opts?.agentPrompt === undefined
      ? '/reducers/flow-1'
      : {
          pathname: '/reducers/flow-1',
          search: opts?.search ?? '',
          state: opts?.agentPrompt === undefined ? undefined : { agentPrompt: opts.agentPrompt },
        };
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[entry]}>
          <LocationProbe onSearch={onSearch} onState={opts?.onState} />
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
    renderPage(
      onAgentPrefill,
      (s) => {
        search = s;
      },
      { search: '?run=run-1' },
    );

    // The overlaid run shows the failed box with its Fix button. Found by
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

describe('WorkflowPage photo drop zone', () => {
  const UPLOAD_TRIGGER: StepInstance = {
    id: 'trigger',
    type: 'trigger.upload',
    title: 'Photo upload',
    summary: 'Runs when you drop a photo.',
    config: { prompt: 'Drop the mug shot here' },
    inputs: {},
    position: { x: 100, y: 100 },
  };

  function uploadWorkflow(steps: StepInstance[] = []): Workflow {
    return {
      id: 'flow-upload',
      name: 'Photo flow',
      description: 'Photo flow.',
      version: 1,
      status: 'on',
      trigger: UPLOAD_TRIGGER,
      steps,
      edges: steps.map((s) => ({ from: 'trigger', to: s.id })),
    };
  }

  const NEW_RUN: Run = {
    id: 'run-new',
    workflowId: 'flow-upload',
    workflowVersion: 1,
    triggerPayload: { file: { fileId: 'f1', mime: 'image/jpeg' } },
    status: 'done',
    kind: 'live',
    usedSample: false,
    startedAt: '2026-10-30T10:42:00.000Z',
    endedAt: '2026-10-30T10:42:01.000Z',
  };

  function renderUploadPage(opts?: { search?: string; uploadError?: string; steps?: StepInstance[] }) {
    const uploads: unknown[] = [];
    let runs: Run[] = [];
    const steps = opts?.steps ?? [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const respond = (body: unknown, status = 200) =>
        ({
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as Response;
      if (url === '/api/workflows') return respond([uploadWorkflow(steps)]);
      if (url === '/api/workflows/flow-upload')
        return respond({ ...uploadWorkflow(steps), problems: [] });
      if (url === '/api/runs?workflowId=flow-upload') return respond(runs);
      if (url === '/api/runs/run-new')
        return respond({
          run: NEW_RUN,
          steps: [],
          story: ['Runs when you drop a photo.'],
          workflow: uploadWorkflow(steps),
        });
      if (url === '/api/workflows/flow-upload/agent' && init?.method !== 'POST') return respond([]);
      if (url === '/api/workflows/flow-upload/upload' && init?.method === 'POST') {
        uploads.push(init.body);
        if (opts?.uploadError !== undefined)
          return respond({ error: opts.uploadError }, 400);
        runs = [NEW_RUN];
        return respond({ run: NEW_RUN, file: { fileId: 'f1', mime: 'image/jpeg' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    let search = '';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[`/reducers/flow-upload${opts?.search ?? ''}`]}>
            <LocationProbe onSearch={(s) => { search = s; }} />
            <Routes>
              <Route path="/reducers/:workflowId" element={<WorkflowPage onAgentPrefill={() => {}} />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    return { uploads, search: () => search };
  }

  test('the runs panel shows the trigger prompt drop zone', async () => {
    renderUploadPage({ search: '?runs=1', steps: [EXTRACT] });
    expect(await screen.findByText('Drop the mug shot here')).toBeDefined();
  });

  test('the drop zone stays out of the way until the runs panel opens', async () => {
    // A step so design mode opens the workspace (step-free opens Start).
    renderUploadPage({ search: '?mode=design', steps: [EXTRACT] });
    expect(await screen.findByRole('button', { name: 'Try it' })).toBeDefined();
    expect(screen.queryByText('Drop the mug shot here')).toBeNull();
  });

  test('dropping a photo posts it and jumps to the new run', async () => {
    const page = renderUploadPage({ search: '?runs=1', steps: [EXTRACT] });
    const zone = await screen.findByText('Drop the mug shot here');
    const file = new File(['fake-image-bytes'], 'mug.jpg', { type: 'image/jpeg' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await waitFor(() => {
      expect(page.search()).toContain('run=run-new');
    });
    expect(page.uploads).toHaveLength(1);
    expect(page.uploads[0]).toBeInstanceOf(FormData);
  });

  test('a rejected photo shows the server message', async () => {
    renderUploadPage({
      search: '?runs=1',
      steps: [EXTRACT],
      uploadError: "That doesn't look like a photo.",
    });
    const zone = await screen.findByText('Drop the mug shot here');
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })] },
    });
    expect((await screen.findByRole('alert')).textContent).toBe("That doesn't look like a photo.");
  });
});

describe('WorkflowPage chat panel', () => {
  const HANDOFF =
    '"Pick out the details" stopped with: I could not read the email. Can you help me fix it?';

  function panelInput(): HTMLElement {
    return screen.getByRole('textbox', { name: 'Chat message' });
  }

  test('the panel shows in design mode', async () => {
    renderPage(() => {}, () => {}, { search: '?mode=design' });
    expect(await screen.findByRole('button', { name: 'Try it' })).toBeDefined();
    expect(panelInput()).toBeDefined();
  });

  test('the panel collapses and reopens', async () => {
    renderPage(() => {}, () => {});
    expect(await screen.findByRole('button', { name: 'Try it' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Hide chat' }));
    expect(screen.queryByRole('textbox', { name: 'Chat message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show chat' }));
    expect(panelInput()).toBeDefined();
  });

  test('"Fix this step" prefill lands in the panel input, sends, and never resurrects', async () => {
    const { agentPosts } = renderPage(() => {}, () => {}, { search: '?run=run-1' });
    fireEvent.click(await screen.findByText('Fix this step'));
    expect(await screen.findByRole('button', { name: 'Try it' })).toBeDefined();
    expect((panelInput() as HTMLTextAreaElement).value).toBe(HANDOFF);

    // Sending delivers the handoff text and clears the input…
    fireEvent.keyDown(panelInput(), { key: 'Enter', code: 'Enter' });
    await screen.findByText(HANDOFF);
    expect(agentPosts).toEqual([{ text: HANDOFF }]);

    // …and a collapse/reopen cycle proves the seam cleared: a stale prefill
    // would refill the remounted panel's input.
    fireEvent.click(screen.getByRole('button', { name: 'Hide chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show chat' }));
    expect((panelInput() as HTMLTextAreaElement).value).toBe('');
  });

  test('an opening prompt sends once: collapse/reopen never resends and the history entry is consumed', async () => {
    let locationState: unknown;
    // Design mode, like the real HomePage start: nothing else here navigates
    // on mount (runtime mode's ?run= pinning would also wipe state as a side
    // effect), so the replaced entry below is exactly this fix's doing.
    const { agentPosts } = renderPage(() => {}, () => {}, {
      agentPrompt: 'Build me a saver',
      search: '?mode=design',
      onState: (s) => {
        locationState = s;
      },
    });
    expect(locationState).toEqual({ agentPrompt: 'Build me a saver' });

    // The opening prompt sends on mount…
    await screen.findByText('Build me a saver');
    expect(agentPosts).toEqual([{ text: 'Build me a saver' }]);

    // …the history entry is replaced without the prompt (refresh/back-nav safe)…
    await waitFor(() => {
      expect(locationState).toEqual({});
    });

    // …and collapse/reopen sends nothing more.
    fireEvent.click(screen.getByRole('button', { name: 'Hide chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show chat' }));
    expect(panelInput()).toBeDefined();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(agentPosts).toHaveLength(1);
  });
});

describe('WorkflowPage agent switch seam', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onmessage: ((msg: { data: string }) => void) | null = null;
    close() {}
    constructor() {
      FakeEventSource.instances.push(this);
    }
  }

  function photoWorkflow(): Workflow {
    return {
      id: 'wf-photo',
      name: 'Photo posts',
      description: 'Turns product photos into posts.',
      version: 1,
      status: 'off',
      trigger: {
        id: 'trigger',
        type: 'trigger.upload',
        title: 'Photo upload',
        summary: 'Runs when you drop a photo.',
        config: { prompt: 'Drop a product photo here' },
        inputs: {},
        position: { x: 100, y: 100 },
      },
      steps: [],
      edges: [],
    };
  }

  function PathProbe({ onPath }: { onPath: (path: string) => void }) {
    const location = useLocation();
    onPath(`${location.pathname}${location.search}`);
    return null;
  }

  function emitAgentEvent(workflowId: string, event: unknown) {
    const data = JSON.stringify({ type: 'agent', workflowId, event });
    for (const inst of FakeEventSource.instances) inst.onmessage?.({ data });
  }

  test('a switched event navigates to the new reducer in design mode', async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    // The server only lists the new reducer AFTER the switch: resolving the
    // new page proves the handler invalidated the workflows list first.
    let listed: Workflow[] = [workflow()];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const json = async () => {
          if (url === '/api/workflows') return listed;
          if (url === '/api/runs?workflowId=flow-1') return [RUN];
          if (url === '/api/runs/run-1') return RUN_DETAIL;
          if (url === '/api/workflows/flow-1') return DESIGN_DETAIL;
          if (url === '/api/workflows/flow-1/agent') return [];
          if (url === '/api/workflows/wf-photo') return { ...photoWorkflow(), problems: [] };
          if (url === '/api/workflows/wf-photo/agent') return [];
          throw new Error(`unexpected fetch: ${url}`);
        };
        return { ok: true, status: 200, json } as Response;
      }),
    );
    let path = '';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <MemoryRouter initialEntries={['/reducers/flow-1']}>
            <PathProbe onPath={(p) => { path = p; }} />
            <Routes>
              <Route path="/reducers/:workflowId" element={<WorkflowPage />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Try it' });
    expect(path.startsWith('/reducers/flow-1')).toBe(true);

    listed = [workflow(), photoWorkflow()];
    await act(async () => {
      emitAgentEvent('flow-1', { type: 'switched', workflowId: 'wf-photo' });
    });
    await waitFor(() => expect(path).toBe('/reducers/wf-photo?mode=design'));
  });
});

test('workflow page root is full height for the design workspace', async () => {
  renderPage(
    () => {},
    () => {},
    { search: '?mode=design' },
  );
  const root = await screen.findByTestId('workflow-root');
  expect(root.className).toContain('h-full');
});

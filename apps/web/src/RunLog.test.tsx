import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RunLog from './RunLog.tsx';

const workflows = [
  {
    id: 'flow-1',
    name: 'Save as lead & reply',
    trigger: { id: 'trigger', title: 'Gmail button' },
    steps: [
      { id: 'extract', title: 'Extract details' },
      { id: 'draft', title: 'Draft reply' },
    ],
  },
];

const runs = [
  {
    id: 'run-1',
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'failed',
    startedAt: '2026-10-28T00:00:00.000Z',
  },
];

const runDetail = {
  run: runs[0],
  steps: [
    {
      id: 'sr-1',
      runId: 'run-1',
      stepId: 'extract',
      status: 'done',
      why: "Found Sarah's name and email.",
      model: 'meta-llama/test',
      costUsd: 0.0042,
      input: { email: 'sarah@example.com' },
      output: { name: 'Sarah Lee' },
      startedAt: '2026-10-28T00:00:00.000Z',
    },
    {
      id: 'sr-2',
      runId: 'run-1',
      stepId: 'draft',
      status: 'failed',
      error: 'I need Gmail open in Chrome to do this.',
      input: { to: 'sarah@example.com' },
      startedAt: '2026-10-28T00:00:01.000Z',
    },
  ],
};

function mockFetch(handler: (url: string) => unknown) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    return { ok: true, json: async () => handler(url) } as Response;
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    mockFetch((url) => {
      if (url === '/api/workflows') return workflows;
      if (url === '/api/runs') return runs;
      if (url === '/api/runs/run-1') return runDetail;
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('expanded run shows step why/error and failed data-status', async () => {
  render(<RunLog />);
  fireEvent.click(await screen.findByText('run-1'));
  expect(await screen.findByText("Found Sarah's name and email.")).toBeDefined();
  expect(await screen.findByText('I need Gmail open in Chrome to do this.')).toBeDefined();
  const failed = await screen.findByText('I need Gmail open in Chrome to do this.');
  expect(failed.closest('[data-status]')?.getAttribute('data-status')).toBe('failed');
});

// Mock EventSource capturing instances so tests can emit fake server events.
class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

test('step event for the open run refetches its detail', async () => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  render(<RunLog />);
  fireEvent.click(await screen.findByText('run-1'));
  await screen.findByText("Found Sarah's name and email.");
  const callsBefore = fetchMock.mock.calls.filter(([u]) => u === '/api/runs/run-1').length;
  MockEventSource.instances[0]?.emit({
    type: 'step',
    stepRun: { id: 'sr-2', runId: 'run-1', stepId: 'draft', status: 'done' },
  });
  await waitFor(() => {
    const callsNow = fetchMock.mock.calls.filter(([u]) => u === '/api/runs/run-1').length;
    expect(callsNow).toBeGreaterThan(callsBefore);
  });
});

test('step event for another run is ignored', async () => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  render(<RunLog />);
  fireEvent.click(await screen.findByText('run-1'));
  await screen.findByText("Found Sarah's name and email.");
  const callsBefore = fetchMock.mock.calls.length;
  MockEventSource.instances[0]?.emit({
    type: 'step',
    stepRun: { id: 'sr-9', runId: 'run-other', stepId: 'draft', status: 'done' },
  });
  // Give any erroneous refetch a chance to fire, then assert silence.
  await new Promise((r) => setTimeout(r, 50));
  expect(fetchMock.mock.calls.length).toBe(callsBefore);
});

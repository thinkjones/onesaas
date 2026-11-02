import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  onAppFocus,
  useAgentEvents,
  useLiveEvents,
  type AgentEvent,
  type AppFocusEvent,
} from './api.ts';

vi.mock('sonner', () => ({ toast: vi.fn(), Toaster: () => null }));

// NOTE: this file is .ts (plan path), so no JSX — createElement instead.

// Minimal EventSource stand-in: instances are captured so tests can fire
// error/open/message on them directly.
class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  close = vi.fn();
  url: string;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

let client: QueryClient;

function HookHarness() {
  useLiveEvents();
  return null;
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function renderLiveEvents() {
  return render(createElement(HookHarness), { wrapper });
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.useFakeTimers();
  vi.mocked(toast).mockClear();
  client = new QueryClient();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useLiveEvents reconnect', () => {
  test('EventSource error then open invalidates every run query', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderLiveEvents();
    expect(MockEventSource.instances).toHaveLength(1);

    // The connection drops: first retry after the 1s backoff.
    await act(async () => {
      MockEventSource.instances[0]!.onerror!();
    });
    expect(MockEventSource.instances).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    // Reconnect succeeds: every ['run', *] query is refetched via prefix.
    await act(async () => {
      MockEventSource.instances[1]!.onopen!();
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['run'] });
  });

  test('reconnect backoff escalates 1s → 2s → 5s and caps at 5s', async () => {
    renderLiveEvents();
    for (const [waitMs, total] of [
      [1000, 1],
      [2000, 2],
      [5000, 3],
      [5000, 4],
    ] as const) {
      await act(async () => {
        MockEventSource.instances[total - 1]!.onerror!();
      });
      // No reconnect before the full delay elapses …
      await act(async () => {
        vi.advanceTimersByTime(waitMs - 1);
      });
      expect(MockEventSource.instances).toHaveLength(total);
      // … then exactly one fires.
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(MockEventSource.instances).toHaveLength(total + 1);
    }
  });

  test('unmount clears the pending reconnect (StrictMode double-mount safe)', async () => {
    const { unmount } = renderLiveEvents();
    await act(async () => {
      MockEventSource.instances[0]!.onerror!();
    });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(MockEventSource.instances).toHaveLength(1);
  });

  test('step events still prefix-invalidate the runs lists', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderLiveEvents();
    await act(async () => {
      MockEventSource.instances[0]!.onmessage!({
        data: JSON.stringify({
          type: 'step',
          stepRun: { runId: 'r1', stepId: 'extract', status: 'done' },
        }),
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['run', 'r1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['runs'] });
  });

  test('notify events toast the message and invalidate nothing', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderLiveEvents();
    await act(async () => {
      MockEventSource.instances[0]!.onmessage!({
        data: JSON.stringify({ type: 'notify', text: 'New customer: Priya Nair' }),
      });
    });
    expect(toast).toHaveBeenCalledWith('New customer: Priya Nair');
    expect(spy).not.toHaveBeenCalled();
  });

  test('mood events refresh the settings query so the backdrop live-updates', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderLiveEvents();
    await act(async () => {
      MockEventSource.instances[0]!.onmessage!({
        data: JSON.stringify({ type: 'mood', fileIds: ['m1', 'm2', 'm3', 'm4'] }),
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['settings'] });
  });

  test('agent envelopes on the shared stream are ignored, not crashed on', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderLiveEvents();
    await act(async () => {
      MockEventSource.instances[0]!.onmessage!({
        data: JSON.stringify({
          type: 'agent',
          workflowId: 'flow-1',
          event: { type: 'activity', text: 'Did a thing.' },
        }),
      });
    });
    expect(toast).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('useAgentEvents sharing', () => {
  function AgentHarness({ wid, onEvent }: { wid: string; onEvent: (e: AgentEvent) => void }) {
    useAgentEvents(wid, onEvent);
    return null;
  }

  const agentMsg = (workflowId: string) =>
    JSON.stringify({
      type: 'agent',
      workflowId,
      event: { type: 'activity', text: 'Did a thing.' },
    });

  test('two subscribers share one EventSource and each gets its own workflow’s events', async () => {
    const a = vi.fn();
    const b = vi.fn();
    render(createElement(AgentHarness, { wid: 'flow-1', onEvent: a }), { wrapper });
    render(createElement(AgentHarness, { wid: 'flow-2', onEvent: b }), { wrapper });
    expect(MockEventSource.instances).toHaveLength(1);
    await act(async () => {
      MockEventSource.instances[0]!.onmessage!({ data: agentMsg('flow-1') });
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    await act(async () => {
      MockEventSource.instances[0]!.onmessage!({ data: agentMsg('flow-2') });
    });
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('the shared connection closes when the last subscriber unmounts', async () => {
    const a = vi.fn();
    const first = render(createElement(AgentHarness, { wid: 'flow-1', onEvent: a }), {
      wrapper,
    });
    const second = render(createElement(AgentHarness, { wid: 'flow-1', onEvent: a }), {
      wrapper,
    });
    expect(MockEventSource.instances).toHaveLength(1);
    first.unmount();
    expect(MockEventSource.instances[0]!.close).not.toHaveBeenCalled();
    second.unmount();
    expect(MockEventSource.instances[0]!.close).toHaveBeenCalledTimes(1);
  });
});

describe('desktop focus + presence', () => {
  test('the stream is tagged ?client=tauri inside the desktop shell only', () => {
    renderLiveEvents();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe('/api/events');
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    renderLiveEvents();
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]!.url).toBe(
      'http://127.0.0.1:8787/api/events?client=tauri',
    );
  });

  test('app-focus events dispatch to subscribers; malformed ones are dropped', async () => {
    renderLiveEvents();
    const seen: AppFocusEvent[] = [];
    const off = onAppFocus((e) => seen.push(e));
    const es = MockEventSource.instances[0]!;
    await act(async () => {
      es.onmessage!({
        data: JSON.stringify({ type: 'app-focus', path: '/settings', hash: 'chrome-extension' }),
      });
    });
    expect(seen).toEqual([{ type: 'app-focus', path: '/settings', hash: 'chrome-extension' }]);
    await act(async () => {
      es.onmessage!({ data: JSON.stringify({ type: 'app-focus' }) });
      es.onmessage!({ data: JSON.stringify({ type: 'app-focus', path: 42 }) });
    });
    expect(seen).toHaveLength(1);
    off();
    await act(async () => {
      es.onmessage!({ data: JSON.stringify({ type: 'app-focus', path: '/settings' }) });
    });
    expect(seen).toHaveLength(1);
  });
});

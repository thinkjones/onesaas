import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useLiveEvents } from './api.ts';

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
});

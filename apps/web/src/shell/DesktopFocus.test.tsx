import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useLiveEvents } from '../api.ts';
import { useDesktopFocus } from './DesktopFocus.ts';

const { setFocus } = vi.hoisted(() => ({ setFocus: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setFocus }),
}));

// Minimal EventSource stand-in (mirrors api.events.test.ts).
class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {}
}

const seen: { path: string } = { path: '' };

function Harness() {
  useLiveEvents();
  useDesktopFocus();
  return null;
}

function LocationProbe() {
  const loc = useLocation();
  useEffect(() => {
    seen.path = `${loc.pathname}${loc.hash}`;
  }, [loc]);
  return null;
}

function renderHarness() {
  const client = new QueryClient();
  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={client}>
        <LocationProbe />
        <Harness />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function fireFocus(path: string, hash?: string) {
  MockEventSource.instances[0]!.onmessage!({
    data: JSON.stringify({ type: 'app-focus', path, hash }),
  });
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  seen.path = '';
  setFocus.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('inside Tauri, an app-focus event focuses the window and navigates', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const { unmount } = renderHarness();
  await act(async () => {
    fireFocus('/settings', 'chrome-extension');
  });
  await act(async () => {});
  expect(setFocus).toHaveBeenCalledTimes(1);
  expect(seen.path).toBe('/settings#chrome-extension');
  unmount();
});

test('inside Tauri, a focus without hash navigates bare', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const { unmount } = renderHarness();
  await act(async () => {
    fireFocus('/settings');
  });
  expect(seen.path).toBe('/settings');
  unmount();
});

test('in a browser, app-focus events are ignored', async () => {
  const { unmount } = renderHarness();
  await act(async () => {
    fireFocus('/settings', 'chrome-extension');
  });
  await act(async () => {});
  expect(setFocus).not.toHaveBeenCalled();
  expect(seen.path).toBe('/');
  unmount();
});

test('a setFocus failure never blocks navigation', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  setFocus.mockRejectedValueOnce(new Error('denied'));
  const { unmount } = renderHarness();
  await act(async () => {
    fireFocus('/settings');
  });
  await act(async () => {});
  expect(seen.path).toBe('/settings');
  unmount();
});

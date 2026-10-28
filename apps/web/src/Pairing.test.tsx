import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Pairing from './Pairing.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    return { ok: true, json: async () => handler(url, init) } as Response;
  });
}

test('start shows the 6-digit code', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch((url, init) => {
      if (url === '/api/pairing/start' && init?.method === 'POST') return { code: '123456' };
      if (url === '/api/pairing/status') return { paired: false, connected: false };
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const { unmount } = render(<Pairing />);
  fireEvent.click(screen.getByText('Connect Chrome'));
  expect(await screen.findByText('123456')).toBeDefined();
  unmount();
});

test('poll reaching paired shows Connected ✓', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch((url, init) => {
      if (url === '/api/pairing/start' && init?.method === 'POST') return { code: '123456' };
      if (url === '/api/pairing/status') return { paired: true, connected: true };
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  render(<Pairing />);
  fireEvent.click(screen.getByText('Connect Chrome'));
  await screen.findByText('123456');
  // Real 2s poll interval; the first poll reports paired.
  expect(await screen.findByText('Connected ✓', {}, { timeout: 5000 })).toBeDefined();
});

test('start failure shows the error inline', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'boom' }) as Response));
  render(<Pairing />);
  fireEvent.click(screen.getByText('Connect Chrome'));
  expect(await screen.findByText(/boom/)).toBeDefined();
});

test('unmount clears the poll interval', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch((url, init) => {
      if (url === '/api/pairing/start' && init?.method === 'POST') return { code: '123456' };
      if (url === '/api/pairing/status') return { paired: false, connected: false };
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const clearSpy = vi.spyOn(globalThis, 'clearInterval');
  const { unmount } = render(<Pairing />);
  fireEvent.click(screen.getByText('Connect Chrome'));
  await screen.findByText('123456');
  unmount();
  expect(clearSpy).toHaveBeenCalled();
});

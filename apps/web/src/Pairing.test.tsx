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
  fireEvent.click(await screen.findByText('Connect Chrome'));
  expect(await screen.findByText('123456')).toBeDefined();
  unmount();
});

test('poll reaching paired shows Connected ✓', async () => {
  // Mount check reports unpaired (so the button renders); the first 2s poll
  // reports paired.
  let statusCalls = 0;
  vi.stubGlobal(
    'fetch',
    mockFetch((url, init) => {
      if (url === '/api/pairing/start' && init?.method === 'POST') return { code: '123456' };
      if (url === '/api/pairing/status') {
        statusCalls += 1;
        return statusCalls === 1
          ? { paired: false, connected: false }
          : { paired: true, connected: true };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  render(<Pairing />);
  fireEvent.click(await screen.findByText('Connect Chrome'));
  await screen.findByText('123456');
  // Real 2s poll interval; the first poll reports paired.
  expect(await screen.findByText('Connected ✓', {}, { timeout: 5000 })).toBeDefined();
});

test('start failure shows the error inline', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'boom' }) as Response));
  render(<Pairing />);
  fireEvent.click(await screen.findByText('Connect Chrome'));
  expect(await screen.findByText(/boom/)).toBeDefined();
});

test('shows connected state on load when already paired, without starting pairing', async () => {
  const fetchMock = mockFetch((url) => {
    if (url === '/api/pairing/status') return { paired: true, connected: true };
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<Pairing />);
  expect(await screen.findByText('Connected ✓')).toBeDefined();
  expect(await screen.findByText(/Open a Gmail thread/)).toBeDefined();
  expect(fetchMock).not.toHaveBeenCalledWith('/api/pairing/start', expect.anything());
});

test('shows paired-but-offline state on load when Chrome is not connected', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch((url) => {
      if (url === '/api/pairing/status') return { paired: true, connected: false };
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  render(<Pairing />);
  expect(await screen.findByText(/Paired, but Chrome isn't connected/)).toBeDefined();
});

test('unpaired state explains the setup steps', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch((url) => {
      if (url === '/api/pairing/status') return { paired: false, connected: false };
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  render(<Pairing />);
  expect(await screen.findByText(/Load the extension in Chrome/)).toBeDefined();
  expect(await screen.findByText(/Click Connect Chrome below/)).toBeDefined();
  expect(await screen.findByText(/enter the code, and press Pair/)).toBeDefined();
  expect(await screen.findByText(/Save as lead & reply/)).toBeDefined();
});

test('code screen tells the user to enter it in the extension popup', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch((url, init) => {
      if (url === '/api/pairing/start' && init?.method === 'POST') return { code: '123456' };
      if (url === '/api/pairing/status') return { paired: false, connected: false };
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  render(<Pairing />);
  fireEvent.click(await screen.findByText('Connect Chrome'));
  expect(await screen.findByText('123456')).toBeDefined();
  expect(await screen.findByText(/Enter this code in the extension popup/)).toBeDefined();
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
  fireEvent.click(await screen.findByText('Connect Chrome'));
  await screen.findByText('123456');
  unmount();
  expect(clearSpy).toHaveBeenCalled();
});

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
  const { unmount } = render(<Pairing />);
  fireEvent.click(await screen.findByText('Connect Chrome'));
  await screen.findByText('123456');
  // Real 2s poll interval; the first poll reports paired.
  expect(await screen.findByText('Connected ✓', {}, { timeout: 5000 })).toBeDefined();
  unmount();
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
  const { unmount } = render(<Pairing />);
  expect(await screen.findByText('Connected ✓')).toBeDefined();
  expect(await screen.findByText(/Open a Gmail thread/)).toBeDefined();
  expect(fetchMock).not.toHaveBeenCalledWith('/api/pairing/start', expect.anything());
  unmount();
});

test('shows paired-but-offline state on load when Chrome is not connected', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch((url) => {
      if (url === '/api/pairing/status') return { paired: true, connected: false };
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const { unmount } = render(<Pairing />);
  expect(await screen.findByText(/Paired, but Chrome isn't connected/)).toBeDefined();
  unmount();
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

test('keeps polling while connected and reflects a server-side revoke', async () => {
  // Mount reports paired+connected; the next poll reports revoked.
  let statusCalls = 0;
  vi.stubGlobal(
    'fetch',
    mockFetch((url) => {
      if (url === '/api/pairing/status') {
        statusCalls += 1;
        return statusCalls === 1
          ? { paired: true, connected: true }
          : { paired: false, connected: false };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const { unmount } = render(<Pairing />);
  await screen.findByText('Connected ✓');
  // Real 2s poll interval; the second poll reports revoked.
  expect(
    await screen.findByText(/Load the extension in Chrome/, {}, { timeout: 5000 }),
  ).toBeDefined();
  unmount();
});

test('revoke after pairing clears the dead code back to the start view', async () => {
  // Mount unpaired; the first poll reports paired; later polls revoked.
  let statusCalls = 0;
  vi.stubGlobal(
    'fetch',
    mockFetch((url, init) => {
      if (url === '/api/pairing/start' && init?.method === 'POST') return { code: '123456' };
      if (url === '/api/pairing/status') {
        statusCalls += 1;
        return statusCalls === 1
          ? { paired: false, connected: false }
          : statusCalls === 2
            ? { paired: true, connected: true }
            : { paired: false, connected: false };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const { unmount } = render(<Pairing />);
  fireEvent.click(await screen.findByText('Connect Chrome'));
  await screen.findByText('123456');
  await screen.findByText('Connected ✓', {}, { timeout: 5000 });
  // Real 2s poll interval; a later poll reports revoked.
  expect(
    await screen.findByText(/Load the extension in Chrome/, {}, { timeout: 8000 }),
  ).toBeDefined();
  expect(screen.queryByText('123456')).toBeNull();
  unmount();
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

test('Unpair button revokes the pairing and returns to the start view', async () => {
  // Stranded state: the server remembers a pairing this Chrome never
  // completed (paired, but Chrome isn't connected).
  let revoked = false;
  const fetchMock = mockFetch((url, init) => {
    if (url === '/api/pairing/revoke' && init?.method === 'POST') {
      revoked = true;
      return { revoked: true };
    }
    if (url === '/api/pairing/status') {
      return revoked ? { paired: false, connected: false } : { paired: true, connected: false };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = render(<Pairing />);
  fireEvent.click(await screen.findByText('Unpair'));
  expect(await screen.findByText('Connect Chrome')).toBeDefined();
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/pairing/revoke',
    expect.objectContaining({ method: 'POST' }),
  );
  unmount();
});

test('Unpair failure shows the error inline and stays paired', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pairing/status') {
        return {
          ok: true,
          json: async () => ({ paired: true, connected: false }),
        } as Response;
      }
      if (url === '/api/pairing/revoke' && init?.method === 'POST') {
        return { ok: false, text: async () => 'boom' } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const { unmount } = render(<Pairing />);
  fireEvent.click(await screen.findByText('Unpair'));
  expect(await screen.findByText(/boom/)).toBeDefined();
  expect(screen.queryByText(/Paired, but Chrome isn't connected/)).not.toBeNull();
  unmount();
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

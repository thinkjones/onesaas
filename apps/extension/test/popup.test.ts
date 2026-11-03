// @vitest-environment jsdom
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../entrypoints/popup/App.tsx';

// Popup harness (Bug #5): the popup was untested by design in M1, but the
// Bug #5 redesign (status, profile, info, link, unpair/re-pair) needs
// regression cover. No @testing-library here — react-dom createRoot + act
// with plain DOM queries, and stubbed browser/fetch globals.

interface FakeStatus {
  paired: boolean;
  connected: boolean;
  lastPingAt: string | null;
}

let status: FakeStatus;
let pingOk: boolean;
let focusResult: { focused: boolean };
let sendMessage: ReturnType<typeof vi.fn>;
let getProfileUserInfo: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root | null;

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await tick();
    });
  }
};

function setInput(el: HTMLInputElement, v: string) {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!;
  desc.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`button "${text}" missing: ${container.innerHTML}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  status = { paired: false, connected: false, lastPingAt: null };
  pingOk = true;
  sendMessage = vi.fn(async (msg: { action: string; code?: string }) => {
    if (msg.action === 'status') return { ...status, workerId: 'wkr123' };
    if (msg.action === 'ping') return { ok: pingOk };
    if (msg.action === 'getDebugLog') {
      return {
        events: [{ t: '2026-05-01T12:00:00.000Z', msg: 'pair sent' }],
        workerId: 'wkr123',
      };
    }
    if (msg.action === 'pair') {
      if (/^\d{6}$/.test(msg.code ?? '')) {
        status = { paired: true, connected: true, lastPingAt: null };
        return { ok: true, workerId: 'wkr123' };
      }
      return { ok: false, error: 'Bad code.' };
    }
    if (msg.action === 'unpair') {
      status = { paired: false, connected: false, lastPingAt: null };
      return {};
    }
    throw new Error(`unexpected action: ${msg.action}`);
  });
  getProfileUserInfo = vi.fn(async () => ({ email: 'priya@gmail.com', id: 'abc123' }));
  focusResult = { focused: true };
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    if (String(input) === 'http://127.0.0.1:8787/api/app/focus') {
      return { ok: true, json: async () => ({ ...focusResult }) };
    }
    return { ok: true };
  });
  vi.stubGlobal('browser', {
    runtime: { sendMessage },
    identity: { getProfileUserInfo },
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPopup() {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(App));
  });
  await flush();
}

describe('popup paired view', () => {
  test('shows status, profile, info, app link, and unpair/re-pair', async () => {
    status = { paired: true, connected: true, lastPingAt: null };
    await renderPopup();
    const text = container.textContent ?? '';
    expect(text).toContain("My Dad's AI Agent");
    expect(text).toContain('Paired ✓');
    expect(text).toContain('Connected ✓');
    expect(text).toContain('Chrome profile: priya@gmail.com');
    expect(text).toContain('reads the email you have open');
    buttonByText('Open the app to manage');
    buttonByText('Unpair');
    buttonByText('Pair again');
  });

  test('paired but offline says not connected and still shows the profile', async () => {
    status = { paired: true, connected: false, lastPingAt: null };
    await renderPopup();
    const text = container.textContent ?? '';
    expect(text).toContain('Paired ✓');
    expect(text).toContain('Not connected');
    expect(text).toContain('Chrome profile: priya@gmail.com');
  });

  test('a profile lookup failure falls back to not signed in', async () => {
    status = { paired: true, connected: true, lastPingAt: null };
    getProfileUserInfo.mockRejectedValueOnce(new Error('nope'));
    await renderPopup();
    expect(container.textContent ?? '').toContain('Chrome profile: not signed in');
  });

  test('unpair revokes the server token, forgets local state, shows the code box', async () => {
    status = { paired: true, connected: true, lastPingAt: null };
    await renderPopup();
    await act(async () => {
      buttonByText('Unpair').click();
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/pairing/revoke',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sendMessage).toHaveBeenCalledWith({ action: 'unpair' });
    expect(container.querySelector('input')).not.toBeNull();
  });

  test('pair again keeps the server token and shows the code box', async () => {
    status = { paired: true, connected: true, lastPingAt: null };
    await renderPopup();
    await act(async () => {
      buttonByText('Pair again').click();
    });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({ action: 'unpair' });
    expect(container.querySelector('input')).not.toBeNull();
  });
});

describe('popup unpaired view', () => {
  test('shows the code box plus info and a link to get a code', async () => {
    await renderPopup();
    expect(container.querySelector('input')).not.toBeNull();
    buttonByText('Pair');
    const text = container.textContent ?? '';
    expect(text).toContain('reads the email you have open');
    buttonByText('Open the app to manage');
  });

  test('pairing with a valid code lands on the paired view', async () => {
    await renderPopup();
    const input = container.querySelector('input')!;
    act(() => setInput(input, '123456'));
    await act(async () => {
      buttonByText('Pair').click();
    });
    await flush();
    expect(sendMessage).toHaveBeenCalledWith({ action: 'pair', code: '123456' });
    expect(container.textContent ?? '').toContain('Paired ✓');
  });

  test('a spinner shows while the pair request is in flight', async () => {
    await renderPopup();
    let resolvePair!: (v: unknown) => void;
    sendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePair = resolve;
        }),
    );
    const input = container.querySelector('input')!;
    act(() => setInput(input, '123456'));
    await act(async () => {
      buttonByText('Pair').click();
      await tick();
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => {
      status = { paired: true, connected: true, lastPingAt: null };
      resolvePair({ ok: true });
    });
    await flush();
    expect(container.textContent ?? '').toContain('Paired ✓');
  });
});

describe('popup live ping', () => {
  test('a failed open-probe reads not connected even when the socket is open', async () => {
    status = {
      paired: true,
      connected: true,
      lastPingAt: new Date(Date.now() - 8000).toISOString(),
    };
    pingOk = false;
    await renderPopup();
    expect(sendMessage).toHaveBeenCalledWith({ action: 'ping' });
    const text = container.textContent ?? '';
    expect(text).toContain('Not connected');
    expect(text).not.toContain('Connected ✓');
  });

  test('a passing probe keeps the connected view', async () => {
    status = {
      paired: true,
      connected: true,
      lastPingAt: new Date(Date.now() - 8000).toISOString(),
    };
    pingOk = true;
    await renderPopup();
    expect(container.textContent ?? '').toContain('Connected ✓');
  });

  test('shows the last ping age and which app it is talking to', async () => {
    status = {
      paired: true,
      connected: true,
      lastPingAt: new Date(Date.now() - 8000).toISOString(),
    };
    await renderPopup();
    const text = container.textContent ?? '';
    expect(text).toContain('Last ping: 8s ago');
    expect(text).toContain('Talking to: the extension bridge (ws://127.0.0.1:8787/ext)');
  });

  test('before first contact the last ping reads never', async () => {
    status = { paired: true, connected: true, lastPingAt: null };
    await renderPopup();
    expect(container.textContent ?? '').toContain('Last ping: never');
  });
});

describe('popup open the app', () => {
  let opened: string[];
  let closed: number;

  beforeEach(() => {
    opened = [];
    closed = 0;
    vi.spyOn(window, 'open').mockImplementation(((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open);
    vi.spyOn(window, 'close').mockImplementation(() => {
      closed += 1;
    });
  });

  test('a listening desktop app is focused and the popup closes', async () => {
    focusResult = { focused: true };
    status = { paired: true, connected: true, lastPingAt: null };
    await renderPopup();
    await act(async () => {
      buttonByText('Open the app to manage').click();
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/app/focus',
      expect.objectContaining({ method: 'POST' }),
    );
    const focusCall = fetchMock.mock.calls.find(
      ([u]) => u === 'http://127.0.0.1:8787/api/app/focus',
    )!;
    expect(JSON.parse(focusCall[1]!.body as string)).toEqual({
      path: '/settings',
      hash: 'chrome-extension',
    });
    expect(closed).toBe(1);
    expect(opened).toHaveLength(0);
  });

  test('no desktop listening falls back to the settings page in a tab', async () => {
    focusResult = { focused: false };
    status = { paired: true, connected: true, lastPingAt: null };
    await renderPopup();
    await act(async () => {
      buttonByText('Open the app to manage').click();
    });
    await flush();
    expect(opened).toEqual(['http://localhost:5173/settings#chrome-extension']);
    expect(closed).toBe(0);
  });

  test('an unreachable server falls back to the settings page in a tab', async () => {
    status = { paired: true, connected: true, lastPingAt: null };
    await renderPopup();
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await act(async () => {
      buttonByText('Open the app to manage').click();
    });
    await flush();
    expect(opened).toEqual(['http://localhost:5173/settings#chrome-extension']);
    expect(closed).toBe(0);
  });

  test('the unpaired view also opens the desktop app first', async () => {
    focusResult = { focused: true };
    await renderPopup();
    await act(async () => {
      buttonByText('Open the app to manage').click();
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/app/focus',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(closed).toBe(1);
    expect(opened).toHaveLength(0);
  });
});

describe('popup unpaired connection info', () => {
  test('the code-box view also shows talking-to and last ping', async () => {
    status = { paired: false, connected: false, lastPingAt: new Date(Date.now() - 8000).toISOString() };
    await renderPopup();
    expect(container.querySelector('input')).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('Talking to: the extension bridge (ws://127.0.0.1:8787/ext)');
    expect(text).toContain('Last ping: 8s ago');
  });

  test('the code-box view reads never before first contact', async () => {
    status = { paired: false, connected: false, lastPingAt: null };
    await renderPopup();
    expect(container.textContent ?? '').toContain('Last ping: never');
  });
});

describe('popup pair logging + retry', () => {
  function pairCalls() {
    return sendMessage.mock.calls.filter(([m]) => m.action === 'pair');
  }

  test('a first send that dies waking the worker retries once and pairs', async () => {
    await renderPopup();
    sendMessage.mockRejectedValueOnce(new Error('Could not establish connection'));
    const input = container.querySelector('input')!;
    act(() => setInput(input, '123456'));
    await act(async () => {
      buttonByText('Pair').click();
      await new Promise((r) => setTimeout(r, 800));
    });
    await flush();
    expect(container.textContent ?? '').toContain('Paired ✓');
    expect(container.textContent ?? '').not.toContain('No answer');
    expect(pairCalls()).toHaveLength(2);
    const log = container.querySelector('details')!.textContent ?? '';
    expect(log).toContain('retrying');
    expect(log).toContain('pair ok');
  });

  test('two failed sends show the error and log the outcome', async () => {
    await renderPopup();
    const orig = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation(async (msg) => {
      if (msg.action === 'pair') throw new Error('dead worker');
      return orig(msg);
    });
    const input = container.querySelector('input')!;
    act(() => setInput(input, '123456'));
    await act(async () => {
      buttonByText('Pair').click();
      await new Promise((r) => setTimeout(r, 800));
    });
    await flush();
    expect(container.textContent ?? '').toContain('No answer from the app. Is it running?');
    expect(pairCalls()).toHaveLength(2);
    const log = container.querySelector('details')!.textContent ?? '';
    expect(log).toContain('retrying');
    expect(log).toContain('background unreachable');
  });

  test('rapid double-click sends one pair', async () => {
    await renderPopup();
    const input = container.querySelector('input')!;
    act(() => setInput(input, '123456'));
    await act(async () => {
      buttonByText('Pair').click();
      buttonByText('Pair').click();
    });
    await flush();
    expect(pairCalls()).toHaveLength(1);
  });

  test('connection log shows background events', async () => {
    await renderPopup();
    const log = container.querySelector('details')!.textContent ?? '';
    expect(log).toContain('[bg 12:00:00] pair sent');
  });
});

describe('popup worker correlation', () => {
  test('post-pair log shows the pair, status, and bg-log worker ids', async () => {
    await renderPopup();
    const input = container.querySelector('input')!;
    act(() => setInput(input, '123456'));
    await act(async () => {
      buttonByText('Pair').click();
    });
    await flush();
    const log = container.querySelector('details')!.textContent ?? '';
    expect(log).toContain('pair ok');
    expect(log).toContain('worker wkr123');
    expect(log).toContain('status: paired=true worker=wkr123 (bg log worker=wkr123)');
  });
});

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
    if (msg.action === 'status') return { ...status };
    if (msg.action === 'ping') return { ok: pingOk };
    if (msg.action === 'pair') {
      if (/^\d{6}$/.test(msg.code ?? '')) {
        status = { paired: true, connected: true, lastPingAt: null };
        return { ok: true };
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
  fetchMock = vi.fn(async () => ({ ok: true }));
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
    const link = container.querySelector('a[href="http://localhost:5173"]');
    expect(link?.textContent).toContain('Open the app to manage');
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
    const link = container.querySelector('a[href="http://localhost:5173"]');
    expect(link?.textContent).toContain('Open the app to manage');
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
    expect(text).toContain('Talking to: the app on this computer (127.0.0.1:8787)');
  });

  test('before first contact the last ping reads never', async () => {
    status = { paired: true, connected: true, lastPingAt: null };
    await renderPopup();
    expect(container.textContent ?? '').toContain('Last ping: never');
  });
});

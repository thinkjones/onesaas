import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createBackground,
  type BrowserLike,
  type SocketLike,
  type WebSocketCtor,
} from '../lib/background.js';

const WS_URL = 'ws://127.0.0.1:8787/ext';

// Fake timers only fake macrotasks; this flushes pending microtasks (mocked
// promise hops in the message handlers) without advancing the clock.
const flush = () => vi.advanceTimersByTimeAsync(0);

class FakeSocket implements SocketLike {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number): void {
    this.readyState = FakeSocket.CLOSED;
    if (code === undefined) this.onclose?.();
    else this.onclose?.({ code });
  }
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.({});
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  receiveRaw(raw: string): void {
    this.onmessage?.({ data: raw });
  }
}

const FakeWebSocket = FakeSocket as unknown as WebSocketCtor;

interface FakeTab {
  id?: number;
  url?: string;
}

function makeBrowser(
  opts: {
    token?: string;
    tabs?: FakeTab[];
    tabReply?: unknown;
    tabThrows?: boolean;
    captureThrows?: boolean;
    /** Adds an identity surface resolving getProfileUserInfo to this email. */
    email?: string;
    /** The identity surface throws instead of resolving. */
    identityThrows?: boolean;
  } = {},
) {
  const store: Record<string, unknown> = {};
  if (opts.token !== undefined) store['onesaasExtToken'] = opts.token;
  const tabs = opts.tabs ?? [{ id: 11, url: 'https://mail.google.com/mail/u/0/#inbox' }];
  // Active tab id, like the real browser: the owner starts on tab 7, and
  // update({active:true}) moves activation (so the pre-capture verification
  // query sees the just-activated worker tab).
  let activeId = 7;
  let listener: ((msg: never) => unknown) | null = null;
  const tabMessages: Array<{ tabId: number; msg: unknown }> = [];
  const created: Array<{ url?: string; active?: boolean; pinned?: boolean }> = [];
  const updated: Array<{ tabId: number; props: Record<string, unknown> }> = [];
  let nextId = 100;
  const browser: BrowserLike = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
    tabs: {
      query: vi.fn(
        async (q: { url?: string; active?: boolean; currentWindow?: boolean; windowId?: number }) => {
          if (q.active) return [{ id: activeId, active: true, windowId: 1 }];
          if (q.url) {
            const prefix = q.url.replace(/\*$/, '');
            return tabs.filter((t) => t.url?.startsWith(prefix));
          }
          return tabs;
        },
      ),
      get: vi.fn(async (tabId: number) => {
        const found = tabs.find((t) => t.id === tabId);
        if (!found) throw new Error('No tab with id');
        return { ...found, status: 'complete' };
      }),
      create: vi.fn(async (props: { url?: string; active?: boolean; pinned?: boolean }) => {
        created.push(props);
        nextId += 1;
        const tab = { id: nextId, url: props.url };
        tabs.push(tab);
        return { ...tab, status: 'complete' };
      }),
      update: vi.fn(async (tabId: number, props: Record<string, unknown>) => {
        updated.push({ tabId, props });
        if (props['active'] === true) activeId = tabId;
        return { id: tabId, status: 'complete' };
      }),
      captureVisibleTab: vi.fn(async () => {
        if (opts.captureThrows) throw new Error('capture failed');
        return 'data:image/png;base64,AAAA';
      }),
      sendMessage: vi.fn(async (tabId: number, msg: unknown) => {
        tabMessages.push({ tabId, msg });
        if (opts.tabThrows) throw new Error('tab gone');
        return opts.tabReply ?? { ok: true, output: { drafted: true } };
      }),
    },
    runtime: {
      onMessage: {
        addListener: (fn: (msg: never) => unknown) => {
          listener = fn;
        },
      },
    },
    ...(opts.email !== undefined || opts.identityThrows
      ? {
          identity: {
            getProfileUserInfo: async () => {
              if (opts.identityThrows) throw new Error('identity unavailable');
              return { email: opts.email ?? '', id: 'profile1' };
            },
          },
        }
      : {}),
  };
  return {
    browser,
    store,
    tabs,
    tabMessages,
    created,
    updated,
    // Platform contract, proven live (ping came back, status arrived as
    // undefined): synchronous values are dropped — only Promises, and the
    // explicit undefined of an uninterested listener, survive delivery.
    runtimeMessage: (msg: unknown) => {
      const r = listener?.(msg as never);
      if (r !== undefined && !(r instanceof Promise)) return undefined;
      return r;
    },
  };
}

function lastSocket(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1]!;
}

function sentJson(sock: FakeSocket): unknown[] {
  return sock.sent.map((s) => JSON.parse(s) as unknown);
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('boot', () => {
  it('carries over a pairing saved under the earlier name', async () => {
    const t = makeBrowser();
    await t.browser.storage.local.set({ dadExtToken: 'old-tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    expect(sentJson(lastSocket())).toEqual([{ type: 'hello', token: 'old-tok' }]);
    expect(t.store['onesaasExtToken']).toBe('old-tok');
    expect(t.store['dadExtToken']).toBeUndefined();
    bg.dispose();
  });

  it('connects and says hello when a token is stored', async () => {
    const t = makeBrowser({ token: 'tok123' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(lastSocket().url).toBe(WS_URL);
    expect(lastSocket().sent).toHaveLength(0);
    lastSocket().open();
    expect(sentJson(lastSocket())).toEqual([{ type: 'hello', token: 'tok123' }]);
    bg.dispose();
  });

  it('connects but sends nothing when unpaired (waits for pairing)', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    expect(lastSocket().sent).toHaveLength(0);
    bg.dispose();
  });
});

describe('pairing', () => {
  it('pair -> paired stores the token, says hello, and replies ok', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const replyP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<unknown>;
    // pair() awaits the open check, so the send lands a microtask later.
    await flush();
    expect(sentJson(lastSocket())).toContainEqual({ type: 'pair', code: '123456' });
    lastSocket().receive({ type: 'paired', token: 'newtok' });
    await expect(replyP).resolves.toEqual({ ok: true, workerId: expect.any(String) });
    expect(t.store['onesaasExtToken']).toBe('newtok');
    expect(sentJson(lastSocket())).toContainEqual({ type: 'hello', token: 'newtok' });
    bg.dispose();
  });

  it('pair times out after 5s when the server stays silent (wrong code)', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const replyP = t.runtimeMessage({ action: 'pair', code: '000000' }) as Promise<unknown>;
    const assertion = expect(replyP).resolves.toEqual({
      ok: false,
      error: 'No answer from the app. Is it running?',
    });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    bg.dispose();
  });

  it('pair while the socket is still connecting waits for the open', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    const replyP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<unknown>;
    await flush();
    expect(lastSocket().sent).toHaveLength(0);
    lastSocket().open();
    await flush();
    expect(sentJson(lastSocket())).toContainEqual({ type: 'pair', code: '123456' });
    lastSocket().receive({ type: 'paired', token: 'tok' });
    await expect(replyP).resolves.toEqual({ ok: true, workerId: expect.any(String) });
    bg.dispose();
  });
});

describe('unpair', () => {
  it('clears the token + storage and reports unpaired, keeping the socket for re-pair', async () => {
    const t = makeBrowser({ token: 'tok123' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    await expect(t.runtimeMessage({ action: 'unpair' })).resolves.toEqual({ ok: true });
    expect(t.store['onesaasExtToken']).toBeUndefined();
    expect(await t.runtimeMessage({ action: 'status' })).toEqual({
      paired: false,
      connected: true,
      lastPingAt: null,
      workerId: expect.any(String),
    });
    bg.dispose();
  });

  it('succeeds when already unpaired', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    await expect(t.runtimeMessage({ action: 'unpair' })).resolves.toEqual({ ok: true });
    expect(t.store['onesaasExtToken']).toBeUndefined();
    bg.dispose();
  });
});

describe('status', () => {
  it('reports paired + connected', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    expect(await t.runtimeMessage({ action: 'status' })).toEqual({
      paired: false,
      connected: false,
      lastPingAt: null,
      workerId: expect.any(String),
    });
    lastSocket().open();
    expect(await t.runtimeMessage({ action: 'status' })).toEqual({
      paired: false,
      connected: true,
      lastPingAt: null,
      workerId: expect.any(String),
    });
    bg.dispose();

    const t2 = makeBrowser({ token: 'tok' });
    const bg2 = createBackground({ browser: t2.browser, WebSocket: FakeWebSocket });
    await bg2.boot();
    lastSocket().open();
    expect(await t2.runtimeMessage({ action: 'status' })).toEqual({
      paired: true,
      connected: true,
      lastPingAt: null,
      workerId: expect.any(String),
    });
    lastSocket().close();
    expect(await t2.runtimeMessage({ action: 'status' })).toEqual({
      paired: true,
      connected: false,
      lastPingAt: null,
      workerId: expect.any(String),
    });
    bg2.dispose();
  });
});

describe('server messages', () => {
  it('ready is swallowed: buttons always arrive separately in M1', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().receive({ type: 'ready', buttons: [] });
    await flush();
    expect(t.tabMessages).toHaveLength(0);
    bg.dispose();
  });

  it('buttons fan out to every Gmail tab', async () => {
    const t = makeBrowser({
      token: 'tok',
      tabs: [
        { id: 11, url: 'https://mail.google.com/mail/u/0/#inbox' },
        { id: 22, url: 'https://mail.google.com/mail/u/0/#sent' },
      ],
    });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const items = [{ workflowId: 'wf1', label: '✨ Save as lead & reply' }];
    lastSocket().receive({ type: 'buttons', items });
    await flush();
    expect(t.browser.tabs.query).toHaveBeenCalledWith({ url: 'https://mail.google.com/*' });
    expect(t.tabMessages).toEqual([
      { tabId: 11, msg: { type: 'buttons', items } },
      { tabId: 22, msg: { type: 'buttons', items } },
    ]);
    bg.dispose();
  });

  it('runStatus fans out to every Gmail tab', async () => {
    const t = makeBrowser({
      token: 'tok',
      tabs: [
        { id: 11, url: 'https://mail.google.com/mail/u/0/#inbox' },
        { id: 22, url: 'https://mail.google.com/mail/u/0/#sent' },
      ],
    });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const status = {
      type: 'runStatus',
      workflowId: 'wf1',
      threadId: 'thread_fixture_abc123',
      runId: 'run1',
      status: 'running',
    };
    lastSocket().receive(status);
    await flush();
    expect(t.tabMessages).toEqual([
      { tabId: 11, msg: status },
      { tabId: 22, msg: status },
    ]);
    bg.dispose();
  });

  it('pong is ignored', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive({ type: 'pong' });
    await flush();
    expect(lastSocket().sent).toHaveLength(0);
    expect(t.tabMessages).toHaveLength(0);
    bg.dispose();
  });

  it('unknown and malformed server messages are ignored', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    expect(() => {
      lastSocket().receive({ type: 'bogus' });
      lastSocket().receiveRaw('not json{');
    }).not.toThrow();
    await flush();
    expect(lastSocket().sent).toHaveLength(0);
    expect(t.tabMessages).toHaveLength(0);
    bg.dispose();
  });
});

describe('cmd relay', () => {
  const cmd = {
    type: 'cmd',
    id: 'c1',
    site: 'gmail',
    action: 'readOpenEmail',
    input: { threadId: 'thread_fixture_abc123' },
  };

  it('sends cmd to the first Gmail tab and relays the result', async () => {
    const email = { from: 'sarah@example.com', subject: 'hi' };
    const t = makeBrowser({ token: 'tok', tabReply: { ok: true, output: email } });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive(cmd);
    await flush();
    expect(t.tabMessages).toEqual([
      {
        tabId: 11,
        msg: {
          type: 'cmd',
          id: 'c1',
          action: 'readOpenEmail',
          input: { threadId: 'thread_fixture_abc123' },
        },
      },
    ]);
    expect(sentJson(lastSocket())).toEqual([
      { type: 'result', id: 'c1', ok: true, output: email },
    ]);
    bg.dispose();
  });

  it('relays tab-reported errors as ok:false results', async () => {
    const t = makeBrowser({ token: 'tok', tabReply: { ok: false, error: 'boom' } });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive(cmd);
    await flush();
    expect(sentJson(lastSocket())).toEqual([{ type: 'result', id: 'c1', ok: false, error: 'boom' }]);
    bg.dispose();
  });

  it('replies with the exact site message when no Gmail tab is open', async () => {
    const t = makeBrowser({ token: 'tok', tabs: [] });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive(cmd);
    await flush();
    expect(sentJson(lastSocket())).toEqual([
      { type: 'result', id: 'c1', ok: false, error: 'I need Gmail open in Chrome to do this.' },
    ]);
    bg.dispose();
  });

  it('replies tab-didnt-answer when the tab throws', async () => {
    const t = makeBrowser({ token: 'tok', tabThrows: true });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive(cmd);
    await flush();
    expect(sentJson(lastSocket())).toEqual([
      { type: 'result', id: 'c1', ok: false, error: "Gmail tab didn't answer." },
    ]);
    bg.dispose();
  });

  it('forwards a known tab code on the result', async () => {
    const t = makeBrowser({
      token: 'tok',
      tabReply: { ok: false, error: 'selector gone', code: 'SELECTOR_MISSING' },
    });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive(cmd);
    await flush();
    expect(sentJson(lastSocket())).toEqual([
      { type: 'result', id: 'c1', ok: false, error: 'selector gone', code: 'SELECTOR_MISSING' },
    ]);
    bg.dispose();
  });

  it('drops unknown tab codes so the server still parses the result', async () => {
    const t = makeBrowser({ token: 'tok', tabReply: { ok: false, error: 'weird', code: 'BOGUS' } });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive(cmd);
    await flush();
    const results = sentJson(lastSocket()) as Array<Record<string, unknown>>;
    expect(results).toEqual([{ type: 'result', id: 'c1', ok: false, error: 'weird' }]);
    expect('code' in results[0]!).toBe(false);
    bg.dispose();
  });
});

describe('worker tab routing', () => {
  const workerCmd = {
    type: 'cmd',
    id: 'w1',
    site: 'calendar',
    action: 'readEvents',
    input: {},
    tab: 'worker',
  };

  it('routes worker cmds to a pinned, inactive worker tab', async () => {
    const t = makeBrowser({ token: 'tok', tabs: [] });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive(workerCmd);
    await flush();
    expect(t.created).toHaveLength(1);
    expect(t.created[0]).toMatchObject({ pinned: true, active: false });
    expect(t.created[0]?.url).toContain('calendar.google.com');
    const workerId = t.tabMessages[0]?.tabId;
    expect(workerId).toBeGreaterThan(100);
    expect(sentJson(lastSocket())).toEqual([
      { type: 'result', id: 'w1', ok: true, output: { drafted: true } },
    ]);
    bg.dispose();
  });

  it('reuses the worker tab across cmds', async () => {
    const t = makeBrowser({ token: 'tok', tabs: [] });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().receive(workerCmd);
    await flush();
    lastSocket().receive({ ...workerCmd, id: 'w2' });
    await flush();
    expect(t.created).toHaveLength(1);
    expect(t.tabMessages.map((m) => m.tabId)).toEqual([
      t.tabMessages[0]?.tabId,
      t.tabMessages[0]?.tabId,
    ]);
    bg.dispose();
  });

  it('navigates the Gmail worker tab to the thread, then reads it there', async () => {
    const email = { from: 'bob@example.com', subject: 'booking', threadId: 'thread_abc123' };
    const t = makeBrowser({ token: 'tok', tabs: [], tabReply: { ok: true, output: email } });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive({
      type: 'cmd',
      id: 'w3',
      site: 'gmail',
      action: 'readOpenEmail',
      input: { threadId: 'thread_abc123' },
      tab: 'worker',
    });
    await flush();
    // The read lands in the navigated worker tab, and the owner's tabs are untouched.
    expect(t.updated).toContainEqual({
      tabId: t.tabMessages[0]?.tabId,
      props: { url: 'https://mail.google.com/mail/u/0/#all/thread_abc123' },
    });
    expect(t.tabMessages).toEqual([
      {
        tabId: t.tabMessages[0]?.tabId,
        msg: {
          type: 'cmd',
          id: 'w3',
          action: 'readOpenEmail',
          input: { threadId: 'thread_abc123' },
        },
      },
    ]);
    expect(sentJson(lastSocket())).toEqual([
      { type: 'result', id: 'w3', ok: true, output: email },
    ]);
    bg.dispose();
  });

  it('a worker gmail read without a threadId reads the worker tab as-is', async () => {
    const t = makeBrowser({ token: 'tok', tabs: [] });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive({
      type: 'cmd',
      id: 'w4',
      site: 'gmail',
      action: 'readOpenEmail',
      input: {},
      tab: 'worker',
    });
    await flush();
    expect(t.updated.find((u) => u.props['url'] !== undefined)).toBeUndefined();
    expect(t.tabMessages).toHaveLength(1);
    bg.dispose();
  });
});

describe('active routing for new sites', () => {
  it('focuses an existing visible tab', async () => {
    const t = makeBrowser({
      token: 'tok',
      tabs: [{ id: 21, url: 'https://business.facebook.com/home' }],
    });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive({ type: 'cmd', id: 'a1', site: 'meta', action: 'read', input: {} });
    await flush();
    expect(t.created).toHaveLength(0);
    expect(t.updated).toContainEqual({ tabId: 21, props: { active: true } });
    expect(t.tabMessages[0]?.tabId).toBe(21);
    bg.dispose();
  });

  it('opens a visible tab when none is open', async () => {
    const t = makeBrowser({ token: 'tok', tabs: [] });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive({ type: 'cmd', id: 'a2', site: 'calendar', action: 'read', input: {} });
    await flush();
    expect(t.created).toHaveLength(1);
    expect(t.created[0]).toMatchObject({ active: true });
    expect(t.created[0]?.pinned).not.toBe(true);
    expect(sentJson(lastSocket())).toEqual([
      { type: 'result', id: 'a2', ok: true, output: { drafted: true } },
    ]);
    bg.dispose();
  });

  it('does not reuse a tab whose URL does not match the site', async () => {
    const t = makeBrowser({ token: 'tok', tabs: [{ id: 31, url: 'https://example.com/' }] });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive({ type: 'cmd', id: 'a3', site: 'meta', action: 'read', input: {} });
    await flush();
    // Falls through to the open path instead of focusing tab 31.
    expect(t.created).toHaveLength(1);
    expect(t.created[0]?.url).toContain('business.facebook.com');
    expect(t.updated.find((u) => u.tabId === 31)).toBeUndefined();
    expect(t.tabMessages[0]?.tabId).not.toBe(31);
    bg.dispose();
  });
});

describe('screenshot action', () => {
  it('captures the worker tab and returns the data URL', async () => {
    const t = makeBrowser({ token: 'tok', tabs: [] });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive({
      type: 'cmd',
      id: 's1',
      site: 'calendar',
      action: 'screenshot',
      input: { site: 'calendar', url: 'https://calendar.google.com/calendar/week' },
    });
    await flush();
    expect(sentJson(lastSocket())).toEqual([
      { type: 'result', id: 's1', ok: true, output: { dataUrl: 'data:image/png;base64,AAAA' } },
    ]);
    // Navigated the worker tab (first created id: 101), then restored the owner's tab (id 7).
    expect(t.updated).toContainEqual({
      tabId: 101,
      props: { url: 'https://calendar.google.com/calendar/week' },
    });
    expect(t.updated).toContainEqual({ tabId: 7, props: { active: true } });
    // No content script involved.
    expect(t.tabMessages).toHaveLength(0);
    bg.dispose();
  });

  it('posts TIMEOUT when the capture fails', async () => {
    const t = makeBrowser({ token: 'tok', tabs: [], captureThrows: true });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    lastSocket().receive({
      type: 'cmd',
      id: 's2',
      site: 'calendar',
      action: 'screenshot',
      input: { site: 'calendar' },
    });
    await flush();
    const results = sentJson(lastSocket()) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]?.['ok']).toBe(false);
    expect(results[0]?.['code']).toBe('TIMEOUT');
    expect(t.updated).toContainEqual({ tabId: 7, props: { active: true } });
    bg.dispose();
  });
});

describe('trigger relay', () => {
  it('sends the flat Task-9 trigger shape', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().receive({ type: 'ready', buttons: [] });
    await flush();
    lastSocket().sent.length = 0;
    const email = {
      from: 'sarah@example.com',
      fromName: 'Sarah Lee',
      subject: 'Catering',
      body: 'hi',
      threadId: 'thread_fixture_abc123',
    };
    t.runtimeMessage({ action: 'trigger', workflowId: 'wf1', email });
    await flush();
    expect(sentJson(lastSocket())).toEqual([
      { type: 'trigger', workflowId: 'wf1', triggerType: 'gmailButton', payload: email },
    ]);
    bg.dispose();
  });

  it('queues the trigger until the socket is open and hello is acked', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    const email = {
      from: 'sarah@example.com',
      fromName: 'Sarah Lee',
      subject: 'Catering',
      body: 'hi',
      threadId: 'thread_fixture_abc123',
    };
    const doneP = t.runtimeMessage({ action: 'trigger', workflowId: 'wf1', email }) as Promise<void>;
    await flush();
    expect(lastSocket().sent).toHaveLength(0);
    lastSocket().open();
    await flush();
    // Hello went out on open, but the trigger still waits for the ready ack.
    expect(sentJson(lastSocket())).toEqual([{ type: 'hello', token: 'tok' }]);
    lastSocket().receive({ type: 'ready', buttons: [] });
    await doneP;
    expect(sentJson(lastSocket())).toEqual([
      { type: 'hello', token: 'tok' },
      { type: 'trigger', workflowId: 'wf1', triggerType: 'gmailButton', payload: email },
    ]);
    bg.dispose();
  });

  it('drops the trigger when ready never arrives (no hang)', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    const email = {
      from: 'sarah@example.com',
      fromName: 'Sarah Lee',
      subject: 'Catering',
      body: 'hi',
      threadId: 'thread_fixture_abc123',
    };
    const doneP = t.runtimeMessage({ action: 'trigger', workflowId: 'wf1', email }) as Promise<void>;
    await flush();
    lastSocket().open();
    await flush();
    const assertion = expect(doneP).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(sentJson(lastSocket())).toEqual([{ type: 'hello', token: 'tok' }]);
    bg.dispose();
  });

  it('ignores unknown runtime messages', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().sent.length = 0;
    expect(t.runtimeMessage({ action: 'bogus' })).toBeUndefined();
    await flush();
    expect(lastSocket().sent).toHaveLength(0);
    bg.dispose();
  });

  it('passes triggerType email through for inbox-watcher fan-out', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().receive({ type: 'ready', buttons: [] });
    await flush();
    lastSocket().sent.length = 0;
    const email = {
      threadId: 'thread_fixture_abc123',
      from: 'sarah@example.com',
      fromName: 'Sarah Lee',
      subject: 'Catering',
      snippet: 'Do you cater?',
    };
    t.runtimeMessage({ action: 'trigger', workflowId: '*', triggerType: 'email', email });
    await flush();
    expect(sentJson(lastSocket())).toEqual([
      { type: 'trigger', workflowId: '*', triggerType: 'email', payload: email },
    ]);
    bg.dispose();
  });

  it('falls back to gmailButton for a missing triggerType', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().receive({ type: 'ready', buttons: [] });
    await flush();
    lastSocket().sent.length = 0;
    const email = { threadId: 't1' };
    t.runtimeMessage({ action: 'trigger', workflowId: 'wf1', email });
    await flush();
    expect(sentJson(lastSocket())).toEqual([
      { type: 'trigger', workflowId: 'wf1', triggerType: 'gmailButton', payload: email },
    ]);
    bg.dispose();
  });
});

describe('reconnect + ping', () => {
  it('backs off 1, 2, 5, 10s then stays at 10s; a successful open resets the streak', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();

    // Outage: every reconnect attempt fails (close without open).
    // Close #1 -> reconnect after 1s.
    lastSocket().close();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(2);
    // Close #2 -> 2s.
    lastSocket().close();
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(3);
    // Close #3 -> 5s.
    lastSocket().close();
    await vi.advanceTimersByTimeAsync(4999);
    expect(FakeSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(4);
    // Close #4 -> 10s.
    lastSocket().close();
    await vi.advanceTimersByTimeAsync(9999);
    expect(FakeSocket.instances).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(5);
    // Close #5 -> still 10s.
    lastSocket().close();
    await vi.advanceTimersByTimeAsync(9999);
    expect(FakeSocket.instances).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(6);
    // A connection that succeeds resets the streak: next close is back to 1s.
    lastSocket().open();
    lastSocket().close();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.instances).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(7);
    bg.dispose();
  });

describe('getButtons (late-loading Gmail tabs)', () => {
  it('returns [] before any buttons message', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    await expect(t.runtimeMessage({ action: 'getButtons' })).resolves.toEqual({
      type: 'buttons',
      items: [],
    });
    bg.dispose();
  });

  it('caches server buttons; replies are isolated copies', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const items = [{ workflowId: 'wf1', label: '✨ Save as lead & reply' }];
    lastSocket().receive({ type: 'buttons', items });
    await flush();
    const reply = (await t.runtimeMessage({ action: 'getButtons' })) as {
      type: string;
      items: Array<{ workflowId: string; label: string }>;
    };
    expect(reply).toEqual({ type: 'buttons', items });
    expect(reply.items).not.toBe(items);
    // Mutating the reply must not corrupt the cache.
    reply.items.push({ workflowId: 'evil', label: 'evil' });
    reply.items[0]!.label = 'mutated';
    const reread = (await t.runtimeMessage({ action: 'getButtons' })) as {
      type: string;
      items: unknown[];
    };
    expect(reread).toEqual({ type: 'buttons', items });
    bg.dispose();
  });

  it('empty buttons clear previously cached buttons', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().receive({
      type: 'buttons',
      items: [{ workflowId: 'wf1', label: '✨ Save as lead & reply' }],
    });
    await flush();
    lastSocket().receive({ type: 'buttons', items: [] });
    await flush();
    await expect(t.runtimeMessage({ action: 'getButtons' })).resolves.toEqual({
      type: 'buttons',
      items: [],
    });
    bg.dispose();
  });
  });

  it('pings every 20s while open and stops on close', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    // Pin the socket: advancing past the reconnect delay replaces lastSocket().
    const sock = lastSocket();
    sock.sent.length = 0;
    await vi.advanceTimersByTimeAsync(20000);
    expect(sentJson(sock)).toEqual([{ type: 'ping' }]);
    await vi.advanceTimersByTimeAsync(20000);
    expect(sentJson(sock)).toEqual([{ type: 'ping' }, { type: 'ping' }]);
    sock.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(sentJson(sock)).toEqual([{ type: 'ping' }, { type: 'ping' }]);
    bg.dispose();
  });
});

describe('mutual ping', () => {
  it('hello carries the Chrome profile email when identity resolves', async () => {
    const t = makeBrowser({ token: 'tok123', email: 'owner@gmail.com' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    expect(sentJson(lastSocket())).toEqual([
      { type: 'hello', token: 'tok123', client: { profileEmail: 'owner@gmail.com' } },
    ]);
    bg.dispose();
  });

  it('hello stays bare when identity is missing, empty, or throws', async () => {
    for (const opts of [{}, { email: '' }, { identityThrows: true }]) {
      const t = makeBrowser({ token: 'tok', ...opts });
      const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
      await bg.boot();
      lastSocket().open();
      expect(sentJson(lastSocket())).toEqual([{ type: 'hello', token: 'tok' }]);
      bg.dispose();
    }
  });

  it('the pair-flow hello carries the profile email too', async () => {
    const t = makeBrowser({ email: 'owner@gmail.com' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const replyP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<unknown>;
    await flush();
    lastSocket().receive({ type: 'paired', token: 'newtok' });
    await expect(replyP).resolves.toEqual({ ok: true, workerId: expect.any(String) });
    expect(sentJson(lastSocket())).toContainEqual({
      type: 'hello',
      token: 'newtok',
      client: { profileEmail: 'owner@gmail.com' },
    });
    bg.dispose();
  });

  it('a correlated server ping gets a pong(id) reply', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().receive({ type: 'ping', id: 'p1' });
    await flush();
    expect(sentJson(lastSocket())).toContainEqual({ type: 'pong', id: 'p1' });
    bg.dispose();
  });

  it('ready, pong, and server ping stamp lastPingAt; cmd traffic does not', async () => {
    vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const lastPing = async () =>
      (await (t.runtimeMessage({ action: 'status' }) as unknown as Promise<{ lastPingAt: string | null }>))
        .lastPingAt;
    expect(await lastPing()).toBeNull();
    lastSocket().receive({ type: 'ready', buttons: [] });
    await flush();
    expect(await lastPing()).toBe('2026-05-01T12:00:00.000Z');
    // A cmd proves nothing about ping freshness: the stamp must not move.
    lastSocket().receive({ type: 'cmd', id: 'c1', site: 'gmail', action: 'readOpenEmail', input: {} });
    await flush();
    expect(await lastPing()).toBe('2026-05-01T12:00:00.000Z');
    await vi.advanceTimersByTimeAsync(30_000);
    lastSocket().receive({ type: 'pong' });
    await flush();
    expect(await lastPing()).toBe('2026-05-01T12:00:30.000Z');
    await vi.advanceTimersByTimeAsync(30_000);
    lastSocket().receive({ type: 'ping', id: 'p9' });
    await flush();
    expect(await lastPing()).toBe('2026-05-01T12:01:00.000Z');
    bg.dispose();
  });

  it('ping action returns ok:false immediately when disconnected', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    // Socket never opened.
    await expect(t.runtimeMessage({ action: 'ping' })).resolves.toEqual({ ok: false });
    expect(lastSocket().sent).toHaveLength(0);
    bg.dispose();
  });

  it('ping action sends a ping and resolves true on the pong', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pingP = t.runtimeMessage({ action: 'ping' }) as Promise<unknown>;
    await flush();
    expect(sentJson(lastSocket())).toContainEqual({ type: 'ping' });
    lastSocket().receive({ type: 'pong' });
    await expect(pingP).resolves.toEqual({ ok: true });
    bg.dispose();
  });

  it('ping action resolves false after 2s of silence', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pingP = t.runtimeMessage({ action: 'ping' }) as Promise<unknown>;
    const assertion = expect(pingP).resolves.toEqual({ ok: false });
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    bg.dispose();
  });

  it('ping action resolves false when the socket closes mid-probe', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pingP = t.runtimeMessage({ action: 'ping' }) as Promise<unknown>;
    const assertion = expect(pingP).resolves.toEqual({ ok: false });
    await flush();
    lastSocket().close();
    await assertion;
    bg.dispose();
  });
});

describe('stale token + pair race', () => {
  it('a 4401 stops reconnecting: the dead token must be re-paired, not retried', async () => {
    const t = makeBrowser({ token: 'stale' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    expect(sentJson(lastSocket())).toContainEqual({ type: 'hello', token: 'stale' });
    lastSocket().close(4401);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(await t.runtimeMessage({ action: 'status' })).toEqual({
      paired: true,
      connected: false,
      lastPingAt: null,
      workerId: expect.any(String),
    });
    bg.dispose();
  });

  it('pair serializes after the auto-hello: no pair is sent before the ack', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pairP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<unknown>;
    await flush();
    expect(sentJson(lastSocket())).toEqual([{ type: 'hello', token: 'tok' }]);
    lastSocket().receive({ type: 'ready', buttons: [] });
    await flush();
    expect(sentJson(lastSocket())).toContainEqual({ type: 'pair', code: '123456' });
    lastSocket().receive({ type: 'paired', token: 'newtok' });
    await expect(pairP).resolves.toEqual({ ok: true, workerId: expect.any(String) });
    bg.dispose();
  });

  it('pair after a 4401 uses a hello-free socket and completes (the race fix)', async () => {
    const t = makeBrowser({ token: 'stale' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pairP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<unknown>;
    await flush();
    // The stale hello is rejected while pair waits for settle.
    lastSocket().close(4401);
    await flush();
    // A fresh socket opens with NO hello (rejection remembered)...
    expect(FakeSocket.instances).toHaveLength(2);
    expect(sentJson(lastSocket())).toEqual([]);
    lastSocket().open();
    await flush();
    expect(sentJson(lastSocket())).toEqual([{ type: 'pair', code: '123456' }]);
    lastSocket().receive({ type: 'paired', token: 'newtok' });
    await expect(pairP).resolves.toEqual({ ok: true, workerId: expect.any(String) });
    // ...and the new token hellos normally.
    expect(sentJson(lastSocket())).toContainEqual({ type: 'hello', token: 'newtok' });
    bg.dispose();
  });

  it('a successful pair clears the rejection: later closes reconnect normally', async () => {
    const t = makeBrowser({ token: 'stale' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pairP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<unknown>;
    await flush();
    lastSocket().close(4401);
    await flush();
    lastSocket().open();
    await flush();
    lastSocket().receive({ type: 'paired', token: 'newtok' });
    await expect(pairP).resolves.toEqual({ ok: true, workerId: expect.any(String) });
    // Plain close after a good pairing: backoff reconnects and re-hellos.
    lastSocket().close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(3);
    lastSocket().open();
    expect(sentJson(lastSocket())).toContainEqual({ type: 'hello', token: 'newtok' });
    bg.dispose();
  });

  it('a 4400 replacement still reconnects and re-hellos (token stays trusted)', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    lastSocket().close(4400);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    lastSocket().open();
    expect(sentJson(lastSocket())).toContainEqual({ type: 'hello', token: 'tok' });
    bg.dispose();
  });
});

describe('debug log', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  async function debugLog(t: { runtimeMessage: (m: never) => unknown }): Promise<string[]> {
    const res = (await t.runtimeMessage({ action: 'getDebugLog' } as never)) as {
      events: Array<{ t: string; msg: string }>;
    };
    return res.events.map((e) => e.msg);
  }

  it('logs the pair lifecycle end to end and mirrors to the console', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pairP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<unknown>;
    await flush();
    lastSocket().receive({ type: 'ready', buttons: [] });
    await flush();
    lastSocket().receive({ type: 'paired', token: 'newtok' });
    await expect(pairP).resolves.toEqual({ ok: true, workerId: expect.any(String) });
    const msgs = await debugLog(t);
    expect(msgs.join('\n')).toMatch(
      /boot done.*pair received.*hello settled \(acked\).*pair sent.*paired ok/s,
    );
    expect(consoleSpy).toHaveBeenCalled();
    bg.dispose();
  });

  it('logs pair timeouts and socket close codes', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pairP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<unknown>;
    const assertion = expect(pairP).resolves.toEqual({
      ok: false,
      error: 'No answer from the app. Is it running?',
    });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    lastSocket().close(4401);
    const msgs = await debugLog(t);
    expect(msgs).toContain('pair: no answer (5s timeout)');
    expect(msgs).toContain('socket close code=4401');
    bg.dispose();
  });

  it('caps the log at 100 entries', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    for (let i = 0; i < 60; i++) {
      lastSocket().open();
      lastSocket().close();
    }
    const res = (await t.runtimeMessage({ action: 'getDebugLog' } as never)) as {
      events: Array<{ t: string; msg: string }>;
    };
    expect(res.events).toHaveLength(100);
    bg.dispose();
  });
});

describe('debug log extras', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs probe outcomes and superseded pairs', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const pingP = t.runtimeMessage({ action: 'ping' }) as Promise<unknown>;
    await flush();
    lastSocket().receive({ type: 'pong' });
    await expect(pingP).resolves.toEqual({ ok: true });
    const p1 = t.runtimeMessage({ action: 'pair', code: '111111' }) as Promise<unknown>;
    const p2 = t.runtimeMessage({ action: 'pair', code: '222222' }) as Promise<unknown>;
    await flush();
    // p1 has no socket race here: both wait hello settle, then p2 supersedes p1.
    lastSocket().receive({ type: 'ready', buttons: [] });
    await flush();
    await expect(p1).resolves.toEqual({ ok: false, error: 'No answer from the app. Is it running?' });
    const res = (await t.runtimeMessage({ action: 'getDebugLog' } as never)) as {
      events: Array<{ t: string; msg: string }>;
    };
    const msgs = res.events.map((e) => e.msg);
    expect(msgs).toContain('probe: ok');
    expect(msgs).toContain('pair: previous attempt superseded');
    lastSocket().receive({ type: 'paired', token: 'newtok' });
    await expect(p2).resolves.toEqual({ ok: true, workerId: expect.any(String) });
    bg.dispose();
  });
});

describe('worker identity correlation', () => {
  it('tags status, log, and pair-ok with the same per-boot workerId', async () => {
    const t = makeBrowser({});
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    const status = (await t.runtimeMessage({ action: 'status' })) as { workerId: unknown };
    expect(typeof status.workerId).toBe('string');
    expect((status.workerId as string).length).toBeGreaterThan(0);
    const pairP = t.runtimeMessage({ action: 'pair', code: '123456' }) as Promise<{
      ok: boolean;
      workerId: unknown;
    }>;
    await flush();
    lastSocket().receive({ type: 'paired', token: 'tok' });
    expect((await pairP).workerId).toBe(status.workerId);
    const log = (await t.runtimeMessage({ action: 'getDebugLog' } as never)) as {
      workerId: unknown;
      events: Array<{ t: string; msg: string }>;
    };
    expect(log.workerId).toBe(status.workerId);
    const boot = log.events.find((e) => e.msg.startsWith('boot done'));
    expect(boot?.msg).toContain(`worker ${status.workerId as string}`);
    bg.dispose();
  });
});

describe('sync responses are dropped live', () => {
  it('answers status, log, and buttons with Promises, not sync values', async () => {
    const t = makeBrowser({ token: 'tok' });
    const bg = createBackground({ browser: t.browser, WebSocket: FakeWebSocket });
    await bg.boot();
    lastSocket().open();
    expect(t.runtimeMessage({ action: 'status' })).toBeInstanceOf(Promise);
    expect(t.runtimeMessage({ action: 'getDebugLog' } as never)).toBeInstanceOf(Promise);
    expect(t.runtimeMessage({ action: 'getButtons' })).toBeInstanceOf(Promise);
    bg.dispose();
  });
});

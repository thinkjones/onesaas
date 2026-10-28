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
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
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
  opts: { token?: string; tabs?: FakeTab[]; tabReply?: unknown; tabThrows?: boolean } = {},
) {
  const store: Record<string, unknown> = {};
  if (opts.token !== undefined) store['dadExtToken'] = opts.token;
  const tabs = opts.tabs ?? [{ id: 11, url: 'https://mail.google.com/mail/u/0/#inbox' }];
  let listener: ((msg: never) => unknown) | null = null;
  const tabMessages: Array<{ tabId: number; msg: unknown }> = [];
  const browser: BrowserLike = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        },
      },
    },
    tabs: {
      query: vi.fn(async () => tabs),
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
  };
  return {
    browser,
    store,
    tabs,
    tabMessages,
    runtimeMessage: (msg: unknown) => listener?.(msg as never),
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
    await expect(replyP).resolves.toEqual({ ok: true });
    expect(t.store['dadExtToken']).toBe('newtok');
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
    await expect(replyP).resolves.toEqual({ ok: true });
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
    });
    lastSocket().open();
    expect(await t.runtimeMessage({ action: 'status' })).toEqual({
      paired: false,
      connected: true,
    });
    bg.dispose();

    const t2 = makeBrowser({ token: 'tok' });
    const bg2 = createBackground({ browser: t2.browser, WebSocket: FakeWebSocket });
    await bg2.boot();
    lastSocket().open();
    expect(await t2.runtimeMessage({ action: 'status' })).toEqual({
      paired: true,
      connected: true,
    });
    lastSocket().close();
    expect(await t2.runtimeMessage({ action: 'status' })).toEqual({
      paired: true,
      connected: false,
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
      tabs: [{ id: 11 }, { id: 22 }],
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
    const t = makeBrowser({ token: 'tok', tabs: [{ id: 11 }, { id: 22 }] });
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
    expect(t.runtimeMessage({ action: 'getButtons' })).toEqual({ type: 'buttons', items: [] });
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
    const reply = t.runtimeMessage({ action: 'getButtons' }) as {
      type: string;
      items: Array<{ workflowId: string; label: string }>;
    };
    expect(reply).toEqual({ type: 'buttons', items });
    expect(reply.items).not.toBe(items);
    // Mutating the reply must not corrupt the cache.
    reply.items.push({ workflowId: 'evil', label: 'evil' });
    reply.items[0]!.label = 'mutated';
    const reread = t.runtimeMessage({ action: 'getButtons' }) as {
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
    expect(t.runtimeMessage({ action: 'getButtons' })).toEqual({ type: 'buttons', items: [] });
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

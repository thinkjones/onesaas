import { serve, type ServerType } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createApp, injectAppWebSocket, type AppDeps } from '../src/app.js';
import { createBridge, type Bridge, type WSContext } from '../src/bridge/bridge.js';
import { createPairing, createSettingsStore, type Pairing } from '../src/bridge/pairing.js';
import { openDb } from '../src/db/connection.js';

const GMAIL_MSG = 'I need Gmail open in Chrome to do this.';
const CALENDAR_MSG = 'I need Google Calendar open in Chrome to do this.';
const META_MSG = 'I need Meta Business Suite open in Chrome to do this.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const liveClients: WebSocket[] = [];
const liveServers: ServerType[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const c of liveClients.splice(0)) {
    try {
      c.terminate();
    } catch {
      // Already closed.
    }
  }
  for (const s of liveServers.splice(0)) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

type FullBridge = Bridge & { attach(ws: WSContext): void };

interface Setup {
  pairing: Pairing;
  bridge: FullBridge;
  server: ServerType;
  port: number;
}

async function waitListening(server: ServerType): Promise<number> {
  if (server.listening) return (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return (server.address() as AddressInfo).port;
}

async function setup(deps?: { pairing?: Pairing; bridge?: FullBridge }): Promise<Setup> {
  const store = new Map<string, string>();
  const pairing = deps?.pairing ?? createPairing(mapStore(store));
  const bridge = deps?.bridge ?? createBridge({ pairing });
  const appDeps: AppDeps = { pairing, bridge };
  const app = createApp(appDeps);
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  liveServers.push(server);
  injectAppWebSocket(app, server);
  const port = await waitListening(server);
  return { pairing, bridge, server, port };
}

async function setupUnconfigured() {
  const app = createApp({});
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  liveServers.push(server);
  injectAppWebSocket(app, server);
  const port = await waitListening(server);
  return { server, port };
}

function mapStore(map: Map<string, string>) {
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: string) => {
      map.set(k, v);
    },
    del: (k: string) => {
      map.delete(k);
    },
  };
}

/** Connect a ws client; resolves once open. Tracked for afterEach cleanup. */
function connect(port: number, path = '/ext'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    liveClients.push(client);
    const timer = setTimeout(() => reject(new Error('connect timed out')), 2000);
    timer.unref?.();
    client.once('open', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Queues parsed JSON messages so fast arrivals are never missed. */
class Inbox {
  private queue: any[] = [];
  private waiters: Array<(m: any) => void> = [];

  constructor(client: WebSocket) {
    client.on('message', (data) => {
      const msg = JSON.parse(String(data));
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
  }

  next(timeoutMs = 2000): Promise<any> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      timer.unref?.();
      this.waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }
}

function waitClose(
  client: WebSocket,
  timeoutMs = 2000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
    timer.unref?.();
    client.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

const send = (client: WebSocket, msg: unknown) => client.send(JSON.stringify(msg));

/** Assert a promise rejects with an Error whose message is EXACTLY `msg`. */
async function expectRejectMessage(p: Promise<unknown>, msg: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    expect((err as Error).message).toBe(msg);
    return;
  }
  throw new Error(`expected rejection with ${JSON.stringify(msg)} but it resolved`);
}

/** Full pair -> paired -> hello -> ready flow on one socket; returns the token. */
async function pairAndHello(client: WebSocket, inbox: Inbox, code: string): Promise<string> {
  send(client, { type: 'pair', code });
  const paired = await inbox.next();
  expect(paired.type).toBe('paired');
  expect(typeof paired.token).toBe('string');
  send(client, { type: 'hello', token: paired.token });
  const ready = await inbox.next();
  expect(ready).toEqual({ type: 'ready', buttons: [] });
  return paired.token as string;
}

/** Fake socket for directly unit-driving attach() without networking. */
function fakeSocket() {
  const sent: any[] = [];
  const ws: WSContext & { sent: any[]; closed?: { code?: number; reason?: string } } = {
    sent,
    send: (d: string) => {
      sent.push(JSON.parse(d));
    },
    close: (code?: number, reason?: string) => {
      ws.closed = { code, reason };
      ws.onclose?.();
    },
    onmessage: null,
    onclose: null,
  };
  return ws;
}

function makePairing() {
  return createPairing(mapStore(new Map<string, string>()));
}

// ---------------------------------------------------------------------------
// Pairing unit tests (socket-free)
// ---------------------------------------------------------------------------

describe('pairing', () => {
  test('start() returns a 6-digit code', () => {
    expect(makePairing().start().code).toMatch(/^\d{6}$/);
  });

  test('redeem returns a token; isValid + paired round-trip', () => {
    const pairing = makePairing();
    expect(pairing.paired()).toBe(false);
    expect(pairing.isValid('anything')).toBe(false);
    const { code } = pairing.start();
    const token = pairing.redeem(code);
    expect(typeof token).toBe('string');
    expect(token!.length).toBeGreaterThan(0);
    expect(pairing.isValid(token!)).toBe(true);
    expect(pairing.isValid('wrong')).toBe(false);
    expect(pairing.paired()).toBe(true);
  });

  test('redeem with unknown code returns null', () => {
    expect(makePairing().redeem('123456')).toBeNull();
  });

  test('codes are single-use', () => {
    const pairing = makePairing();
    const { code } = pairing.start();
    expect(pairing.redeem(code)).not.toBeNull();
    expect(pairing.redeem(code)).toBeNull();
  });

  test('redeem trims whitespace', () => {
    const pairing = makePairing();
    const { code } = pairing.start();
    expect(pairing.redeem(`  ${code}\n`)).not.toBeNull();
  });

  test('start() twice: first code dies, second works', () => {
    const pairing = makePairing();
    const first = pairing.start().code;
    const second = pairing.start().code;
    expect(pairing.redeem(first)).toBeNull();
    expect(pairing.redeem(second)).not.toBeNull();
  });

  test('codes expire after 10 minutes', () => {
    vi.useFakeTimers();
    try {
      const pairing = makePairing();
      const { code } = pairing.start();
      vi.advanceTimersByTime(11 * 60 * 1000);
      expect(pairing.redeem(code)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('code still valid just before expiry', () => {
    vi.useFakeTimers();
    try {
      const pairing = makePairing();
      const { code } = pairing.start();
      vi.advanceTimersByTime(9 * 60 * 1000 + 59 * 1000);
      expect(pairing.redeem(code)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('revoke() forgets the token and kills pending codes', () => {
    const pairing = makePairing();
    const token = pairing.redeem(pairing.start().code)!;
    expect(pairing.paired()).toBe(true);
    const { code: pending } = pairing.start();
    pairing.revoke();
    expect(pairing.paired()).toBe(false);
    expect(pairing.isValid(token)).toBe(false);
    // A pending code must not resurrect a token after revoke.
    expect(pairing.redeem(pending)).toBeNull();
    // Pairing still works after revoke.
    expect(pairing.redeem(pairing.start().code)).not.toBeNull();
    expect(pairing.paired()).toBe(true);
  });
});

describe('settings store', () => {
  test('round-trips and persists across instances on the same db', () => {
    const db = openDb(':memory:');
    try {
      const s1 = createSettingsStore(db);
      expect(s1.get('extension.token')).toBeUndefined();
      s1.set('extension.token', 'tok-1');
      expect(s1.get('extension.token')).toBe('tok-1');
      const s2 = createSettingsStore(db);
      expect(s2.get('extension.token')).toBe('tok-1');
      s2.set('extension.token', 'tok-2');
      expect(s1.get('extension.token')).toBe('tok-2');
    } finally {
      db.close();
    }
  });

  test('del removes the key and ignores missing keys', () => {
    const db = openDb(':memory:');
    try {
      const s = createSettingsStore(db);
      s.del('extension.token');
      s.set('extension.token', 'tok-1');
      s.del('extension.token');
      expect(s.get('extension.token')).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// attach() unit tests with fake sockets (fast, no networking)
// ---------------------------------------------------------------------------

describe('bridge attach() with fakes', () => {
  test('hello with valid token sends ready, marks connected, fires onReady', () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    let readyCount = 0;
    bridge.onReady(() => readyCount++);
    expect(bridge.connected()).toBe(false);

    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));

    expect(ws.sent).toEqual([{ type: 'ready', buttons: [] }]);
    expect(bridge.connected()).toBe(true);
    expect(readyCount).toBe(1);
  });

  test('hello with bad token closes with 4401', () => {
    const bridge = createBridge({ pairing: makePairing() });
    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!(JSON.stringify({ type: 'hello', token: 'nope' }));
    expect(ws.closed?.code).toBe(4401);
    expect(bridge.connected()).toBe(false);
  });

  test('dropActive closes the active socket and fails in-flight calls', async () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    expect(bridge.connected()).toBe(true);
    const callP = bridge.call('gmail', 'draftReply', {});
    const assertion = expect(callP).rejects.toThrow(GMAIL_MSG);
    bridge.dropActive();
    expect(bridge.connected()).toBe(false);
    expect(ws.closed?.code).toBe(4401);
    await assertion;
    // Idempotent with no active socket.
    bridge.dropActive();
    expect(bridge.connected()).toBe(false);
  });

  test('malformed JSON and wrong-direction messages are ignored silently', () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!('not json{{{');
    ws.onmessage!(JSON.stringify({ type: 'cmd', id: 'x', site: 'gmail', action: 'a', input: {} }));
    ws.onmessage!(JSON.stringify({ type: 'bogus' }));
    expect(ws.sent).toEqual([]);
    expect(ws.closed).toBeUndefined();
    // Socket still usable afterwards.
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    expect(ws.sent).toEqual([{ type: 'ready', buttons: [] }]);
  });

  test('pre-auth triggers are dropped; post-auth triggers fire onTrigger', () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    const seen: unknown[] = [];
    bridge.onTrigger((t) => seen.push(t));
    const ws = fakeSocket();
    bridge.attach(ws);
    const trigger = { type: 'trigger', workflowId: 'w', triggerType: 'gmailButton', payload: {} };
    ws.onmessage!(JSON.stringify(trigger));
    expect(seen).toEqual([]);
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    ws.onmessage!(JSON.stringify(trigger));
    expect(seen).toEqual([trigger]);
  });

  test('results with unknown ids are ignored', () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    ws.onmessage!(JSON.stringify({ type: 'result', id: 'nope', ok: true, output: 1 }));
    expect(ws.closed).toBeUndefined();
    expect(bridge.connected()).toBe(true);
  });

  test('same-socket re-hello resends ready without closing', () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    expect(ws.sent).toEqual([
      { type: 'ready', buttons: [] },
      { type: 'ready', buttons: [] },
    ]);
    expect(ws.closed).toBeUndefined();
  });

  test('send() with no socket is a no-op; send-throw clears active', () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    expect(() => bridge.send({ type: 'pong' })).not.toThrow();

    const token = pairing.redeem(pairing.start().code)!;
    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    expect(bridge.connected()).toBe(true);
    bridge.send({ type: 'pong' });
    expect(ws.sent.at(-1)).toEqual({ type: 'pong' });

    ws.send = () => {
      throw new Error('boom');
    };
    bridge.send({ type: 'pong' });
    expect(bridge.connected()).toBe(false);
  });

  test('a throwing onTrigger subscriber does not starve later ones', () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    bridge.onTrigger(() => {
      throw new Error('bad subscriber');
    });
    const seen: unknown[] = [];
    bridge.onTrigger((t) => seen.push(t));
    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    const trigger = { type: 'trigger', workflowId: 'w', triggerType: 'gmailButton', payload: {} };
    expect(() => ws.onmessage!(JSON.stringify(trigger))).not.toThrow();
    expect(seen).toEqual([trigger]);
    // Bridge still functional afterwards.
    ws.onmessage!(JSON.stringify({ type: 'ping' }));
    expect(ws.sent.at(-1)).toEqual({ type: 'pong' });
    expect(bridge.connected()).toBe(true);
  });

  test('a throwing onReady subscriber does not starve later ones', () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    bridge.onReady(() => {
      throw new Error('bad subscriber');
    });
    let readyCount = 0;
    bridge.onReady(() => readyCount++);
    const ws = fakeSocket();
    bridge.attach(ws);
    expect(() => ws.onmessage!(JSON.stringify({ type: 'hello', token }))).not.toThrow();
    expect(readyCount).toBe(1);
    expect(ws.sent).toEqual([{ type: 'ready', buttons: [] }]);
    expect(bridge.connected()).toBe(true);
    // Bridge still functional afterwards.
    ws.onmessage!(JSON.stringify({ type: 'ping' }));
    expect(ws.sent.at(-1)).toEqual({ type: 'pong' });
  });

  test('same-socket re-hello does not fail pending calls', async () => {
    const pairing = makePairing();
    const bridge = createBridge({ pairing });
    const token = pairing.redeem(pairing.start().code)!;
    const ws = fakeSocket();
    bridge.attach(ws);
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    let settled: string | null = null;
    const pending = bridge
      .call('gmail', 'read', {}, 500)
      .then(
        () => 'resolved',
        (err) => `rejected: ${(err as Error).message}`,
      )
      .then((s) => {
        settled = s;
      });
    ws.onmessage!(JSON.stringify({ type: 'hello', token }));
    // Still pending right after re-hello: not failed.
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBeNull();
    await pending;
    expect(settled).toBe(`rejected: ${GMAIL_MSG}`);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: real server on a random port + ws client
// ---------------------------------------------------------------------------

describe('bridge call() with no extension connected', () => {
  test.each([
    ['gmail', GMAIL_MSG],
    ['calendar', CALENDAR_MSG],
    ['meta', META_MSG],
  ] as const)('site %s rejects immediately with the exact message', async (site, msg) => {
    const { bridge } = await setup();
    await expectRejectMessage(bridge.call(site, 'read', {}), msg);
  });
});

describe('bridge over real sockets', () => {
  test('connected silent client: call rejects after timeoutMs', async () => {
    const { pairing, bridge, port } = await setup();
    const client = await connect(port);
    const inbox = new Inbox(client);
    await pairAndHello(client, inbox, pairing.start().code);
    await expectRejectMessage(bridge.call('gmail', 'read', {}, 100), GMAIL_MSG);
  });

  test('result ok:false rejects with the extension error', async () => {
    const { pairing, bridge, port } = await setup();
    const client = await connect(port);
    const inbox = new Inbox(client);
    client.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type === 'cmd') {
        send(client, { type: 'result', id: msg.id, ok: false, error: 'No reply button' });
      }
    });
    await pairAndHello(client, inbox, pairing.start().code);
    await expectRejectMessage(bridge.call('gmail', 'draftReply', { a: 1 }), 'No reply button');
  });

  test('result ok:true resolves with output; cmd carries site/action/input', async () => {
    const { pairing, bridge, port } = await setup();
    const client = await connect(port);
    const inbox = new Inbox(client);
    let seenCmd: any = null;
    client.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type === 'cmd') {
        seenCmd = msg;
        send(client, { type: 'result', id: msg.id, ok: true, output: { x: 1 } });
      }
    });
    await pairAndHello(client, inbox, pairing.start().code);
    await expect(bridge.call('calendar', 'list', { q: 2 })).resolves.toEqual({ x: 1 });
    expect(seenCmd).toMatchObject({ type: 'cmd', site: 'calendar', action: 'list', input: { q: 2 } });
    expect(typeof seenCmd.id).toBe('string');
  });

  test('hello with a bad token is closed with 4401', async () => {
    const { port } = await setup();
    const client = await connect(port);
    const closed = waitClose(client);
    send(client, { type: 'hello', token: 'bad-token' });
    await expect(closed.then((c) => c.code)).resolves.toBe(4401);
  });

  test('pair -> paired{token} -> hello -> ready full flow on one socket', async () => {
    const { pairing, port } = await setup();
    const client = await connect(port);
    const inbox = new Inbox(client);
    const token = await pairAndHello(client, inbox, pairing.start().code);
    expect(pairing.isValid(token)).toBe(true);
  });

  test('ping gets pong pre-auth and post-auth', async () => {
    const { pairing, port } = await setup();
    const client = await connect(port);
    const inbox = new Inbox(client);
    send(client, { type: 'ping' });
    expect(await inbox.next()).toEqual({ type: 'pong' });
    await pairAndHello(client, inbox, pairing.start().code);
    send(client, { type: 'ping' });
    expect(await inbox.next()).toEqual({ type: 'pong' });
  });

  test('pair with a bad code gets no paired reply (and stays connected)', async () => {
    const { port } = await setup();
    const client = await connect(port);
    const inbox = new Inbox(client);
    send(client, { type: 'pair', code: '000000' });
    await expect(inbox.next(200)).rejects.toThrow('timed out waiting for message');
    expect(client.readyState).toBe(WebSocket.OPEN);
  });

  test('disconnect with a pending call rejects with the site message', async () => {
    const { pairing, bridge, port } = await setup();
    const client = await connect(port);
    const inbox = new Inbox(client);
    await pairAndHello(client, inbox, pairing.start().code);
    const pending = bridge.call('meta', 'read', {});
    const assertion = expectRejectMessage(pending, META_MSG);
    client.close();
    await assertion;
    expect(bridge.connected()).toBe(false);
  });

  test('second hello replaces the first socket (4400) and gets ready', async () => {
    const { pairing, bridge, port } = await setup();
    const first = await connect(port);
    const firstInbox = new Inbox(first);
    const token = await pairAndHello(first, firstInbox, pairing.start().code);
    expect(bridge.connected()).toBe(true);

    const second = await connect(port);
    const secondInbox = new Inbox(second);
    const firstClosed = waitClose(first);
    send(second, { type: 'hello', token });
    expect(await secondInbox.next()).toEqual({ type: 'ready', buttons: [] });
    await expect(firstClosed.then((c) => c.code)).resolves.toBe(4400);
    expect(bridge.connected()).toBe(true);
  });

  test('replacement fails the old socket\'s pending calls immediately', async () => {
    const { pairing, bridge, port } = await setup();
    const first = await connect(port);
    const firstInbox = new Inbox(first);
    const token = await pairAndHello(first, firstInbox, pairing.start().code);

    // Pending call that is never answered, with a long timeout.
    const pending = bridge.call('gmail', 'read', {}, 5000);
    const started = Date.now();
    const assertion = expectRejectMessage(pending, GMAIL_MSG);

    const second = await connect(port);
    const secondInbox = new Inbox(second);
    const firstClosed = waitClose(first);
    send(second, { type: 'hello', token });
    expect(await secondInbox.next()).toEqual({ type: 'ready', buttons: [] });

    // Fails fast: well under the 5s timeout, with the exact site message.
    await assertion;
    expect(Date.now() - started).toBeLessThan(2000);
    await expect(firstClosed.then((c) => c.code)).resolves.toBe(4400);
    expect(bridge.connected()).toBe(true);
  });

  test('trigger fires onTrigger after auth (real socket)', async () => {
    const { pairing, bridge, port } = await setup();
    const seen: unknown[] = [];
    bridge.onTrigger((t) => seen.push(t));
    const client = await connect(port);
    const inbox = new Inbox(client);
    await pairAndHello(client, inbox, pairing.start().code);
    const trigger = { type: 'trigger', workflowId: 'w', triggerType: 'gmailButton', payload: { a: 1 } };
    send(client, trigger);
    await vi.waitFor(() => expect(seen).toEqual([trigger]));
  });
});

describe('pairing HTTP routes', () => {
  test('POST /api/pairing/start returns a 6-digit code', async () => {
    const { port } = await setup();
    const res = await fetch(`http://127.0.0.1:${port}/api/pairing/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string };
    expect(body.code).toMatch(/^\d{6}$/);
  });

  test('GET /api/pairing/status tracks paired + connected', async () => {
    const { port } = await setup();
    const status = async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/pairing/status`);
      expect(res.status).toBe(200);
      return (await res.json()) as { paired: boolean; connected: boolean };
    };
    expect(await status()).toEqual({ paired: false, connected: false });

    const startRes = await fetch(`http://127.0.0.1:${port}/api/pairing/start`, { method: 'POST' });
    const { code } = (await startRes.json()) as { code: string };
    const client = await connect(port);
    const inbox = new Inbox(client);
    await pairAndHello(client, inbox, code);
    expect(await status()).toEqual({ paired: true, connected: true });
  });

  test('POST /api/pairing/revoke forgets the token and drops the socket', async () => {
    const { port } = await setup();
    const startRes = await fetch(`http://127.0.0.1:${port}/api/pairing/start`, { method: 'POST' });
    const { code } = (await startRes.json()) as { code: string };
    const client = await connect(port);
    const inbox = new Inbox(client);
    await pairAndHello(client, inbox, code);
    const closedP = waitClose(client);
    const revokeRes = await fetch(`http://127.0.0.1:${port}/api/pairing/revoke`, {
      method: 'POST',
    });
    expect(revokeRes.status).toBe(200);
    expect(await revokeRes.json()).toEqual({ revoked: true });
    expect((await closedP).code).toBe(4401);
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/pairing/status`);
    expect(await statusRes.json()).toEqual({ paired: false, connected: false });
  });
});

describe('unconfigured app (createApp({}))', () => {
  test('POST /api/pairing/start returns 500', async () => {
    const res = await createApp({}).request('/api/pairing/start', { method: 'POST' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Bridge not configured' });
  });

  test('GET /api/pairing/status returns 500', async () => {
    const res = await createApp({}).request('/api/pairing/status');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Bridge not configured' });
  });

  test('POST /api/pairing/revoke returns 500', async () => {
    const res = await createApp({}).request('/api/pairing/revoke', { method: 'POST' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Bridge not configured' });
  });

  test('/ext socket is closed with 1011', async () => {
    const { port } = await setupUnconfigured();
    const client = await connect(port);
    const closed = waitClose(client);
    await expect(closed.then((c) => c.code)).resolves.toBe(1011);
  });
});

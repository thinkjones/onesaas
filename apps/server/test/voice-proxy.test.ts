import { serve, type ServerType } from '@hono/node-server';
import type { AddressInfo, Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createApp, injectAppWebSocket } from '../src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const liveClients: WebSocket[] = [];
const liveServers: ServerType[] = [];
let upstream: WebSocketServer | null = null;
/** Raw upgrade sockets held inside verifyClient by the gated upstream. */
const heldUpgradeSockets = new Set<Socket>();

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
  // A held verifyClient keeps its raw socket open even after the client
  // aborts, which would hang server.close() below: destroy them first.
  for (const s of heldUpgradeSockets) {
    try {
      s.destroy();
    } catch {
      // Already closed.
    }
  }
  heldUpgradeSockets.clear();
  if (upstream) {
    const u = upstream;
    upstream = null;
    await new Promise<void>((resolve) => u.close(() => resolve()));
  }
});

async function waitListening(server: ServerType): Promise<number> {
  if (server.listening) return (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return (server.address() as AddressInfo).port;
}

function nextMessage(ws: WebSocket): Promise<Buffer | string> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data: Buffer | string) => resolve(data));
    ws.once('error', reject);
  });
}

async function nextJson(ws: WebSocket): Promise<unknown> {
  const data = await nextMessage(ws);
  return JSON.parse(String(data));
}

interface FakeUpstream {
  /** Every frame the proxy sent upstream, in arrival order. */
  received: Array<Buffer | string>;
  /** The socket the proxy opened (set once it connects). */
  socket: () => WebSocket;
  /** Resolves when the proxy's handshake frame arrives. */
  handshake: () => Promise<Record<string, unknown>>;
  url: string;
}

/** A fake `wss://api.meta.ai/v1/asr/realtime` the proxy can dial. */
async function startFakeUpstream(): Promise<FakeUpstream> {
  const received: Array<Buffer | string> = [];
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  upstream = server;
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  let socket: WebSocket | null = null;
  let resolveSocket: ((ws: WebSocket) => void) | null = null;
  const socketPromise = new Promise<WebSocket>((resolve) => {
    resolveSocket = resolve;
  });
  let resolveHandshake: ((h: Record<string, unknown>) => void) | null = null;
  const handshakePromise = new Promise<Record<string, unknown>>((resolve) => {
    resolveHandshake = resolve;
  });
  server.on('connection', (ws) => {
    socket = ws;
    resolveSocket?.(ws);
    ws.on('message', (data: Buffer | string) => {
      received.push(data);
      // The handshake is the first JSON text frame.
      if (received.length === 1 && resolveHandshake) {
        resolveHandshake(JSON.parse(String(data)) as Record<string, unknown>);
        resolveHandshake = null;
      }
    });
  });
  return {
    received,
    socket: () => {
      if (!socket) throw new Error('Proxy has not connected upstream yet');
      return socket;
    },
    handshake: () => handshakePromise,
    url: `ws://127.0.0.1:${port}/v1/asr/realtime`,
  };
}

async function startApp(
  upstreamUrl: string,
  apiKey = 'test-key',
  voiceOpts: { connectTimeoutMs?: number; finalWaitTimeoutMs?: number } = {},
): Promise<number> {
  const app = createApp({ voice: { apiKey, upstreamUrl, ...voiceOpts } });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  liveServers.push(server);
  injectAppWebSocket(app, server);
  return waitListening(server);
}

interface GatedUpstream extends FakeUpstream {
  /** Complete the pending HTTP upgrade(s) so the proxy's socket opens. */
  release: () => void;
}

/**
 * A fake upstream that holds every HTTP upgrade until `release()` is
 * called, keeping the proxy's upstream socket in CONNECTING deterministically.
 */
async function startGatedFakeUpstream(): Promise<GatedUpstream> {
  const received: Array<Buffer | string> = [];
  const pending: Array<(ok: boolean) => void> = [];
  const server = new WebSocketServer({
    port: 0,
    host: '127.0.0.1',
    verifyClient: (info, done) => {
      pending.push(done);
      const sock = info.req.socket;
      heldUpgradeSockets.add(sock);
      sock.on('close', () => heldUpgradeSockets.delete(sock));
    },
  });
  upstream = server;
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  let socket: WebSocket | null = null;
  let resolveHandshake: ((h: Record<string, unknown>) => void) | null = null;
  const handshakePromise = new Promise<Record<string, unknown>>((resolve) => {
    resolveHandshake = resolve;
  });
  server.on('connection', (ws) => {
    socket = ws;
    ws.on('message', (data: Buffer | string) => {
      received.push(data);
      if (received.length === 1 && resolveHandshake) {
        resolveHandshake(JSON.parse(String(data)) as Record<string, unknown>);
        resolveHandshake = null;
      }
    });
  });
  return {
    received,
    socket: () => {
      if (!socket) throw new Error('Proxy has not connected upstream yet');
      return socket;
    },
    handshake: () => handshakePromise,
    url: `ws://127.0.0.1:${port}/v1/asr/realtime`,
    release: () => {
      for (const done of pending.splice(0)) done(true);
    },
  };
}

/** Poll the fake upstream's received frames for `{type: 'endStream'}`. */
async function waitForEndStream(
  fake: FakeUpstream,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    for (const d of fake.received) {
      try {
        const o = JSON.parse(String(d)) as Record<string, unknown>;
        if (o['type'] === 'endStream') return o;
      } catch {
        // Binary PCM: not JSON.
      }
    }
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for endStream upstream');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function connectBrowser(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice`);
  liveClients.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

describe('/api/voice proxy', () => {
  test('sends the handshake with the model and the server key', async () => {
    const fake = await startFakeUpstream();
    const port = await startApp(fake.url);
    await connectBrowser(port);

    const handshake = await fake.handshake();
    expect(handshake['model']).toBe('muse-voice-transcribe-1.0');
    const auth = handshake['authorization'] as { accessToken?: string };
    expect(auth.accessToken).toContain('test-key');
  });

  test('forwards a binary PCM frame upstream unchanged', async () => {
    const fake = await startFakeUpstream();
    const port = await startApp(fake.url);
    const browser = await connectBrowser(port);
    await fake.handshake();
    // The ack is the only upstream frame with no `type` field.
    fake.socket().send(JSON.stringify({ sessionId: 's1' }));

    const pcm = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    browser.send(pcm);
    // received[0] is the handshake; the PCM frame follows it.
    const forwarded = await new Promise<Buffer | string>((resolve) => {
      const check = (): void => {
        if (fake.received.length >= 2) return resolve(fake.received[1]!);
        setTimeout(check, 10);
      };
      check();
    });
    expect(Buffer.from(forwarded as Buffer)).toEqual(pcm);
  });

  test('maps an upstream transcript event to {type: final}', async () => {
    const fake = await startFakeUpstream();
    const port = await startApp(fake.url);
    const browser = await connectBrowser(port);
    await fake.handshake();
    fake.socket().send(JSON.stringify({ sessionId: 's1' }));

    fake
      .socket()
      .send(JSON.stringify({ type: 'transcript', transcript: 'hello owner', final: true }));
    expect(await nextJson(browser)).toEqual({ type: 'final', text: 'hello owner' });
  });

  test('maps partials, speechEnd, speechComplete, and errors', async () => {
    const fake = await startFakeUpstream();
    const port = await startApp(fake.url);
    const browser = await connectBrowser(port);
    await fake.handshake();
    fake.socket().send(JSON.stringify({ sessionId: 's1' }));

    fake
      .socket()
      .send(JSON.stringify({ type: 'transcript', transcript: 'hel', final: false }));
    expect(await nextJson(browser)).toEqual({ type: 'partial', text: 'hel' });

    fake.socket().send(JSON.stringify({ type: 'speechEnd', turnId: 1, audioProcessedMs: 10 }));
    expect(await nextJson(browser)).toEqual({ type: 'speechEnd' });

    fake
      .socket()
      .send(
        JSON.stringify({ type: 'speechComplete', turnId: 1, transcript: 'Hello.', audioProcessedMs: 20 }),
      );
    expect(await nextJson(browser)).toEqual({ type: 'final', text: 'Hello.' });

    fake.socket().send(JSON.stringify({ type: 'error', message: 'boom' }));
    expect(await nextJson(browser)).toEqual({ type: 'error', message: 'boom' });
  });

  test('browser stop sends endStream and closes once the final arrives', async () => {
    const fake = await startFakeUpstream();
    const port = await startApp(fake.url);
    const browser = await connectBrowser(port);
    await fake.handshake();
    fake.socket().send(JSON.stringify({ sessionId: 's1' }));

    browser.send(JSON.stringify({ type: 'stop' }));
    // `ws` delivers text frames as Buffer too, so parse every frame.
    const endStream = await new Promise<Record<string, unknown>>((resolve) => {
      const check = (): void => {
        for (const d of fake.received) {
          try {
            const o = JSON.parse(String(d)) as Record<string, unknown>;
            if (o['type'] === 'endStream') return resolve(o);
          } catch {
            // Binary PCM: not JSON.
          }
        }
        setTimeout(check, 10);
      };
      check();
    });
    expect(endStream).toEqual({ type: 'endStream' });

    const closed = new Promise<number>((resolve) => browser.once('close', (code: number) => resolve(code)));
    fake
      .socket()
      .send(
        JSON.stringify({ type: 'speechComplete', turnId: 1, transcript: 'Done.', audioProcessedMs: 5 }),
      );
    expect(await nextJson(browser)).toEqual({ type: 'final', text: 'Done.' });
    expect(await closed).toBe(1000);
  });

  test('stop before upstream accepts still sends endStream once open', async () => {
    const fake = await startGatedFakeUpstream();
    const port = await startApp(fake.url);
    const browser = await connectBrowser(port);

    // The browser stops while the upstream socket is still CONNECTING.
    browser.send(JSON.stringify({ type: 'stop' }));
    await new Promise((r) => setTimeout(r, 100));
    fake.release();

    const handshake = await fake.handshake();
    expect(handshake['model']).toBe('muse-voice-transcribe-1.0');
    expect(await waitForEndStream(fake)).toEqual({ type: 'endStream' });

    // The turn still completes: the final arrives and the socket closes cleanly.
    const closed = new Promise<number>((resolve) =>
      browser.once('close', (code: number) => resolve(code)),
    );
    fake
      .socket()
      .send(
        JSON.stringify({ type: 'speechComplete', turnId: 1, transcript: 'Done.', audioProcessedMs: 5 }),
      );
    expect(await nextJson(browser)).toEqual({ type: 'final', text: 'Done.' });
    expect(await closed).toBe(1000);

    // endStream went upstream exactly once (no duplicate from the open retry).
    const endStreams = fake.received.filter((d) => {
      try {
        return (JSON.parse(String(d)) as Record<string, unknown>)['type'] === 'endStream';
      } catch {
        return false;
      }
    });
    expect(endStreams).toHaveLength(1);
  });

  test('upstream connect hang times out with an error frame and close 1011', async () => {
    const fake = await startGatedFakeUpstream();
    const port = await startApp(fake.url, 'test-key', { connectTimeoutMs: 100 });
    const browser = await connectBrowser(port);
    const closed = new Promise<number>((resolve) =>
      browser.once('close', (code: number) => resolve(code)),
    );

    // The gate is never released: the upstream socket hangs in CONNECTING.
    expect(await nextJson(browser)).toEqual({ type: 'error', message: expect.any(String) });
    expect(await closed).toBe(1011);
  });

  test('no final after endStream times out with an error frame and close 1011', async () => {
    const fake = await startFakeUpstream();
    const port = await startApp(fake.url, 'test-key', { finalWaitTimeoutMs: 150 });
    const browser = await connectBrowser(port);
    await fake.handshake();
    fake.socket().send(JSON.stringify({ sessionId: 's1' }));
    const closed = new Promise<number>((resolve) =>
      browser.once('close', (code: number) => resolve(code)),
    );

    browser.send(JSON.stringify({ type: 'stop' }));
    expect(await waitForEndStream(fake)).toEqual({ type: 'endStream' });

    // Upstream never sends the final: the proxy must bound the wait.
    expect(await nextJson(browser)).toEqual({ type: 'error', message: expect.any(String) });
    expect(await closed).toBe(1011);
  });
});

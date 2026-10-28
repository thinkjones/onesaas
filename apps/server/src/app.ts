import type { ServerType } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Bridge, WSContext as BridgeSocket } from './bridge/bridge.js';
import type { Pairing } from './bridge/pairing.js';
import type { Repo } from './db/repo.js';
import type { createEngine } from './engine/engine.js';
import type { EngineEvent } from './engine/events.js';

// Grows in later tasks (gateway, store, engine, bridge...). Kept as an
// interface so call sites can add fields without changing createApp's shape.
export interface AppDeps {
  [key: string]: unknown;
}

type FullBridge = Bridge & { attach(ws: BridgeSocket): void };

// NOTE: installed @hono/node-ws@1.x requires createNodeWebSocket({ app }) —
// the binding is per app instance, not a module-scope singleton. Each
// createApp() call registers its own injector here; index.ts and tests pass
// their app back to injectAppWebSocket(). Per-app binding is also what keeps
// tests isolated (every test builds its own app + bridge + server).
const injectors = new WeakMap<object, (server: ServerType) => void>();

/** Enable /ext WebSocket upgrades on a server for a createApp() app. */
export function injectAppWebSocket(app: Hono, server: ServerType): void {
  const inject = injectors.get(app);
  if (!inject) throw new Error('WebSocket not configured for this app');
  inject(server);
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  // Deps arrive via the Task 1 index-signature shape; cast on read.
  const pairing = deps.pairing as Pairing | undefined;
  const bridge = deps.bridge as FullBridge | undefined;
  const repo = deps.repo as Repo | undefined;
  const engine = deps.engine as ReturnType<typeof createEngine> | undefined;

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  injectors.set(app, injectWebSocket);

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/api/pairing/start', (c) => {
    if (!pairing) return c.json({ error: 'Bridge not configured' }, 500);
    return c.json(pairing.start());
  });

  // Task 11 contract: { paired, connected }.
  app.get('/api/pairing/status', (c) => {
    if (!pairing || !bridge) return c.json({ error: 'Bridge not configured' }, 500);
    return c.json({ paired: pairing.paired(), connected: bridge.connected() });
  });

  // Task 11 contract. Missing repo/engine deps are a distinct 500 from the
  // bridge's 'Bridge not configured': these routes never touch the bridge.
  app.get('/api/workflows', (c) => {
    if (!repo) return c.json({ error: 'Server not configured' }, 500);
    return c.json(repo.listWorkflows());
  });

  app.get('/api/runs', (c) => {
    if (!repo) return c.json({ error: 'Server not configured' }, 500);
    const workflowId = c.req.query('workflowId');
    return c.json(repo.listRuns(workflowId ? { workflowId } : {}));
  });

  app.get('/api/runs/:id', (c) => {
    if (!repo) return c.json({ error: 'Server not configured' }, 500);
    const id = c.req.param('id');
    const got = repo.getRun(id);
    if (!got) return c.json({ error: `Unknown run: ${id}` }, 404);
    return c.json(got);
  });

  app.get('/api/events', (c) => {
    if (!engine) return c.json({ error: 'Server not configured' }, 500);
    // Verified against the installed hono: streamSSE lives in 'hono/streaming'
    // and writeSSE takes { data }. The stream ends when the client aborts.
    return streamSSE(c, async (stream) => {
      const onEvent = (e: EngineEvent): void => {
        // A write after disconnect rejects; swallow it (the abort below ends
        // the stream) instead of surfacing an unhandled rejection.
        void stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {});
      };
      engine.events.on('event', onEvent);
      try {
        await new Promise<void>((resolve) => {
          if (c.req.raw.signal.aborted) return resolve();
          c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        // Always unsubscribe: one leaked listener per SSE connection would
        // accumulate on the singleton engine's emitter.
        engine.events.off('event', onEvent);
      }
    });
  });

  app.get(
    '/ext',
    upgradeWebSocket(() => {
      if (!bridge) {
        return {
          onOpen(_e: Event, ws: { close(code?: number, reason?: string): void }) {
            ws.close(1011, 'Bridge not configured');
          },
        };
      }
      // One adapter per connection: the bridge drives it via onmessage/onclose.
      let socket: BridgeSocket | null = null;
      return {
        onOpen(
          _e: Event,
          ws: { send(data: string): void; close(code?: number, reason?: string): void },
        ) {
          const s: BridgeSocket = {
            send: (d) => ws.send(d),
            close: (code, reason) => ws.close(code, reason),
          };
          socket = s;
          bridge.attach(s);
        },
        onMessage(e: MessageEvent) {
          socket?.onmessage?.(String(e.data));
        },
        onClose() {
          socket?.onclose?.();
          socket = null;
        },
      };
    }),
  );

  return app;
}

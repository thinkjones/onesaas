import type { ServerType } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import type { Bridge, WSContext as BridgeSocket } from './bridge/bridge.js';
import type { Pairing } from './bridge/pairing.js';

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

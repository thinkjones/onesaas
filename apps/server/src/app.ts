import { Hono } from 'hono';

// Grows in later tasks (gateway, store, engine, bridge...). Kept as an
// interface so call sites can add fields without changing createApp's shape.
export interface AppDeps {
  [key: string]: unknown;
}

export function createApp(_deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  return app;
}

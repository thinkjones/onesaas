import { serve } from '@hono/node-server';
import { injectAppWebSocket } from './app.js';
import { createServer } from './main.js';

const port = 8787;
const hostname = '127.0.0.1';

const { app, engine } = createServer();
// Resume interrupted runs before listening. Lives here (not createServer) so
// the composition root stays synchronous for tests; top-level await is fine
// in this ESM entrypoint.
await engine.resumeAll();
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Server listening on http://${info.address}:${info.port}`);
});
// Enable /ext WebSocket upgrades on this server.
injectAppWebSocket(app, server);

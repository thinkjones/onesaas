import { serve } from '@hono/node-server';
import { createApp, injectAppWebSocket } from './app.js';

const port = 8787;
const hostname = '127.0.0.1';

const app = createApp({});
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Server listening on http://${info.address}:${info.port}`);
});
// Enable /ext WebSocket upgrades on this server (Task 9 wires real deps).
injectAppWebSocket(app, server);

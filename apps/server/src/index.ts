import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = 8787;
const hostname = '127.0.0.1';

serve({ fetch: createApp({}).fetch, port, hostname }, (info) => {
  console.log(`Server listening on http://${info.address}:${info.port}`);
});

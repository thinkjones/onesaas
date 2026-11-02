import { serve } from '@hono/node-server';
import { injectAppWebSocket } from './app.js';
import { createServer } from './main.js';
import { ensureSamplePhoto } from './triggers/upload.js';

const port = Number(process.env['PORT'] ?? 8787);
const hostname = '127.0.0.1';

// PORT/DB_FILE exist for the Playwright suite (apps/e2e), which boots an
// isolated stack on alt ports with a fresh database. Defaults keep `pnpm dev`
// exactly as before. SEED_FLOW1=1 (e2e only) opts into the flow-1 fixture;
// customer boots always start with a blank workflow store.
const { app, engine, files } = createServer({
  dbFile: process.env['DB_FILE'],
  filesDir: process.env['FILES_DIR'],
  seedFlow1: process.env['SEED_FLOW1'] === '1',
});
// Resume interrupted runs before listening. Lives here (not createServer) so
// the composition root stays synchronous for tests; top-level await is fine
// in this ESM entrypoint.
await engine.resumeAll();
// The bundled sample photo backs trigger.upload's catalog sample ("Try it"
// runs reference it), so it must exist before the first request.
await ensureSamplePhoto(files);
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Server listening on http://${info.address}:${info.port}`);
});
// Enable /ext WebSocket upgrades on this server.
injectAppWebSocket(app, server);

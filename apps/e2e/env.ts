import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared ports/paths for the config, global setup, and specs. Deliberately
// NOT the live dev ports (5173/8787): the suite must never attach to a
// developer's running stack or its database.
const here = path.dirname(fileURLToPath(import.meta.url));

/** API (Hono) port for the E2E stack. */
export const API_PORT = 8791;
/** Web (Vite) port for the E2E stack. */
export const WEB_PORT = 5193;

export const API_BASE = `http://127.0.0.1:${API_PORT}`;
export const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;

/** Fresh SQLite file per suite run (deleted by global setup). */
export const DB_FILE = path.join(here, 'test-results', 'e2e.db');

/** Workspace root (webServer commands run from here). */
export const REPO_ROOT = path.resolve(here, '..', '..');

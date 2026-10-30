import { rmSync } from 'node:fs';
import { DB_FILE } from './env.js';

// Runs before the webServers boot: every suite run starts from a fresh
// database (the server seeds flow 1 into an empty store on boot).
export default function setup(): void {
  // Test runs execute ai.* steps for real and the panel test runs a live
  // turn: without a key these fail confusingly mid-suite, so fail fast.
  if (!process.env['MODEL_API_KEY']) {
    throw new Error(
      'E2E requires MODEL_API_KEY (test runs + one agent turn run for real, ~$1 per suite run).',
    );
  }
  rmSync(DB_FILE, { force: true });
}

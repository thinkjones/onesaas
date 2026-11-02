import { defineConfig } from '@playwright/test';
import { API_BASE, DB_FILE, REPO_ROOT, WEB_BASE, WEB_PORT } from './env.js';

export default defineConfig({
  testDir: './tests',
  // One server + one database for the whole run: specs share state and must
  // stay serial. Each spec uses its own workflows (or the stable flow-1 seed)
  // so ordering never matters.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_BASE,
    // Desktop-sized: at 1280px the canvas column is so narrow that step nodes
    // render underneath the right-side panels (unclickable). Dad is desktop.
    viewport: { width: 1600, height: 900 },
    // Video is OFF by default. Record with: pnpm --filter @dad/e2e test:video
    // (sets E2E_VIDEO=1). Files land under test-results/.
    video: process.env['E2E_VIDEO'] === '1' ? 'on' : 'off',
    screenshot: 'only-on-failure',
  },
  globalSetup: './global-setup.ts',
  webServer: [
    {
      command: 'pnpm --filter @dad/server exec tsx src/index.ts',
      cwd: REPO_ROOT,
      // SEED_FLOW1=1 opts into the flow-1 fixture specs share; customer
      // boots (flag absent) always start with a blank workflow store.
      env: { PORT: String(8791), DB_FILE, SEED_FLOW1: '1' },
      url: `${API_BASE}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // --host pins IPv4: bare `localhost` may bind IPv6-only, unreachable via 127.0.0.1.
      command: `pnpm --filter @dad/web exec vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      cwd: REPO_ROOT,
      env: { E2E_API_URL: API_BASE },
      url: `${WEB_BASE}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

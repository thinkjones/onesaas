import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Workflow, catalog } from '@dad/shared';
import OpenAI from 'openai';
import { createConversationStore } from './agent/conversations.js';
import { createBuilderAgent, type BuilderAgent } from './agent/loop.js';
import { createApp } from './app.js';
import { createBridge } from './bridge/bridge.js';
import { createPairing, createSettingsStore, TIMEZONE_KEY } from './bridge/pairing.js';
import { openDb } from './db/connection.js';
import { createRepo } from './db/repo.js';
import { createEngine } from './engine/engine.js';
import { createTestRunner } from './engine/testRun.js';
import { createFileStore } from './files/store.js';
import { createGateway } from './models/gateway.js';
import { createImageModels } from './models/image.js';
import flow1 from './seed/flow1.json' with { type: 'json' };
import { migrateFlow1Seed } from './seed/migrate.js';
import { executors } from './steps/registry.js';
import { createTableStore } from './tables/store.js';
import { createViewStore } from './views/store.js';
import { registerEmailTrigger } from './triggers/email.js';
import { registerGmailButtonTrigger } from './triggers/gmailButton.js';
import { createWorkflowOps } from './workflows/ops.js';

// Warn-once: createServer() runs per test, so an unflagged warn would spam stderr.
let warnedMissingKey = false;

/**
 * Composition root: opens the DB, builds tables/repo/settings/pairing/bridge,
 * gateway/engine, registers triggers, seeds flow 1 + the customers table, and
 * returns the app plus every handle tests need.
 */
export function createServer(opts?: { dbFile?: string; filesDir?: string }): {
  app: ReturnType<typeof createApp>;
  db: ReturnType<typeof openDb>;
  tables: ReturnType<typeof createTableStore>;
  views: ReturnType<typeof createViewStore>;
  repo: ReturnType<typeof createRepo>;
  pairing: ReturnType<typeof createPairing>;
  bridge: ReturnType<typeof createBridge>;
  gateway: ReturnType<typeof createGateway>;
  engine: ReturnType<typeof createEngine>;
  ops: ReturnType<typeof createWorkflowOps>;
  agent: BuilderAgent;
  conversations: ReturnType<typeof createConversationStore>;
  agentEvents: EventEmitter;
  testRun: ReturnType<typeof createTestRunner>['testRun'];
  files: ReturnType<typeof createFileStore>;
} {
  const dbFile = opts?.dbFile ?? 'data/app.db';
  // File DBs need their directory to exist; :memory: has no path to create.
  if (dbFile !== ':memory:') mkdirSync(dirname(dbFile), { recursive: true });
  const db = openDb(dbFile);
  const tables = createTableStore(db);
  const views = createViewStore({ db, tables });
  const repo = createRepo(db);
  // Photo bytes live next to the DB (data/files by default; both gitignored).
  const filesDir = opts?.filesDir ?? 'data/files';
  const files = createFileStore({ db, dir: filesDir });
  const settings = createSettingsStore(db);
  const pairing = createPairing(settings);
  const bridge = createBridge({ pairing });

  const apiKey = process.env['MODEL_API_KEY'];
  // The client requires SOME apiKey string at construction; 'unconfigured' is
  // a placeholder that only surfaces if an AI step actually runs (it fails
  // with an auth error then), so the server still boots for non-AI work.
  if (!apiKey && !warnedMissingKey) {
    warnedMissingKey = true;
    console.warn('MODEL_API_KEY not set — AI steps will fail');
  }
  const openai = new OpenAI({ apiKey: apiKey ?? 'unconfigured', baseURL: 'https://api.meta.ai/v1' });
  const gateway = createGateway({ client: openai });
  const image = createImageModels({ client: openai, fetch, apiKey: apiKey ?? 'unconfigured' });

  // The one StepContext base: the engine and the test runner share it by
  // reference, so a PUT /api/settings updates live runs immediately (the
  // route mutates stepCtx.timezone through setTimezone below). Timezone is
  // the stored business zone, else the server's own Intl zone.
  const stepCtx = {
    gateway,
    tables,
    bridge,
    image,
    files,
    now: () => new Date(),
    timezone: settings.get(TIMEZONE_KEY) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const setTimezone = (tz: string): void => {
    settings.set(TIMEZONE_KEY, tz);
    stepCtx.timezone = tz;
  };
  // Full Task 8 bridge satisfies the registry's { call } surface structurally
  // (proven by the typecheck, not a cast).
  const engine = createEngine({ repo, executors, ctx: stepCtx });
  registerGmailButtonTrigger({ bridge, engine, repo });
  registerEmailTrigger({ bridge, engine, repo, gateway, db });

  // ONE ops for the canvas routes and the builder agent. Dad's edits notify
  // the agent's conversation; the agent's own ops must NOT self-notify.
  const conversations = createConversationStore(db);
  const agentEvents = new EventEmitter();
  agentEvents.setMaxListeners(0); // Singleton + per-connection SSE subscribers: never warn.
  let agent!: BuilderAgent;
  const ops = createWorkflowOps({
    repo,
    tables,
    catalog,
    onChange: (wf, note, by) => {
      if (by === 'dad') agent.noteManualChange(wf.id, note);
    },
  });
  const { testRun } = createTestRunner({ repo, executors, ctx: stepCtx });
  agent = createBuilderAgent({
    gateway,
    ops,
    tables,
    views,
    repo,
    engine,
    events: agentEvents,
    conversations,
    testRun,
  });

  // Seed flow 1 only into an empty workflow store (never overwrite user edits).
  // Workflow.parse fails loud on a broken seed file.
  if (repo.listWorkflows().length === 0) repo.saveWorkflow(Workflow.parse(flow1));
  // Existing installs whose flow-1 predates the approval step move to the new
  // definition as the next version (no-op for fresh seeds and migrated DBs).
  migrateFlow1Seed(repo);
  if (!tables.getTable('customers')) {
    tables.createTable({
      name: 'customers',
      label: 'Customers',
      columns: [
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'need', label: 'Need', type: 'text' },
        { name: 'urgency', label: 'Urgency', type: 'text' },
      ],
      displayField: 'name',
      keyField: 'email',
    });
  }

  // AppDeps grows with the shared ops + agent + test runner; app.ts casts on
  // read per style. The test route reuses this SAME runner (never a second
  // construction with divergent deps).
  const app = createApp({
    bridge,
    pairing,
    repo,
    engine,
    tables,
    views,
    ops,
    agent,
    agentEvents,
    testRun,
    settings,
    setTimezone,
    files,
  });
  return { app, db, tables, views, repo, pairing, bridge, gateway, engine, ops, agent, conversations, agentEvents, testRun, files };
}

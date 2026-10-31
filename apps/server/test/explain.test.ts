import type { Workflow } from '@dad/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb, type Database } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import type { Gateway } from '../src/models/gateway.js';
import { createTableStore, type TableStore } from '../src/tables/store.js';

// M5 Task 6: POST /api/explain — plain-English explanations of this
// business's actual steps, runs, tables and columns via the builder model,
// plus fixed descriptions for UI controls (no model call).

const EXPLAIN_TEXT = 'This step writes a friendly reply draft for each customer email.';

function mkWorkflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Email helper',
    description: 'Help with customer email.',
    version: 1,
    status: 'on',
    trigger: {
      id: 'trigger',
      type: 'trigger.email',
      title: 'New email',
      summary: 'Runs when a new customer email arrives.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [
      {
        id: 'write',
        type: 'ai.write',
        title: 'Write reply',
        summary: 'Drafts a reply.',
        config: { instructions: 'Be warm and brief.', tone: 'friendly' },
        inputs: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [{ from: 'trigger', to: 'write' }],
  };
}

function setup(): {
  db: Database;
  repo: Repo;
  tables: TableStore;
  app: ReturnType<typeof createApp>;
  chatJson: ReturnType<typeof vi.fn>;
  runId: string;
} {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  const tables = createTableStore(db);
  repo.saveWorkflow(mkWorkflow());
  const run = repo.createRun({
    workflowId: 'wf-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'done',
  });
  repo.upsertStepRun({
    id: 'sr-1',
    runId: run.id,
    stepId: 'write',
    status: 'done',
    output: { text: 'Hi there' },
    why: 'Wrote a warm reply to Sarah.',
    startedAt: new Date().toISOString(),
  });
  tables.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
    ],
    displayField: 'name',
    keyField: 'email',
  });
  tables.insert('customers', { name: 'Sarah Lee', email: 'sarah@acme.co' });
  const chatJson = vi.fn(async () => ({ data: { text: EXPLAIN_TEXT } }));
  const app = createApp({ repo, tables, gateway: { chatJson } as unknown as Gateway });
  return { db, repo, tables, app, chatJson, runId: run.id };
}

let db: Database | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

async function postExplain(
  app: ReturnType<typeof createApp>,
  body: unknown,
): Promise<Response> {
  return app.request('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/explain', () => {
  test("kind 'step' passes the step's title, config and last why to the gateway and returns its text", async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'step', id: 'write', context: 'wf-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: EXPLAIN_TEXT });
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    const opts = s.chatJson.mock.calls[0]![0] as { role: unknown; user: unknown };
    expect(opts.role).toBe('builder');
    const user = String(opts.user);
    expect(user).toContain('Write reply');
    expect(user).toContain('Be warm and brief.');
    expect(user).toContain('Wrote a warm reply to Sarah.');
  });

  test('a second identical call hits the cache (gateway called once)', async () => {
    const s = setup();
    db = s.db;
    const body = { kind: 'step', id: 'write', context: 'wf-1' };
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(1);
  });

  test("kind 'ui' returns the fixed description without calling the gateway", async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'ui', id: 'turn-on' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
    expect(s.chatJson).not.toHaveBeenCalled();
  });

  test("kind 'run' passes the run story to the gateway", async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'run', id: s.runId });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: EXPLAIN_TEXT });
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    const opts = s.chatJson.mock.calls[0]![0] as { user: unknown };
    expect(String(opts.user)).toContain('Wrote a warm reply to Sarah.');
  });

  test('an unknown step is a 404 and never reaches the gateway', async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'step', id: 'nope', context: 'wf-1' });
    expect(res.status).toBe(404);
    expect(s.chatJson).not.toHaveBeenCalled();
  });

  test('an invalid body is a 400', async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'step', id: 42 });
    expect(res.status).toBe(400);
    expect(s.chatJson).not.toHaveBeenCalled();
  });
});

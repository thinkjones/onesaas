import type { Workflow } from '@onesaas/shared';
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

  test("kind 'table' passes the label, row count and columns to the gateway", async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'table', id: 'customers' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: EXPLAIN_TEXT });
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    const opts = s.chatJson.mock.calls[0]![0] as { role: unknown; user: unknown };
    expect(opts.role).toBe('builder');
    const user = String(opts.user);
    expect(user).toContain('Customers');
    expect(user).toContain('1 row');
    expect(user).toContain('Name (text)');
    expect(user).toContain('Email (email)');
  });

  test('table explanations are cached per row count: a repeat hits, a new row misses', async () => {
    const s = setup();
    db = s.db;
    const body = { kind: 'table', id: 'customers' };
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    s.tables.insert('customers', { name: 'Tom Ray', email: 'tom@acme.co' });
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(2);
    const opts = s.chatJson.mock.calls[1]![0] as { user: unknown };
    expect(String(opts.user)).toContain('2 rows');
  });

  test('an unknown table is a 404 and never reaches the gateway', async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'table', id: 'nope' });
    expect(res.status).toBe(404);
    expect(s.chatJson).not.toHaveBeenCalled();
  });

  test("kind 'column' passes the column, its list and the row count to the gateway", async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'column', id: 'email', context: 'customers' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: EXPLAIN_TEXT });
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    const opts = s.chatJson.mock.calls[0]![0] as { role: unknown; user: unknown };
    expect(opts.role).toBe('builder');
    const user = String(opts.user);
    expect(user).toContain('Email');
    expect(user).toContain('(email)');
    expect(user).toContain('Customers');
    expect(user).toContain('1 row');
  });

  test('column explanations are cached per row count: a repeat hits, a new row misses', async () => {
    const s = setup();
    db = s.db;
    const body = { kind: 'column', id: 'email', context: 'customers' };
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    s.tables.insert('customers', { name: 'Tom Ray', email: 'tom@acme.co' });
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(2);
    const opts = s.chatJson.mock.calls[1]![0] as { user: unknown };
    expect(String(opts.user)).toContain('2 rows');
  });

  test('an unknown column (or list) is a 404 and never reaches the gateway', async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'column', id: 'nope', context: 'customers' });
    expect(res.status).toBe(404);
    const res2 = await postExplain(s.app, { kind: 'column', id: 'email', context: 'nope' });
    expect(res2.status).toBe(404);
    expect(s.chatJson).not.toHaveBeenCalled();
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

  test('a new run with a fresh why invalidates the step cache', async () => {
    const s = setup();
    db = s.db;
    const body = { kind: 'step', id: 'write', context: 'wf-1' };
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    const run = s.repo.createRun({
      workflowId: 'wf-1',
      workflowVersion: 1,
      triggerPayload: {},
      status: 'done',
    });
    s.repo.upsertStepRun({
      id: 'sr-2',
      runId: run.id,
      stepId: 'write',
      status: 'done',
      output: { text: 'Hello again' },
      why: 'Wrote a warmer reply to Tom.',
      startedAt: new Date(Date.now() + 1000).toISOString(),
    });
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(2);
    const opts = s.chatJson.mock.calls[1]![0] as { user: unknown };
    expect(String(opts.user)).toContain('Wrote a warmer reply to Tom.');
  });

  test('a workflow version bump invalidates the step cache', async () => {
    const s = setup();
    db = s.db;
    const body = { kind: 'step', id: 'write', context: 'wf-1' };
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    const wf = s.repo.getWorkflow('wf-1')!;
    s.repo.saveWorkflow({ ...wf, name: 'Email helper v2' });
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(2);
  });

  test('a run status change invalidates the run cache', async () => {
    const s = setup();
    db = s.db;
    const body = { kind: 'run', id: s.runId };
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(1);
    s.repo.updateRun(s.runId, { status: 'failed' });
    expect((await postExplain(s.app, body)).status).toBe(200);
    expect(s.chatJson).toHaveBeenCalledTimes(2);
  });

  test('an in-place row edit invalidates the table cache', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-30T10:00:00.000Z'));
      const s = setup();
      db = s.db;
      const body = { kind: 'table', id: 'customers' };
      expect((await postExplain(s.app, body)).status).toBe(200);
      expect(s.chatJson).toHaveBeenCalledTimes(1);
      // Same row count, new content: the upsert bumps updated_at.
      vi.setSystemTime(new Date('2026-10-30T10:00:05.000Z'));
      s.tables.upsert('customers', { name: 'Sarah Jones', email: 'sarah@acme.co' }, 'email');
      expect((await postExplain(s.app, body)).status).toBe(200);
      expect(s.chatJson).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a step that never ran explains from its settings alone', async () => {
    const s = setup();
    db = s.db;
    const wf = s.repo.getWorkflow('wf-1')!;
    s.repo.saveWorkflow({
      ...wf,
      steps: [
        ...wf.steps,
        {
          id: 'read',
          type: 'ai.extract',
          title: 'Read details',
          summary: 'Reads details out of text.',
          config: { instructions: 'Read it.' },
          inputs: {},
          position: { x: 0, y: 0 },
        },
      ],
    });
    const res = await postExplain(s.app, { kind: 'step', id: 'read', context: 'wf-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: EXPLAIN_TEXT });
    const opts = s.chatJson.mock.calls[0]![0] as { user: unknown };
    const user = String(opts.user);
    expect(user).toContain('Read details');
    expect(user).toContain('It has not run yet.');
  });

  test("the trigger explains as a step (its own title and summary)", async () => {
    const s = setup();
    db = s.db;
    const res = await postExplain(s.app, { kind: 'step', id: 'trigger', context: 'wf-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: EXPLAIN_TEXT });
    const opts = s.chatJson.mock.calls[0]![0] as { user: unknown };
    const user = String(opts.user);
    expect(user).toContain('New email');
    expect(user).toContain('Runs when a new customer email arrives.');
  });

  test('a missing id or context is a 400 and never reaches the gateway', async () => {
    const s = setup();
    db = s.db;
    const bodies: unknown[] = [
      { kind: 'step' },
      { kind: 'step', id: 'write' },
      { kind: 'run' },
      { kind: 'table' },
      { kind: 'column' },
      { kind: 'column', id: 'email' },
      { kind: 'ui' },
    ];
    for (const body of bodies) {
      expect((await postExplain(s.app, body)).status).toBe(400);
    }
    expect(s.chatJson).not.toHaveBeenCalled();
  });

  test('an unknown run or UI control is a 404 and never reaches the gateway', async () => {
    const s = setup();
    db = s.db;
    expect((await postExplain(s.app, { kind: 'run', id: 'nope' })).status).toBe(404);
    expect((await postExplain(s.app, { kind: 'ui', id: 'nope' })).status).toBe(404);
    expect(s.chatJson).not.toHaveBeenCalled();
  });
});

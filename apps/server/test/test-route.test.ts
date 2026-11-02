import { openDb } from '../src/db/connection.js';
import { createRepo } from '../src/db/repo.js';
import { TEST_SAMPLE_PREFIX } from '../src/engine/story.js';
import { createServer } from '../src/main.js';

// The old runs table shape, before the `used_sample` column (M3 Task 6).
// Column list mirrors repo.ts DDL minus used_sample.
const OLD_RUNS_DDL = `
CREATE TABLE "runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflow_id" TEXT NOT NULL,
  "workflow_version" INTEGER NOT NULL,
  "trigger_payload" TEXT,
  "status" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'live',
  "started_at" TEXT NOT NULL,
  "ended_at" TEXT
);
`;

test('POST /api/workflows/:id/test on an unknown workflow is a 404', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/workflows/nope/test', { method: 'POST' });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Unknown workflow: nope' });
});

test('POST /api/workflows/:id/test runs the shared runner and returns run + steps + story', async () => {
  const { app, ops } = createServer({ dbFile: ':memory:' });
  // A manual trigger with no steps runs with no model calls.
  const wf = ops.create({ name: 'Blank', description: 'Blank.' });

  const res = await app.request(`/api/workflows/${wf.id}/test`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    run: { id: string; kind: string; status: string; usedSample: boolean };
    steps: Array<{ stepId: string; status: string }>;
    usedSample: boolean;
    story: string[];
  };
  expect(body.run.kind).toBe('test');
  expect(body.run.status).toBe('done');
  expect(body.usedSample).toBe(false);
  expect(body.story).toEqual([wf.trigger.summary]);
  expect(body.steps.map((s) => [s.stepId, s.status])).toEqual([['trigger', 'done']]);
});

test('POST /api/workflows/:id/test falls back to the sample email when Gmail is not open', async () => {
  const { app, ops } = createServer({ dbFile: ':memory:' });
  const wf = ops.create({ name: 'Email flow', description: 'Email flow.' });
  const swapped = ops.setTrigger(wf.id, { type: 'trigger.gmailButton', config: { label: 'Test' } });
  expect(swapped.ok).toBe(true);

  // The composition-root bridge is disconnected, so no open email is readable.
  const res = await app.request(`/api/workflows/${wf.id}/test`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    run: { id: string; kind: string; status: string; usedSample: boolean };
    usedSample: boolean;
    story: string[];
  };
  expect(body.usedSample).toBe(true);
  expect(body.run.usedSample).toBe(true);
  expect(body.run.status).toBe('done');
  expect(body.story[0]).toBe(TEST_SAMPLE_PREFIX);
});

test('refetching a sample-backed test run keeps the "sample email" story line', async () => {
  const { app, ops } = createServer({ dbFile: ':memory:' });
  const wf = ops.create({ name: 'Email flow', description: 'Email flow.' });
  ops.setTrigger(wf.id, { type: 'trigger.gmailButton', config: { label: 'Test' } });

  const tested = await app.request(`/api/workflows/${wf.id}/test`, { method: 'POST' });
  const first = (await tested.json()) as { run: { id: string }; story: string[] };
  expect(first.story[0]).toBe(TEST_SAMPLE_PREFIX);

  // A fresh GET of the run detail must NOT lose the prefix (used_sample persisted).
  const refetch = await app.request(`/api/runs/${first.run.id}`);
  expect(refetch.status).toBe(200);
  const second = (await refetch.json()) as { run: { usedSample: boolean }; story: string[] };
  expect(second.run.usedSample).toBe(true);
  expect(second.story[0]).toBe(TEST_SAMPLE_PREFIX);
});

test('usedSample defaults to false and round-trips through updateRun', () => {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  const run = repo.createRun({
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'running',
  });
  expect(run.usedSample).toBe(false);
  expect(repo.getRun(run.id)!.run.usedSample).toBe(false);
  repo.updateRun(run.id, { usedSample: true });
  expect(repo.getRun(run.id)!.run.usedSample).toBe(true);
});

test('opening an old DB without used_sample backfills the column (old runs read false)', () => {
  const db = openDb(':memory:');
  db.exec(OLD_RUNS_DDL);
  db.prepare(
    `INSERT INTO "runs" ("id", "workflow_id", "workflow_version", "trigger_payload", "status", "kind", "started_at", "ended_at")
     VALUES ('run-old', 'flow-1', 1, '{}', 'done', 'live', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:01.000Z')`,
  ).run();

  const repo = createRepo(db);
  const cols = db.prepare(`PRAGMA table_info("runs")`).all() as { name: string }[];
  expect(cols.some((c) => c.name === 'used_sample')).toBe(true);
  // The pre-existing row reads back with usedSample false (column default).
  expect(repo.getRun('run-old')!.run.usedSample).toBe(false);
  // And the backfilled table accepts writes to the new column.
  repo.updateRun('run-old', { usedSample: true });
  expect(repo.getRun('run-old')!.run.usedSample).toBe(true);
});

test('a live run refetch carries no sample prefix', async () => {
  const { app, repo } = createServer({ dbFile: ':memory:', seedFlow1: true });
  const run = repo.createRun({
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: { payload: {} },
    status: 'done',
  });
  const res = await app.request(`/api/runs/${run.id}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { run: { usedSample: boolean }; story: string[] };
  expect(body.run.usedSample).toBe(false);
  expect(body.story[0]).not.toBe(TEST_SAMPLE_PREFIX);
});

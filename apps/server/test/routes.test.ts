import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { createServer } from '../src/main.js';

test('startup seeds flow-1 and the customers table', async () => {
  const { tables, repo } = createServer({ dbFile: ':memory:' });
  expect(repo.getWorkflow('flow-1')?.status).toBe('on');
  expect(tables.getTable('customers')).toMatchObject({
    name: 'customers',
    displayField: 'name',
    keyField: 'email',
  });
});

test('a second boot against the same file db does not reseed or duplicate', async () => {
  // :memory: DBs cannot be shared across createServer calls, so this test
  // needs a real tmp file both boots open.
  const dbFile = join(tmpdir(), `routes-seed-twice-${randomUUID()}.db`);
  const first = createServer({ dbFile });
  try {
    const second = createServer({ dbFile });
    try {
      expect(second.repo.listWorkflows()).toHaveLength(1);
      expect(second.repo.getWorkflow('flow-1')?.version).toBe(1);
      expect(second.tables.getTable('customers')).toMatchObject({ name: 'customers' });
    } finally {
      second.db.close();
    }
  } finally {
    first.db.close();
    rmSync(dbFile, { force: true });
    rmSync(`${dbFile}-wal`, { force: true });
    rmSync(`${dbFile}-shm`, { force: true });
  }
});

test('GET /api/workflows contains the seeded flow-1', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/workflows');
  expect(res.status).toBe(200);
  const body = (await res.json()) as Array<{ id: string; status: string }>;
  expect(body.find((w) => w.id === 'flow-1')?.status).toBe('on');
});

test('GET /api/runs filters by workflowId', async () => {
  const { app, repo } = createServer({ dbFile: ':memory:' });
  const empty = await app.request('/api/runs?workflowId=flow-1');
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual([]);
  const run = repo.createRun({
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: { email: { threadId: 't-1' } },
    status: 'running',
  });
  repo.createRun({
    workflowId: 'other',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'running',
  });
  const res = await app.request('/api/runs?workflowId=flow-1');
  expect(res.status).toBe(200);
  const body = (await res.json()) as Array<{ id: string }>;
  expect(body.map((r) => r.id)).toEqual([run.id]);
});

test('GET /api/runs/:id returns { run, steps, story, workflow } or an exact 404', async () => {
  const { app, repo } = createServer({ dbFile: ':memory:' });
  const run = repo.createRun({
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: {},
    status: 'running',
  });
  const ok = await app.request(`/api/runs/${run.id}`);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({
    run: { ...run },
    steps: [],
    story: ['Runs when you click the button in Gmail.'],
    workflow: repo.getWorkflow('flow-1', 1),
  });
  const missing = await app.request('/api/runs/does-not-exist');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: 'Unknown run: does-not-exist' });
});

test('GET /api/events streams engine events as SSE', async () => {
  const { app, repo, engine } = createServer({ dbFile: ':memory:' });
  const run = repo.createRun({
    workflowId: 'flow-1',
    workflowVersion: 1,
    triggerPayload: { email: { threadId: 't-1' } },
    status: 'running',
  });
  const res = await app.request('/api/events');
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  try {
    const first = reader.read();
    // Let the stream subscribe before emitting; the first read pulls the stream.
    await new Promise((r) => setTimeout(r, 50));
    engine.events.emit('event', { type: 'run', run });
    const { value } = await first;
    const text = new TextDecoder().decode(value);
    expect(text).toContain('data: ');
    expect(text).toContain(run.id);
    const dataLine = text
      .split('\n')
      .find((line) => line.startsWith('data: '))!
      .slice('data: '.length);
    expect(JSON.parse(dataLine)).toEqual({ type: 'run', run: JSON.parse(JSON.stringify(run)) });
  } finally {
    await reader.cancel();
  }
}, 5000);

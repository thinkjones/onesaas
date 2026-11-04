import { serve } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, vi } from 'vitest';
import { createServer } from '../src/main.js';

test('startup leaves a blank workflow store and seeds the customers table', async () => {
  const { tables, repo } = createServer({ dbFile: ':memory:' });
  expect(repo.listWorkflows()).toEqual([]);
  expect(tables.getTable('customers')).toMatchObject({
    name: 'customers',
    displayField: 'name',
    keyField: 'email',
  });
});

test('startup with seedFlow1 seeds the flow-1 fixture (demos, e2e)', async () => {
  const { repo } = createServer({ dbFile: ':memory:', seedFlow1: true });
  expect(repo.getWorkflow('flow-1')?.status).toBe('on');
});

test('a second boot against the same file db does not reseed or duplicate', async () => {
  // :memory: DBs cannot be shared across createServer calls, so this test
  // needs a real tmp file both boots open.
  const dbFile = join(tmpdir(), `routes-seed-twice-${randomUUID()}.db`);
  const first = createServer({ dbFile, seedFlow1: true });
  try {
    const second = createServer({ dbFile, seedFlow1: true });
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

test('GET /api/workflows is empty on a fresh store', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/workflows');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
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
  // The story + workflow halves need a real workflow: opt into the fixture.
  const { app, repo } = createServer({ dbFile: ':memory:', seedFlow1: true });
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

test('GET /api/settings returns the default document on a fresh server', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/settings');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    timezone: '',
    textSize: 'normal',
    onboarded: false,
    moodFileIds: [],
    vertical: null,
    interests: [],
    interestsNote: '',
  });
});

test('PUT /api/settings merges a patch and GET reads it back', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const put = await app.request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: 'Corner Bakery',
      timezone: 'America/New_York',
      textSize: 'large',
    }),
  });
  expect(put.status).toBe(200);
  const body = (await put.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    businessName: 'Corner Bakery',
    timezone: 'America/New_York',
    textSize: 'large',
  });
  const get = await app.request('/api/settings');
  expect(await get.json()).toEqual(body);
});

test('PUT /api/settings accepts an empty patch as a no-op', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const before = await (await app.request('/api/settings')).json();
  const put = await app.request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual(before);
});

test('PUT /api/settings rejects empty and mistyped timezones', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  for (const body of ['{"timezone":""}', '{"timezone":42}']) {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(res.status).toBe(400);
  }
});

test('PUT /api/settings rejects whitespace-only and non-IANA zones and persists nothing', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const put = (timezone: string) =>
    app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone }),
    });
  // Whitespace-only, unknown zones, and padded-but-real zones all 400: every
  // one of these throws in Intl.DateTimeFormat and would poison AI steps.
  for (const tz of ['   ', '\t', 'Mars/Olympus', 'America/New_York ', ' Europe/Paris']) {
    expect((await put(tz)).status).toBe(400);
  }
  expect(
    ((await (await app.request('/api/settings')).json()) as Record<string, unknown>)['timezone'],
  ).toBe('');
  // A valid zone still stores, and a later invalid PUT leaves it untouched.
  expect((await put('Europe/Paris')).status).toBe(200);
  expect((await put('Mars/Olympus')).status).toBe(400);
  expect(
    ((await (await app.request('/api/settings')).json()) as Record<string, unknown>)['timezone'],
  ).toBe('Europe/Paris');
});

test('PUT /api/settings rejects bad text size, legacy theme and unknown keys', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const before = await (await app.request('/api/settings')).json();
  for (const body of [
    '{"theme":"evening"}',
    '{"textSize":"huge"}',
    '{"sound":{"on":true,"volume":0.5}}',
    '{"onboarded":"yes"}',
    '{"bogus":1}',
  ]) {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(res.status).toBe(400);
  }
  // Failed patches persist nothing.
  expect(await (await app.request('/api/settings')).json()).toEqual(before);
});

test('POST /api/app/focus broadcasts to SSE listeners and reports desktop presence', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const focus = () =>
    app.request('/api/app/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/settings', hash: 'chrome-extension' }),
    });

  // No listeners: nothing to focus.
  expect((await focus()).status).toBe(200);
  expect(await (await focus()).json()).toEqual({ focused: false });

  // An untagged (browser) listener is not a desktop window.
  const plain = await app.request('/api/events');
  const plainReader = plain.body!.getReader();
  try {
    await new Promise((r) => setTimeout(r, 50));
    expect(await (await focus()).json()).toEqual({ focused: false });

    // A desktop-tagged listener counts — and receives the event.
    const res = await app.request('/api/events?client=tauri');
    const reader = res.body!.getReader();
    try {
      const first = reader.read();
      await new Promise((r) => setTimeout(r, 50));
      expect(await (await focus()).json()).toEqual({ focused: true });
      const { value } = await first;
      const text = new TextDecoder().decode(value);
      const dataLine = text
        .split('\n')
        .find((line) => line.startsWith('data: '))!
        .slice('data: '.length);
      expect(JSON.parse(dataLine)).toEqual({
        type: 'app-focus',
        path: '/settings',
        hash: 'chrome-extension',
      });
    } finally {
      await reader.cancel();
    }
  } finally {
    await plainReader.cancel();
  }
}, 8000);

test('desktop presence clears when the tagged SSE stream disconnects (real server)', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  try {
    if (!server.listening) {
      await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    }
    const port = (server.address() as AddressInfo).port;
    const sse = await fetch(`http://127.0.0.1:${port}/api/events?client=tauri`);
    const reader = sse.body!.getReader();
    const focus = () =>
      fetch(`http://127.0.0.1:${port}/api/app/focus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/settings' }),
      }).then((r) => r.json());
    await vi.waitFor(async () => {
      expect(await focus()).toEqual({ focused: true });
    });
    await reader.cancel();
    await vi.waitFor(async () => {
      expect(await focus()).toEqual({ focused: false });
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 8000);

test('POST /api/app/focus rejects malformed bodies and paths', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const post = (body: unknown) =>
    app.request('/api/app/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  expect((await post({ path: 'settings' })).status).toBe(400);
  expect((await post({ path: '/a b' })).status).toBe(400);
  expect((await post({ path: '/../x' })).status).toBe(400);
  expect((await post({ path: '/settings', hash: 'a b' })).status).toBe(400);
  expect((await post({ path: '/settings', hash: '#x' })).status).toBe(400);
  expect((await post({})).status).toBe(400);
  expect((await post('nope')).status).toBe(400);
  // A clean request with no listeners still reports honestly.
  const ok = await post({ path: '/settings' });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ focused: false });
});

test('DELETE /api/workflows/:id removes the workflow, its runs, steps, and conversation', async () => {
  const { app, repo, conversations } = createServer({ dbFile: ':memory:' });
  const wf = repo.createWorkflow({ name: 'Doomed', description: '' });
  const run = repo.createRun({
    workflowId: wf.id,
    workflowVersion: 1,
    triggerPayload: {},
    status: 'done',
  });
  repo.upsertStepRun({
    id: randomUUID(),
    runId: run.id,
    stepId: 'trigger',
    status: 'done',
    startedAt: new Date().toISOString(),
  });
  conversations.save(wf.id, { messages: [], transcript: [] });
  const other = repo.createWorkflow({ name: 'Spared', description: '' });

  const res = await app.request(`/api/workflows/${wf.id}`, { method: 'DELETE' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: true });
  expect(repo.getWorkflow(wf.id)).toBeUndefined();
  expect(repo.getRun(run.id)).toBeUndefined();
  expect(repo.listRuns({ workflowId: wf.id })).toEqual([]);
  expect(conversations.load(wf.id)).toBeUndefined();
  expect(repo.getWorkflow(other.id)?.name).toBe('Spared');
});

test('DELETE /api/workflows/:id is 404 for unknown ids', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/workflows/nope', { method: 'DELETE' });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Unknown workflow: nope' });
});

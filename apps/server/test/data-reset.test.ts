import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { createServer } from '../src/main.js';
import { defaultSettings } from '../src/settings/store.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'onesaas-data-reset-'));
  const server = createServer({ dbFile: join(dir, 'app.db'), filesDir: join(dir, 'files') });
  return { dir, server };
}

function count(server: ReturnType<typeof createServer>, table: string): number {
  return (server.db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
}

test('POST /api/data/reset is 500 without the reset dep', async () => {
  const res = await createApp({}).request('/api/data/reset', { method: 'POST' });
  expect(res.status).toBe(500);
});

test('POST /api/data/reset wipes user data back to fresh-install state', async () => {
  const { dir, server } = setup();
  try {
    // Dirty every corner of the state a reset must clear.
    const extra = server.repo.createWorkflow({ name: 'Extra chore', description: 'doomed' });
    server.repo.createRun({ workflowId: extra.id, workflowVersion: 1, status: 'done' });
    server.tables.createTable({
      name: 'projects',
      label: 'Projects',
      columns: [{ name: 'title', label: 'Title', type: 'text' }],
      displayField: 'title',
      keyField: 'title',
    });
    server.tables.insert('projects', { title: 'doomed row' });
    server.tables.insert('customers', {
      name: 'Doomed Customer',
      email: 'doomed@example.com',
      need: 'x',
      urgency: 'low',
    });
    server.views.save({ table: 'customers', kind: 'grid', config: {}, pinned: false, title: 'v' });
    const { code } = server.pairing.start();
    expect(server.pairing.redeem(code)).not.toBeNull();
    expect(server.pairing.paired()).toBe(true);
    await server.app.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ textSize: 'large', onboarded: true, businessName: 'Doomed Co' }),
    });
    await server.files.saveGenerated(Buffer.from('fake-bytes'), 'image/png', 'test');
    writeFileSync(join(dir, 'files', 'stray.bin'), 'stray');

    const res = await server.app.request('/api/data/reset', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Fresh-install state: a blank workflow store; everything else is gone.
    expect(server.repo.listWorkflows()).toEqual([]);
    expect(count(server, 'runs')).toBe(0);
    expect(count(server, 'step_runs')).toBe(0);
    expect(count(server, 'seen_emails')).toBe(0);
    expect(count(server, 'views')).toBe(0);
    expect(count(server, 'conversations')).toBe(0);
    expect(count(server, 'files')).toBe(0);
    expect(count(server, 'settings')).toBe(1); // defaults doc re-persisted by the reset
    expect(server.pairing.paired()).toBe(false);
    expect(server.tables.listTables().map((t) => t.name)).toEqual(['customers']);
    expect(server.tables.query('customers')).toEqual([]);
    expect(readdirSync(join(dir, 'files'))).toEqual([]);

    const settings = await server.app.request('/api/settings');
    expect(await settings.json()).toEqual(defaultSettings());

    // Idempotent: a second reset is a no-op 200.
    const again = await server.app.request('/api/data/reset', { method: 'POST' });
    expect(again.status).toBe(200);
    expect(server.repo.listWorkflows()).toEqual([]);
  } finally {
    server.db.close();
  }
});

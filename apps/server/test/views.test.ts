import { openDb } from '../src/db/connection.js';
import { createServer } from '../src/main.js';
import { createTableStore } from '../src/tables/store.js';
import { createViewStore, type ViewDef } from '../src/views/store.js';

const NOW = new Date('2026-10-28T12:00:00Z');

function setup() {
  const db = openDb(':memory:');
  const tables = createTableStore(db);
  tables.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'amount', label: 'Amount', type: 'number' },
    ],
    displayField: 'name',
  });
  const views = createViewStore({ db, tables, now: () => NOW });
  return { db, tables, views };
}

function backdate(db: ReturnType<typeof openDb>, id: number, iso: string): void {
  db.prepare('UPDATE "t_customers" SET "created_at" = ? WHERE "id" = ?').run(iso, id);
}

test("compute counts only rows created in the last 7 days (fixed clock)", () => {
  const { db, tables, views } = setup();
  const fresh = tables.insert('customers', { name: 'New', amount: 10 });
  const old = tables.insert('customers', { name: 'Old', amount: 20 });
  backdate(db, fresh.id, '2026-10-27T12:00:00Z');
  backdate(db, old.id, '2026-10-01T12:00:00Z');
  const view: ViewDef = {
    id: 'v1',
    table: 'customers',
    kind: 'stat',
    title: 'New this week',
    pinned: true,
    config: { stat: { op: 'count', sinceDays: 7 } },
  };
  expect(views.compute(view)).toEqual({ value: 1 });
});

test('compute sums a number column', () => {
  const { tables, views } = setup();
  tables.insert('customers', { name: 'A', amount: 10 });
  tables.insert('customers', { name: 'B', amount: 25 });
  const view: ViewDef = {
    id: 'v1',
    table: 'customers',
    kind: 'stat',
    title: 'Total',
    pinned: false,
    config: { stat: { op: 'sum', column: 'amount' } },
  };
  expect(views.compute(view)).toEqual({ value: 35 });
});

test('save/list/remove round-trips a view', () => {
  const { views } = setup();
  const saved = views.save({
    table: 'customers',
    kind: 'cards',
    title: 'All customers',
    pinned: false,
    config: { columns: ['name'] },
  });
  expect(saved.id).toMatch(/./);
  expect(views.list()).toEqual([saved]);
  views.remove(saved.id);
  expect(views.list()).toEqual([]);
});

test('save refuses an unknown table', () => {
  const { views } = setup();
  expect(() =>
    views.save({ table: 'nope', kind: 'grid', title: 'X', pinned: false, config: {} }),
  ).toThrow('Unknown table: nope');
});

test('save refuses a stat view without a stat config', () => {
  const { views } = setup();
  expect(() =>
    views.save({ table: 'customers', kind: 'stat', title: 'X', pinned: true, config: {} }),
  ).toThrow("Stat views need a stat config with op 'count' or 'sum'.");
});

test('remove of an unknown view throws', () => {
  const { views } = setup();
  expect(() => views.remove('missing')).toThrow('Unknown view: missing');
});

test('compute for a grid view returns all rows', () => {
  const { tables, views } = setup();
  tables.insert('customers', { name: 'A', amount: 1 });
  tables.insert('customers', { name: 'B', amount: 2 });
  const view: ViewDef = {
    id: 'v1',
    table: 'customers',
    kind: 'grid',
    title: 'All',
    pinned: false,
    config: {},
  };
  const out = views.compute(view);
  expect(out.rows).toHaveLength(2);
});

test('GET /api/lists returns tables with row counts', async () => {
  const { app, tables } = createServer({ dbFile: ':memory:' });
  tables.insert('customers', { name: 'A', email: 'a@x.com', need: 'x', urgency: 'low' });
  const res = await app.request('/api/lists');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { name: string; count: number }[];
  expect(body.find((t) => t.name === 'customers')).toMatchObject({ count: 1 });
});

test('GET /api/lists/:table/rows pages with limit and offset', async () => {
  const { app, tables } = createServer({ dbFile: ':memory:' });
  tables.insert('customers', { name: 'A', email: 'a@x.com', need: 'x', urgency: 'low' });
  tables.insert('customers', { name: 'B', email: 'b@x.com', need: 'y', urgency: 'low' });
  const res = await app.request('/api/lists/customers/rows?limit=1&offset=1');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: { name: string }[]; total: number };
  expect(body.total).toBe(2);
  expect(body.rows).toHaveLength(1);
  expect(body.rows[0]!['name']).toBe('B');
});

test('GET /api/lists/:table/rows on an unknown table is a 404', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/lists/nope/rows');
  expect(res.status).toBe(404);
});

test('views routes round-trip: POST, GET, data, DELETE', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const created = await app.request('/api/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table: 'customers',
      kind: 'stat',
      title: 'All customers',
      pinned: true,
      config: { stat: { op: 'count' } },
    }),
  });
  expect(created.status).toBe(200);
  const view = (await created.json()) as ViewDef;
  expect(view.pinned).toBe(true);

  const listed = await app.request('/api/views');
  expect(((await listed.json()) as ViewDef[]).map((v) => v.id)).toContain(view.id);

  const data = await app.request(`/api/views/${view.id}/data`);
  expect(data.status).toBe(200);
  expect(await data.json()).toEqual({ value: 0 });

  const removed = await app.request(`/api/views/${view.id}`, { method: 'DELETE' });
  expect(removed.status).toBe(200);
  const missing = await app.request(`/api/views/${view.id}/data`);
  expect(missing.status).toBe(404);
});

test('POST /api/views with a bad body is a 400', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: 'customers' }),
  });
  expect(res.status).toBe(400);
});

test('save rejects an operator-shaped where value (mirrors query_table)', () => {
  const { views } = setup();
  expect(() =>
    views.save({
      table: 'customers',
      kind: 'stat',
      title: 'X',
      pinned: true,
      config: { stat: { op: 'count', where: { name: { $ne: 'Sam' } } } },
    }),
  ).toThrow('Invalid where value for column name');
});

test('POST /api/views with an operator where value is a 400 and saves nothing', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table: 'customers',
      kind: 'stat',
      title: 'X',
      pinned: true,
      config: { stat: { op: 'count', where: { name: { $ne: 'Sam' } } } },
    }),
  });
  expect(res.status).toBe(400);
  expect((await res.json()) as { error: string }).toMatchObject({
    error: expect.stringContaining('Invalid where value for column name'),
  });
  const listed = await app.request('/api/views');
  expect(await listed.json()).toEqual([]);
});

test('compute fails closed on a stale where key instead of counting unfiltered rows', () => {
  const { tables, views } = setup();
  tables.insert('customers', { name: 'A', amount: 1 });
  const stale: ViewDef = {
    id: 'stale',
    table: 'customers',
    kind: 'stat',
    title: 'Stale',
    pinned: true,
    config: { stat: { op: 'count', where: { naem: 'A' } } },
  };
  expect(() => views.compute(stale)).toThrow('Unknown column: naem for table customers');
});

test('compute fails closed on a stale sum column instead of returning a silent 0', () => {
  const { tables, views } = setup();
  tables.insert('customers', { name: 'A', amount: 1 });
  const stale: ViewDef = {
    id: 'stale',
    table: 'customers',
    kind: 'stat',
    title: 'Stale',
    pinned: true,
    config: { stat: { op: 'sum', column: 'total' } },
  };
  expect(() => views.compute(stale)).toThrow('Unknown column: total for table customers');
});

test('compute fails closed on a stale operator where value', () => {
  const { tables, views } = setup();
  tables.insert('customers', { name: 'A', amount: 1 });
  const stale: ViewDef = {
    id: 'stale',
    table: 'customers',
    kind: 'stat',
    title: 'Stale',
    pinned: true,
    config: { stat: { op: 'count', where: { name: { $ne: 'B' } } } },
  };
  expect(() => views.compute(stale)).toThrow('Invalid where value for column name');
});

test('compute fails closed on stale grid columns instead of projecting undefined', () => {
  const { tables, views } = setup();
  tables.insert('customers', { name: 'A', amount: 1 });
  const stale: ViewDef = {
    id: 'stale',
    table: 'customers',
    kind: 'grid',
    title: 'Stale',
    pinned: false,
    config: { columns: ['name', 'gone'] },
  };
  expect(() => views.compute(stale)).toThrow('Unknown column: gone for table customers');
});

test('GET /api/views/:id/data on a stale saved view is a loud 400', async () => {
  const { app, db } = createServer({ dbFile: ':memory:' });
  db.prepare(
    'INSERT INTO "views" ("id", "table_name", "kind", "config", "pinned", "title") VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    'stale-1',
    'customers',
    'stat',
    JSON.stringify({ stat: { op: 'count', where: { naem: 'A' } } }),
    1,
    'Stale',
  );
  const res = await app.request('/api/views/stale-1/data');
  expect(res.status).toBe(400);
  expect((await res.json()) as { error: string }).toMatchObject({
    error: expect.stringContaining('Unknown column: naem'),
  });
});

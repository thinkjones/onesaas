import { expect, test, vi } from 'vitest';
import { catalog } from '@dad/shared';
import { createGateway, type Gateway } from '../src/models/gateway.js';
import { openDb } from '../src/db/connection.js';
import { createTableStore, type TableStore } from '../src/tables/store.js';
import { executors, type StepContext } from '../src/steps/registry.js';

function gateway(): Gateway {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: '{}' } }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  });
  return createGateway({ client: { chat: { completions: { create } } } as never });
}

// The flow 2 bookings list: name/email/service/start/end/status, display name.
function bookingsStore(): TableStore {
  const tables = createTableStore(openDb(':memory:'));
  tables.createTable({
    name: 'bookings',
    label: 'Bookings',
    columns: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'service', label: 'Service', type: 'text' },
      { name: 'start', label: 'Start', type: 'datetime' },
      { name: 'end', label: 'End', type: 'datetime' },
      { name: 'status', label: 'Status', type: 'text' },
    ],
    displayField: 'name',
  });
  return tables;
}

function makeCtx(tables?: TableStore): StepContext {
  return {
    gateway: gateway(),
    tables: tables ?? bookingsStore(),
    bridge: { call: vi.fn() },
    signal: new AbortController().signal,
  };
}

const BOB = {
  name: 'Bob',
  email: 'bob@x.com',
  service: 'fence quote',
  start: '2026-11-03T15:00:00-08:00',
  end: '2026-11-03T16:00:00-08:00',
  status: 'confirmed',
};

test('table.insert adds a row and returns the why', async () => {
  const ctx = makeCtx();
  const result = await executors['table.insert']!(
    { table: 'bookings' },
    { row: { ...BOB } },
    ctx,
  );
  expect(result.output).toEqual({ id: expect.any(Number) });
  expect(result.why).toBe('Added Bob to Bookings.');
  expect(result.model).toBeUndefined();
  expect(ctx.tables.query('bookings')).toHaveLength(1);
});

test('table.insert preview describes the row without writing it', async () => {
  const ctx = makeCtx();
  const preview = executors['table.insert']!.preview!;
  expect(typeof preview).toBe('function');
  const result = await preview({ table: 'bookings' }, { row: { ...BOB } }, ctx);
  expect(result.output).toEqual({ id: 0 });
  expect(result.why).toBe('In a real run I would add Bob to Bookings.');
  expect(ctx.tables.query('bookings')).toHaveLength(0);
});

test('table.insert preview fails like a real run on an unknown table', async () => {
  const ctx = makeCtx();
  const preview = executors['table.insert']!.preview!;
  await expect(preview({ table: 'nope' }, { row: { ...BOB } }, ctx)).rejects.toThrow(
    'Unknown table: nope',
  );
});

test('table.insert preview fails like a real run on a bad email cell', async () => {
  const ctx = makeCtx();
  const preview = executors['table.insert']!.preview!;
  await expect(
    preview({ table: 'bookings' }, { row: { ...BOB, email: 'not-an-email' } }, ctx),
  ).rejects.toThrow('Invalid email for column email');
  expect(ctx.tables.query('bookings')).toHaveLength(0);
});

test('table.query with a where clause returns the matching rows and count', async () => {
  const ctx = makeCtx();
  await executors['table.insert']!({ table: 'bookings' }, { row: { ...BOB } }, ctx);
  await executors['table.insert']!(
    { table: 'bookings' },
    { row: { ...BOB, name: 'Priya', email: 'priya@x.com' } },
    ctx,
  );
  await executors['table.insert']!(
    { table: 'bookings' },
    { row: { ...BOB, name: 'Sam', email: 'sam@x.com', status: 'pending' } },
    ctx,
  );
  const result = await executors['table.query']!(
    { table: 'bookings' },
    { where: { status: 'confirmed' } },
    ctx,
  );
  const output = result.output as { rows: Record<string, unknown>[]; count: number };
  expect(output.count).toBe(2);
  expect(output.rows.map((r) => r['name']).sort()).toEqual(['Bob', 'Priya']);
  expect(result.why).toBe('Found 2 in Bookings.');
  expect(catalog['table.query']!.outputSchema.safeParse(result.output).success).toBe(true);
});

test('table.query without a where clause returns every row up to the limit', async () => {
  const ctx = makeCtx();
  await executors['table.insert']!({ table: 'bookings' }, { row: { ...BOB } }, ctx);
  const result = await executors['table.query']!({ table: 'bookings' }, {}, ctx);
  const output = result.output as { rows: Record<string, unknown>[]; count: number };
  expect(output.count).toBe(1);
  expect(result.why).toBe('Found 1 in Bookings.');
});

test('table.query applies the default limit of 20', async () => {
  const ctx = makeCtx();
  for (let i = 0; i < 21; i += 1) {
    ctx.tables.insert('bookings', { ...BOB, name: `Guest ${i}`, email: `guest${i}@x.com` });
  }
  const def = await executors['table.query']!({ table: 'bookings' }, {}, ctx);
  expect((def.output as { count: number }).count).toBe(20);
  expect(def.why).toBe('Found 20 in Bookings.');
  const wide = await executors['table.query']!({ table: 'bookings', limit: 50 }, {}, ctx);
  expect((wide.output as { count: number }).count).toBe(21);
});

test('table.query with an unknown where key fails instead of returning every row', async () => {
  const ctx = makeCtx();
  await executors['table.insert']!({ table: 'bookings' }, { row: { ...BOB } }, ctx);
  await expect(
    executors['table.query']!({ table: 'bookings' }, { where: { statuus: 'confirmed' } }, ctx),
  ).rejects.toThrow('Unknown column: statuus for table bookings');
});

test('table.query with an operator-shaped where value fails instead of matching nothing', async () => {
  const ctx = makeCtx();
  await executors['table.insert']!({ table: 'bookings' }, { row: { ...BOB } }, ctx);
  await expect(
    executors['table.query']!(
      { table: 'bookings' },
      { where: { status: { $ne: 'confirmed' } } },
      ctx,
    ),
  ).rejects.toThrow('Invalid where value for column status');
});

test('table.insert and table.query catalog entries have the spec shapes', () => {
  expect(catalog['table.insert']!.kind).toBe('store');
  expect(catalog['table.query']!.kind).toBe('fetch');
  expect(catalog['table.insert']!.configSchema.parse({ table: 'bookings' })).toEqual({
    table: 'bookings',
  });
  expect(catalog['table.query']!.configSchema.parse({ table: 'bookings' })).toEqual({
    table: 'bookings',
    limit: 20,
  });
  expect(catalog['table.query']!.inputSchema.parse({})).toEqual({});
});

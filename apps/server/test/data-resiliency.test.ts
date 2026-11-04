import type { Workflow } from '@onesaas/shared';
import { describe, expect, test, vi } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { openDb } from '../src/db/connection.js';
import { extractExecutor } from '../src/steps/ai.js';
import { insertExecutor, makeRecordId, upsertExecutor } from '../src/steps/table.js';
import { createTableStore } from '../src/tables/store.js';
import { checkWorkflow } from '../src/workflows/validate.js';

const ID_SHAPE = /^\d{8}-\d{6}-[a-z0-9]{3}$/;

function tablesWithJobs() {
  const tables = createTableStore(openDb(':memory:'));
  tables.createTable({
    name: 'jobs',
    label: 'Jobs',
    displayField: 'title',
    columns: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'salary', label: 'Salary', type: 'number' },
      { name: 'record_id', label: 'Record ID', type: 'text' },
    ],
  });
  return tables;
}

const ctxWith = (tables: ReturnType<typeof tablesWithJobs>) =>
  ({ tables, now: () => new Date('2026-11-04T21:32:05Z'), timezone: 'America/Los_Angeles' }) as never;

describe('record ids', () => {
  test('are the date and time in the owner\'s zone, plus 3 random characters', () => {
    expect(makeRecordId(new Date('2026-11-04T21:32:05Z'), 'America/Los_Angeles')).toMatch(/^20261104-133205-[a-z0-9]{3}$/);
  });
});

describe('saving what was read', () => {
  test('an insert with blanks saves, and gets a record id', async () => {
    const tables = tablesWithJobs();
    const out = await insertExecutor(
      { table: 'jobs', recordId: 'record_id' },
      { row: { title: 'Chef', email: null, salary: null } },
      ctxWith(tables),
    );
    const [row] = tables.query('jobs', { where: { id: (out.output as { id: number }).id } });
    expect(row).toMatchObject({ title: 'Chef', email: null, salary: null });
    expect(row!['record_id']).toMatch(ID_SHAPE);
  });

  test('a blank key saves as a new row instead of stopping the run', async () => {
    const tables = tablesWithJobs();
    const config = { table: 'jobs', keyField: 'email', recordId: 'record_id' };
    await upsertExecutor(config, { row: { title: 'One', email: null } }, ctxWith(tables));
    await upsertExecutor(config, { row: { title: 'Two', email: null } }, ctxWith(tables));
    expect(tables.query('jobs')).toHaveLength(2);
  });

  test('a repeat updates its row, keeps its record id, and blanks wipe nothing', async () => {
    const tables = tablesWithJobs();
    const config = { table: 'jobs', keyField: 'email', recordId: 'record_id' };
    await upsertExecutor(config, { row: { title: 'Chef', email: 'a@b.co', salary: 30 } }, ctxWith(tables));
    const first = tables.query('jobs')[0]!['record_id'];
    const out = await upsertExecutor(config, { row: { title: 'Head chef', email: 'a@b.co', salary: null } }, ctxWith(tables));
    expect(out.output).toMatchObject({ created: false });
    const rows = tables.query('jobs');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Head chef', salary: 30, record_id: first });
  });

  test('without recordId, a blank key still fails as it always did', async () => {
    const tables = tablesWithJobs();
    await expect(
      upsertExecutor({ table: 'jobs', keyField: 'email' }, { row: { title: 'Chef', email: null } }, ctxWith(tables)),
    ).rejects.toThrow('Missing value for key field');
  });

  test('a preview with a blank key says it would save a new row, and writes nothing', async () => {
    const tables = tablesWithJobs();
    const out = await upsertExecutor.preview!(
      { table: 'jobs', keyField: 'email', recordId: 'record_id' },
      { row: { title: 'Chef', email: null } },
      ctxWith(tables),
    );
    expect(out.why).toContain('new row');
    expect(tables.query('jobs')).toEqual([]);
  });
});

describe('extracting', () => {
  const fields = [
    { name: 'title', type: 'text', description: 't', optional: true },
    { name: 'salary', type: 'number', description: 's', optional: true },
    { name: 'must', type: 'text', description: 'm' },
  ];

  function gatewayReturning(output: unknown) {
    const chatJson = vi.fn(async (o: { schema: { parse(v: unknown): unknown } }) => ({
      data: o.schema.parse({ output, why: 'Read it.' }),
      model: 'm',
      tokens: 1,
      costUsd: 0,
    }));
    return { chatJson };
  }
  const ctx = (gateway: unknown) => ({ gateway, now: () => new Date(), timezone: 'UTC' }) as never;

  test('optional fields may come back null, and an empty one becomes null', async () => {
    const gateway = gatewayReturning({ title: '', salary: null, must: 'x' });
    const out = await extractExecutor({ instructions: 'Read', fields }, { text: 'hi' }, ctx(gateway));
    expect(out.output).toEqual({ title: null, salary: null, must: 'x' });
    expect(gateway.chatJson.mock.calls[0]![0]).toMatchObject({ user: expect.stringContaining('Never guess') });
  });

  test('a field that is not optional still cannot be null', async () => {
    const gateway = gatewayReturning({ title: 'a', salary: 1, must: null });
    await expect(extractExecutor({ instructions: 'Read', fields }, { text: 'hi' }, ctx(gateway))).rejects.toThrow();
  });

  test('nothing extra is said to the model when no field is optional', async () => {
    const gateway = gatewayReturning({ must: 'x' });
    await extractExecutor({ instructions: 'Read', fields: [fields[2]] }, { text: 'hi' }, ctx(gateway));
    expect((gateway.chatJson.mock.calls[0]![0] as unknown as { user: string }).user).not.toContain('Never guess');
  });

  test('the schema sent to the model allows null and still requires the key', async () => {
    const gateway = gatewayReturning({ title: 'a', salary: 1, must: 'x' });
    await extractExecutor({ instructions: 'Read', fields }, { text: 'hi' }, ctx(gateway));
    const { schema } = gateway.chatJson.mock.calls[0]![0] as unknown as { schema: never };
    const json = JSON.stringify(zodToJsonSchema(schema, { target: 'openAi' }));
    expect(json).toContain('"null"');
    expect(json).toContain('"required":["title","salary","must"]');
  });
});

describe('the builder\'s instructions', () => {
  const wf = (steps: { id: string; type: string }[]): Workflow =>
    ({
      id: 'w',
      name: 'n',
      description: 'd',
      version: 1,
      status: 'draft',
      trigger: { id: 'trigger', type: 'trigger.manual', title: 't', summary: 's', config: {}, inputs: {}, position: { x: 0, y: 0 } },
      steps: steps.map((s) => ({ ...s, title: 't', summary: 's', config: {}, inputs: {}, position: { x: 0, y: 0 } })),
      edges: [],
    }) as Workflow;
  const prompt = (workflow: Workflow) =>
    buildSystemPrompt({ business: { timezone: 'UTC' }, workflow, problems: [], tables: [] });
  const RULES = 'When an automation reads details and saves them';

  test('a new automation gets the rules, since it may need them', () => {
    expect(prompt(wf([]))).toContain(RULES);
  });

  test.each(['ai.extract', 'table.insert', 'table.upsert'])('one with %s gets them', (type) => {
    expect(prompt(wf([{ id: 'a', type }]))).toContain(RULES);
  });

  test('one that neither reads nor saves does not', () => {
    expect(prompt(wf([{ id: 'a', type: 'image.cutout' }]))).not.toContain(RULES);
  });
});

test('a record id column that does not exist is flagged', () => {
  const tables = tablesWithJobs();
  const workflow = {
    id: 'w',
    name: 'n',
    description: 'd',
    version: 1,
    status: 'draft',
    trigger: { id: 'trigger', type: 'trigger.manual', title: 't', summary: 's', config: {}, inputs: {}, position: { x: 0, y: 0 } },
    steps: [{ id: 'a', type: 'table.insert', title: 't', summary: 's', config: { table: 'jobs', recordId: 'nope' }, inputs: { row: '{{trigger.payload}}' }, position: { x: 0, y: 0 } }],
    edges: [{ from: 'trigger', to: 'a' }],
  } as Workflow;
  expect(checkWorkflow(workflow, tables).map((p) => p.problem)).toContain('The list "jobs" has no "nope" column for record ids.');
});

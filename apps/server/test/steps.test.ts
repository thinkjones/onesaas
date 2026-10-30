import { vi } from 'vitest';
import { catalog, emailSchema } from '@dad/shared';
import { createGateway, type Gateway } from '../src/models/gateway.js';
import { costUsd } from '../src/models/pricing.js';
import { openDb } from '../src/db/connection.js';
import { createTableStore, type TableStore } from '../src/tables/store.js';
import { executors, type Bridge, type StepContext } from '../src/steps/registry.js';

// Byte-exact copy of the AI system prompt: the tests pin it so any drift fails.
const SYSTEM_PROMPT =
  "You help a small business owner. Reply only with the JSON schema given. `why` is one plain-English sentence explaining what you did and why, with no jargon.";

// Fixed clock for date-line pins: Friday 30 October 2026, 10:00 AM in LA.
const FRIDAY = new Date('2026-10-30T10:00:00-07:00');
const FRIDAY_TZ = 'America/Los_Angeles';
const FRIDAY_LINE =
  'Today is Friday, 30 October 2026, the time is 10:00 AM, timezone America/Los_Angeles. Resolve relative dates against this.';

function completion(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

const INVALID_JSON = completion('nope, not json {{{');

// First calls fail schema validation; later calls return `valid`. With a single
// invalid response every call fails (double-fail tests).
function gatewayWithResponses(invalidCount: number, valid: string) {
  const create = vi.fn();
  for (let i = 0; i < invalidCount; i++) create.mockResolvedValueOnce(INVALID_JSON);
  create.mockResolvedValue(completion(valid));
  const client = { chat: { completions: { create } } };
  return { create, gateway: createGateway({ client: client as never }) };
}

function customersStore(): TableStore {
  const tables = createTableStore(openDb(':memory:'));
  tables.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
    ],
    displayField: 'name',
  });
  return tables;
}

function makeCtx(gateway: Gateway, tables?: TableStore, bridge?: Bridge): StepContext {
  return {
    gateway,
    tables: tables ?? customersStore(),
    bridge: bridge ?? { call: vi.fn() },
    signal: new AbortController().signal,
    now: () => FRIDAY,
    timezone: FRIDAY_TZ,
  };
}

const EXTRACT_CONFIG = {
  instructions: 'Read the enquiry.',
  fields: [
    { name: 'name', type: 'text', description: 'Customer name' },
    { name: 'email', type: 'email', description: 'Customer email' },
    { name: 'urgency', type: 'number', description: 'Urgency from 1 to 5' },
    { name: 'vip', type: 'boolean', description: 'Whether they are a VIP' },
  ],
};

test('ai.extract builds a fields schema, calls chatJson as builder, returns output and why', async () => {
  const { create, gateway } = gatewayWithResponses(
    0,
    JSON.stringify({
      output: { name: 'Sarah Lee', email: 'sarah@x.com', urgency: 4, vip: true },
      why: 'I pulled the contact details out of the email.',
    }),
  );
  const result = await executors['ai.extract']!(
    EXTRACT_CONFIG,
    { text: 'Hi, I need help. - Sarah' },
    makeCtx(gateway),
  );
  expect(result.output).toEqual({ name: 'Sarah Lee', email: 'sarah@x.com', urgency: 4, vip: true });
  expect(result.why).toBe('I pulled the contact details out of the email.');
  expect(result.model).toBe('muse-spark-1.3');
  expect(result.tokens).toEqual({ input: 10, output: 20 });
  expect(result.costUsd).toBe(costUsd('muse-spark-1.3', 10, 20));

  expect(create).toHaveBeenCalledTimes(1);
  const sent = create.mock.calls[0]![0] as Record<string, any>;
  expect(sent['model']).toBe('muse-spark-1.3');
  expect(sent['messages']).toEqual([
    { role: 'system', content: `${SYSTEM_PROMPT} ${FRIDAY_LINE}` },
    { role: 'user', content: 'Read the enquiry.\n\nText to read:\nHi, I need help. - Sarah' },
  ]);
  const format = sent['response_format'] as Record<string, any>;
  expect(format['type']).toBe('json_schema');
  expect(format['json_schema']['name']).toBe('ai_extract');
  expect(format['json_schema']['strict']).toBe(true);
  const schema = format['json_schema']['schema'] as Record<string, any>;
  expect(Object.keys(schema['properties'])).toEqual(expect.arrayContaining(['output', 'why']));
  expect(Object.keys(schema['properties']['output']['properties']).sort()).toEqual([
    'email',
    'name',
    'urgency',
    'vip',
  ]);
  // Every field is required: the model must return all of them, every time.
  expect(schema['properties']['output']['required'].sort()).toEqual(['email', 'name', 'urgency', 'vip']);
  // Email fields are plain strings, not format-validated: malformed model
  // output must not fail extraction (the table validates emails on write).
  expect(schema['properties']['output']['properties']['email']).not.toHaveProperty('format');
});

test('ai.extract retries once on a schema error then succeeds', async () => {
  const { create, gateway } = gatewayWithResponses(
    1,
    JSON.stringify({ output: { name: 'Sarah Lee' }, why: 'I read the email carefully.' }),
  );
  const result = await executors['ai.extract']!(
    {
      instructions: 'Read it.',
      fields: [{ name: 'name', type: 'text', description: 'Name' }],
    },
    { text: 'hello' },
    makeCtx(gateway),
  );
  expect(result.output).toEqual({ name: 'Sarah Lee' });
  expect(result.why).toBe('I read the email carefully.');
  expect(create).toHaveBeenCalledTimes(2);
});

test('ai.extract rejects with a friendly error after two schema failures', async () => {
  const { create, gateway } = gatewayWithResponses(99, '{}');
  await expect(
    executors['ai.extract']!(
      {
        instructions: 'Read it.',
        fields: [{ name: 'name', type: 'text', description: 'Name' }],
      },
      { text: 'hello' },
      makeCtx(gateway),
    ),
  ).rejects.toThrow(/^I couldn't read that properly:/);
  expect(create).toHaveBeenCalledTimes(2);
});

test('ai.extract does not retry transport errors', async () => {
  const create = vi.fn().mockRejectedValue(new Error('fetch failed'));
  const gateway = createGateway({ client: { chat: { completions: { create } } } as never });
  await expect(
    executors['ai.extract']!(
      {
        instructions: 'Read it.',
        fields: [{ name: 'name', type: 'text', description: 'Name' }],
      },
      { text: 'hello' },
      makeCtx(gateway),
    ),
  ).rejects.toThrow('fetch failed');
  expect(create).toHaveBeenCalledTimes(1);
});

test('table.upsert reports a new row with an exact why', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const ctx = makeCtx(gateway);
  const result = await executors['table.upsert']!(
    { table: 'customers', keyField: 'email' },
    { row: { name: 'Sarah Lee', email: 'sarah@x.com' } },
    ctx,
  );
  expect(result.output).toEqual({ id: expect.any(Number), created: true });
  expect(result.why).toBe('Saved Sarah Lee to customers because the email address was new.');
  expect(result.model).toBeUndefined();
  expect(ctx.tables.query('customers')).toHaveLength(1);
});

test('table.upsert reports an existing row as updated with the same id', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const ctx = makeCtx(gateway);
  const config = { table: 'customers', keyField: 'email' };
  const first = await executors['table.upsert']!(
    config,
    { row: { name: 'Sarah', email: 'sarah@x.com' } },
    ctx,
  );
  const second = await executors['table.upsert']!(
    config,
    { row: { name: 'Sarah Lee', email: 'sarah@x.com' } },
    ctx,
  );
  expect(second.output).toEqual({ id: (first.output as { id: number }).id, created: false });
  expect(second.why).toBe('Updated Sarah Lee in customers because we already knew this email address.');
});

test('table.upsert generalises the why for non-email key fields', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const ctx = makeCtx(gateway);
  const config = { table: 'customers', keyField: 'name' };
  const first = await executors['table.upsert']!(
    config,
    { row: { name: 'Sarah Lee', email: 'sarah@x.com' } },
    ctx,
  );
  expect(first.why).toBe('Saved Sarah Lee to customers because the name was new.');
  const second = await executors['table.upsert']!(
    config,
    { row: { name: 'Sarah Lee', email: 'sarah.new@x.com' } },
    ctx,
  );
  expect(second.why).toBe('Updated Sarah Lee in customers because we already knew this name.');
});

test('gmail.draftReply drafts via the bridge', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const call = vi.fn().mockResolvedValue({ drafted: true });
  const result = await executors['gmail.draftReply']!(
    {},
    { threadId: 't1', body: 'Hello!' },
    makeCtx(gateway, undefined, { call }),
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('gmail', 'draftReply', { threadId: 't1', body: 'Hello!' });
  expect(result.output).toEqual({ drafted: true });
  expect(result.why).toBe('Saved the reply as a draft in Gmail.');
});

test('gmail.read reads via the worker tab and names the sender and subject', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const email = {
    from: 'sarah@x.com',
    fromName: 'Sarah Lee',
    subject: 'Need help',
    body: 'Please call me.',
    threadId: 't1',
  };
  const call = vi.fn().mockResolvedValue(email);
  const result = await executors['gmail.read']!(
    {},
    { threadId: 't1' },
    makeCtx(gateway, undefined, { call }),
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('gmail', 'readOpenEmail', { threadId: 't1' }, undefined, {
    tab: 'worker',
  });
  expect(result.output).toEqual(email);
  expect(result.why).toBe('Read the email from Sarah Lee ("Need help").');
});

const WRITE_CONFIG = { instructions: 'Write a reply.', tone: 'friendly' };

test('ai.write calls chatJson as builder and returns the text and why', async () => {
  const { create, gateway } = gatewayWithResponses(
    0,
    JSON.stringify({ output: { text: 'Hi Sarah, thanks!' }, why: 'I wrote a friendly reply.' }),
  );
  const context = { name: 'Sarah Lee', need: 'a callback' };
  const result = await executors['ai.write']!(WRITE_CONFIG, { context }, makeCtx(gateway));
  expect(result.output).toEqual({ text: 'Hi Sarah, thanks!' });
  expect(result.why).toBe('I wrote a friendly reply.');
  expect(result.model).toBe('muse-spark-1.3');
  expect(result.tokens).toEqual({ input: 10, output: 20 });
  expect(result.costUsd).toBe(costUsd('muse-spark-1.3', 10, 20));

  expect(create).toHaveBeenCalledTimes(1);
  const sent = create.mock.calls[0]![0] as Record<string, any>;
  expect(sent['model']).toBe('muse-spark-1.3');
  expect(sent['messages']).toEqual([
    { role: 'system', content: `${SYSTEM_PROMPT} ${FRIDAY_LINE}` },
    {
      role: 'user',
      content: `Write a reply.\n\nTone: friendly\n\nContext:\n${JSON.stringify(context)}`,
    },
  ]);
  const format = sent['response_format'] as Record<string, any>;
  expect(format['json_schema']['name']).toBe('ai_write');
  expect(format['json_schema']['strict']).toBe(true);
  const schema = format['json_schema']['schema'] as Record<string, any>;
  expect(Object.keys(schema['properties'])).toEqual(expect.arrayContaining(['output', 'why']));
  expect(Object.keys(schema['properties']['output']['properties'])).toEqual(['text']);
});

test('ai.write retries once on a schema error then succeeds', async () => {
  const { create, gateway } = gatewayWithResponses(
    1,
    JSON.stringify({ output: { text: 'Hi!' }, why: 'I wrote it on the second try.' }),
  );
  const result = await executors['ai.write']!(
    WRITE_CONFIG,
    { context: { name: 'Sarah' } },
    makeCtx(gateway),
  );
  expect(result.output).toEqual({ text: 'Hi!' });
  expect(create).toHaveBeenCalledTimes(2);
});

test('ai.write rejects with a friendly error after two schema failures', async () => {
  const { create, gateway } = gatewayWithResponses(99, '{}');
  await expect(
    executors['ai.write']!(WRITE_CONFIG, { context: {} }, makeCtx(gateway)),
  ).rejects.toThrow(/^I couldn't write that properly:/);
  expect(create).toHaveBeenCalledTimes(2);
});

test('every catalog entry has an executor', () => {
  expect(Object.keys(catalog).sort()).toEqual(
    [
      'ai.classify',
      'ai.extract',
      'ai.write',
      'approval.ask',
      'calendar.createEvent',
      'calendar.freeBusy',
      'gmail.draftReply',
      'gmail.read',
      'image.cutout',
      'image.edit',
      'image.generate',
      'table.insert',
      'table.query',
      'table.upsert',
      'trigger.email',
      'trigger.gmailButton',
      'trigger.manual',
      'trigger.upload',
    ].sort(),
  );
  for (const type of Object.keys(catalog)) {
    expect(typeof executors[type]).toBe('function');
  }
});

test('catalog shares one email schema between the gmail trigger and gmail.read', () => {
  expect(catalog['gmail.read']!.outputSchema).toBe(emailSchema);
  const email = {
    from: 'sarah@x.com',
    fromName: 'Sarah Lee',
    subject: 'Need help',
    body: 'Please call me.',
    threadId: 't1',
  };
  expect(emailSchema.parse(email)).toEqual(email);
  expect(catalog['trigger.gmailButton']!.outputSchema.parse({ email })).toEqual({ email });
});

test('trigger.gmailButton echoes the trigger payload and names the sender and subject', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const input = {
    email: {
      from: 'sarah@x.com',
      fromName: 'Sarah Lee',
      subject: 'Need help',
      body: 'Hi',
      threadId: 't1',
    },
  };
  const result = await executors['trigger.gmailButton']!(
    { label: 'Save as lead' },
    input,
    makeCtx(gateway),
  );
  expect(result.output).toEqual(input);
  expect(result.why).toBe('Started by an email from Sarah Lee ("Need help").');
});

test('trigger.manual echoes the payload', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const result = await executors['trigger.manual']!(
    {},
    { payload: { hello: 1 } },
    makeCtx(gateway),
  );
  expect(result.output).toEqual({ payload: { hello: 1 } });
  expect(result.why).toBe('Started manually.');
});

test('ai.extract rejects an unknown field type instead of a TypeError', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  await expect(
    executors['ai.extract']!(
      {
        instructions: 'Read it.',
        fields: [{ name: 'x', type: 'bogus', description: 'X' }],
      },
      { text: 'hello' },
      makeCtx(gateway),
    ),
  ).rejects.toThrow('Unknown field type: bogus');
});

test('ai.extract rejects duplicate field names instead of last-win', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  await expect(
    executors['ai.extract']!(
      {
        instructions: 'Read it.',
        fields: [
          { name: 'name', type: 'text', description: 'Name' },
          { name: 'name', type: 'number', description: 'Name again' },
        ],
      },
      { text: 'hello' },
      makeCtx(gateway),
    ),
  ).rejects.toThrow('Duplicate field: "name"');
});

test.each([['null', null], ['string', 'oops']])(
  'gmail.read survives garbage bridge output (%s) with fallback sender and subject',
  async (_label, garbage) => {
    const { gateway } = gatewayWithResponses(0, '{}');
    const call = vi.fn().mockResolvedValue(garbage);
    const result = await executors['gmail.read']!(
      {},
      { threadId: 't1' },
      makeCtx(gateway, undefined, { call }),
    );
    // senderBits falls back to 'someone' / '(no subject)' when the bridge
    // returns anything without fromName/from/subject properties.
    expect(result.output).toEqual(garbage);
    expect(result.why).toBe('Read the email from someone ("(no subject)").');
  },
);

test('table.upsert throws for an unknown table', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  await expect(
    executors['table.upsert']!(
      { table: 'nope', keyField: 'email' },
      { row: { name: 'Sarah', email: 'sarah@x.com' } },
      makeCtx(gateway),
    ),
  ).rejects.toThrow('Unknown table: nope');
});

test('ai.extract propagates a transport error on the retry attempt unwrapped', async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce(INVALID_JSON)
    .mockRejectedValueOnce(new Error('fetch failed'));
  const gateway = createGateway({ client: { chat: { completions: { create } } } as never });
  const err = await executors['ai.extract']!(
    {
      instructions: 'Read it.',
      fields: [{ name: 'name', type: 'text', description: 'Name' }],
    },
    { text: 'hello' },
    makeCtx(gateway),
  ).then(
    () => null,
    (e: unknown) => e,
  );
  expect(create).toHaveBeenCalledTimes(2);
  expect(err).toBeInstanceOf(Error);
  // Exactly the transport error: no friendly "I couldn't read that" prefix.
  expect((err as Error).message).toBe('fetch failed');
});

test('ai.extract config schema requires at least one field', () => {
  expect(() =>
    catalog['ai.extract']!.configSchema.parse({ instructions: 'x', fields: [] }),
  ).toThrow();
});

test('ai.extract with a fixed Friday clock sends the exact date line', async () => {
  const { create, gateway } = gatewayWithResponses(
    0,
    JSON.stringify({ output: { name: 'Sarah' }, why: 'I read the email.' }),
  );
  await executors['ai.extract']!(
    {
      instructions: 'Read it.',
      fields: [{ name: 'name', type: 'text', description: 'Name' }],
    },
    { text: 'hello' },
    makeCtx(gateway),
  );
  const sent = create.mock.calls[0]![0] as Record<string, any>;
  const system = (sent['messages'] as { role: string; content: string }[]).find(
    (m) => m.role === 'system',
  )!.content;
  expect(system).toContain('Friday, 30 October 2026');
  expect(system).toBe(`${SYSTEM_PROMPT} ${FRIDAY_LINE}`);
});

test('ai.write with a fixed Friday clock sends the exact date line', async () => {
  const { create, gateway } = gatewayWithResponses(
    0,
    JSON.stringify({ output: { text: 'Hi!' }, why: 'I wrote it.' }),
  );
  await executors['ai.write']!(WRITE_CONFIG, { context: {} }, makeCtx(gateway));
  const sent = create.mock.calls[0]![0] as Record<string, any>;
  const system = (sent['messages'] as { role: string; content: string }[]).find(
    (m) => m.role === 'system',
  )!.content;
  expect(system).toBe(`${SYSTEM_PROMPT} ${FRIDAY_LINE}`);
});

test('trigger.email echoes the trigger payload and names the sender and subject', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const input = {
    email: {
      threadId: 't1',
      from: 'jordan@x.com',
      fromName: 'Jordan Lee',
      subject: 'Booking for Saturday',
      snippet: 'Can I book?',
    },
  };
  const result = await executors['trigger.email']!({}, input, makeCtx(gateway));
  expect(result.output).toEqual(input);
  expect(result.why).toBe('A new email arrived from Jordan Lee ("Booking for Saturday").');
});

test('table.upsert preview fails like live for a bad keyField', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const ctx = makeCtx(gateway);
  const config = { table: 'customers', keyField: 'nickname' };
  const input = { row: { name: 'Sarah', nickname: 'S' } };
  await expect(executors['table.upsert']!(config, input, ctx)).rejects.toThrow(
    'Unknown column: nickname for table customers',
  );
  await expect(executors['table.upsert']!.preview!(config, input, ctx)).rejects.toThrow(
    'Unknown column: nickname for table customers',
  );
  // The failed preview still never wrote.
  expect(ctx.tables.query('customers')).toEqual([]);
});

test('table.upsert preview fails like live for an invalid email key', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const ctx = makeCtx(gateway);
  const config = { table: 'customers', keyField: 'email' };
  const input = { row: { name: 'Sarah', email: 'not-an-email' } };
  await expect(executors['table.upsert']!(config, input, ctx)).rejects.toThrow(
    'Invalid email for column email',
  );
  await expect(executors['table.upsert']!.preview!(config, input, ctx)).rejects.toThrow(
    'Invalid email for column email',
  );
  expect(ctx.tables.query('customers')).toEqual([]);
});

test('table.upsert preview still reports would-create/would-update for a valid key', async () => {
  const { gateway } = gatewayWithResponses(0, '{}');
  const ctx = makeCtx(gateway);
  const config = { table: 'customers', keyField: 'name' };
  const input = { row: { name: 'Sarah', email: 'sarah@x.com' } };
  const create = await executors['table.upsert']!.preview!(config, input, ctx);
  expect(create.output).toEqual({ id: 0, created: true });
  expect(create.why).toBe(
    'In a real run I would save Sarah to customers because the name is new.',
  );
  const seeded = ctx.tables.insert('customers', { name: 'Sarah', email: 'sarah@x.com' });
  const update = await executors['table.upsert']!.preview!(config, input, ctx);
  expect(update.output).toEqual({ id: seeded.id, created: false });
  expect(update.why).toBe(
    'In a real run I would update Sarah in customers because we already know this name.',
  );
  // Previews read but never wrote: still exactly the seeded row.
  expect(ctx.tables.query('customers')).toHaveLength(1);
});

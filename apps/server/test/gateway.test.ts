import { z } from 'zod';
import { createGateway } from '../src/models/gateway.js';
import { costUsd } from '../src/models/pricing.js';

const itemSchema = z.object({ name: z.string(), qty: z.number() });

function fakeClient(response: unknown) {
  const calls: unknown[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          calls.push(params);
          return response;
        },
      },
    },
  };
  return { client, calls };
}

test('chatJson sends builder model and strict json_schema response_format', async () => {
  const { client, calls } = fakeClient({
    choices: [{ message: { content: '{"name":"hammer","qty":2}' } }],
    usage: { prompt_tokens: 1000, completion_tokens: 2000 },
  });
  const gateway = createGateway({ client: client as never });
  const result = await gateway.chatJson({
    role: 'builder',
    system: 'sys',
    user: 'usr',
    schema: itemSchema,
    schemaName: 'item',
  });
  expect(result.data).toEqual({ name: 'hammer', qty: 2 });
  expect(calls).toHaveLength(1);
  const sent = calls[0] as Record<string, unknown>;
  expect(sent['model']).toBe('muse-spark-1.3');
  expect(sent['response_format']).toMatchObject({
    type: 'json_schema',
    json_schema: { name: 'item', strict: true },
  });
  const jsonSchema = (sent['response_format'] as { json_schema: { schema: unknown } }).json_schema.schema;
  expect(jsonSchema).toBeDefined();
  expect(typeof jsonSchema).toBe('object');
});

test('chatJson returns priced token usage', async () => {
  const { client } = fakeClient({
    choices: [{ message: { content: '{"name":"hammer","qty":2}' } }],
    usage: { prompt_tokens: 1000, completion_tokens: 2000 },
  });
  const gateway = createGateway({ client: client as never });
  const result = await gateway.chatJson({
    role: 'builder',
    system: 'sys',
    user: 'usr',
    schema: itemSchema,
    schemaName: 'item',
  });
  expect(result.model).toBe('muse-spark-1.3');
  expect(result.tokens).toEqual({ input: 1000, output: 2000 });
  expect(result.costUsd).toBe(0.00975);
  expect(result.costUsd).toBe(costUsd('muse-spark-1.3', 1000, 2000));
});

test('chatJson throws on schema mismatch', async () => {
  const { client } = fakeClient({
    choices: [{ message: { content: '{"name":"hammer","qty":"two"}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const gateway = createGateway({ client: client as never });
  await expect(
    gateway.chatJson({ role: 'builder', system: 'sys', user: 'usr', schema: itemSchema, schemaName: 'item' }),
  ).rejects.toThrow(/^Model output did not match schema/);
});

test('chatJson throws on missing content', async () => {
  const { client } = fakeClient({
    choices: [{ message: { content: null } }],
    usage: { prompt_tokens: 10, completion_tokens: 0 },
  });
  const gateway = createGateway({ client: client as never });
  await expect(
    gateway.chatJson({ role: 'builder', system: 'sys', user: 'usr', schema: itemSchema, schemaName: 'item' }),
  ).rejects.toThrow(/^Model output did not match schema/);
});

test('chatJson throws on non-JSON prose content', async () => {
  const { client } = fakeClient({
    choices: [{ message: { content: 'not json{' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const gateway = createGateway({ client: client as never });
  await expect(
    gateway.chatJson({ role: 'builder', system: 'sys', user: 'usr', schema: itemSchema, schemaName: 'item' }),
  ).rejects.toThrow(/^Model output did not match schema/);
});

test('chatJson passes through roles override model', async () => {
  const { client, calls } = fakeClient({
    choices: [{ message: { content: '{"name":"hammer","qty":2}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const gateway = createGateway({ client: client as never, roles: { planner: 'custom-model' } });
  const result = await gateway.chatJson({
    role: 'planner',
    system: 'sys',
    user: 'usr',
    schema: itemSchema,
    schemaName: 'item',
  });
  expect(result.model).toBe('custom-model');
  const sent = calls[0] as Record<string, unknown>;
  expect(sent['model']).toBe('custom-model');
});

test('chatJson uses planner default model', async () => {
  const { client, calls } = fakeClient({
    choices: [{ message: { content: '{"name":"hammer","qty":2}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const gateway = createGateway({ client: client as never });
  const result = await gateway.chatJson({
    role: 'planner',
    system: 'sys',
    user: 'usr',
    schema: itemSchema,
    schemaName: 'item',
  });
  expect(result.model).toBe('muse-wonder-1.0');
  const sent = calls[0] as Record<string, unknown>;
  expect(sent['model']).toBe('muse-wonder-1.0');
});

test('chatJson defaults tokens to zero when usage is missing', async () => {
  const { client } = fakeClient({
    choices: [{ message: { content: '{"name":"hammer","qty":2}' } }],
  });
  const gateway = createGateway({ client: client as never });
  const result = await gateway.chatJson({
    role: 'builder',
    system: 'sys',
    user: 'usr',
    schema: itemSchema,
    schemaName: 'item',
  });
  expect(result.tokens).toEqual({ input: 0, output: 0 });
  expect(result.costUsd).toBe(0);
});

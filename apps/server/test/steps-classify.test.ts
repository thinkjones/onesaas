import { evalCondition } from '@onesaas/shared';
import { expect, vi } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { createGateway, type Gateway } from '../src/models/gateway.js';
import { createTableStore, type TableStore } from '../src/tables/store.js';
import { executors, type Bridge, type StepContext } from '../src/steps/registry.js';

function completion(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

const INVALID_JSON = completion('nope, not json {{{');

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
  };
}

test('ai.classify returns the model choice constrained to options', async () => {
  const { create, gateway } = gatewayWithResponses(
    0,
    JSON.stringify({ choice: 'booking', why: 'It asks for a table.' }),
  );
  const result = await executors['ai.classify']!(
    { question: 'Is this a booking request?', options: ['booking', 'other'] },
    { text: 'Can I book a table for 4?' },
    makeCtx(gateway),
  );
  expect(result.output).toEqual({ choice: 'booking' });
  expect(result.why).toBe('It asks for a table.');
  expect(result.model).toBe('muse-spark-1.3');

  expect(create).toHaveBeenCalledTimes(1);
  const sent = create.mock.calls[0]![0] as Record<string, any>;
  expect(sent['model']).toBe('muse-spark-1.3');
  const format = sent['response_format'] as Record<string, any>;
  expect(format['json_schema']['name']).toBe('ai_classify');
  const choiceSchema = format['json_schema']['schema']['properties']['choice'] as Record<string, any>;
  expect(choiceSchema['enum']).toEqual(['booking', 'other']);
});

test('ai.classify rejects a model choice outside options: one retry, then a readable failure', async () => {
  // Every response picks 'maybe', which is outside ['yes','no']: schema error twice.
  const { create, gateway } = gatewayWithResponses(
    0,
    JSON.stringify({ choice: 'maybe', why: 'Not sure.' }),
  );
  await expect(
    executors['ai.classify']!(
      { question: 'Is this urgent?', options: ['yes', 'no'] },
      { text: 'Call me sometime.' },
      makeCtx(gateway),
    ),
  ).rejects.toThrow("I couldn't sort that into one of: yes, no.");
  expect(create).toHaveBeenCalledTimes(2);
});

test('ai.classify recovers when the retry picks a valid option', async () => {
  const create = vi.fn();
  create.mockResolvedValueOnce(completion(JSON.stringify({ choice: 'maybe', why: 'Unsure.' })));
  create.mockResolvedValue(completion(JSON.stringify({ choice: 'no', why: 'Not urgent.' })));
  const gateway = createGateway({ client: { chat: { completions: { create } } } as never });
  const result = await executors['ai.classify']!(
    { question: 'Is this urgent?', options: ['yes', 'no'] },
    { text: 'Call me sometime.' },
    makeCtx(gateway),
  );
  expect(result.output).toEqual({ choice: 'no' });
  expect(create).toHaveBeenCalledTimes(2);
});

test('ai.classify defaults to yes/no options when none are configured', async () => {
  const { create, gateway } = gatewayWithResponses(
    0,
    JSON.stringify({ choice: 'yes', why: 'Clearly urgent.' }),
  );
  const result = await executors['ai.classify']!(
    { question: 'Is this urgent?' },
    { text: 'Call me now!' },
    makeCtx(gateway),
  );
  expect(result.output).toEqual({ choice: 'yes' });
  const sent = create.mock.calls[0]![0] as Record<string, any>;
  const choiceSchema = sent['response_format']['json_schema']['schema']['properties'][
    'choice'
  ] as Record<string, any>;
  expect(choiceSchema['enum']).toEqual(['yes', 'no']);
});

test('ai.classify with empty options fails before any model call', async () => {
  const { create, gateway } = gatewayWithResponses(0, '{}');
  await expect(
    executors['ai.classify']!({ question: 'Q?', options: [] }, { text: 'hi' }, makeCtx(gateway)),
  ).rejects.toThrow('at least one option');
  expect(create).not.toHaveBeenCalled();
});

test('ai.classify does not retry transport errors', async () => {
  const create = vi.fn().mockRejectedValue(new Error('fetch failed'));
  const gateway = createGateway({ client: { chat: { completions: { create } } } as never });
  await expect(
    executors['ai.classify']!(
      { question: 'Q?', options: ['yes', 'no'] },
      { text: 'hi' },
      makeCtx(gateway),
    ),
  ).rejects.toThrow('fetch failed');
  expect(create).toHaveBeenCalledTimes(1);
});

test('branch conditions read {{classify.choice}} with no engine change', async () => {
  const bindings = { classify: { choice: 'yes' }, trigger: {} };
  expect(await evalCondition("classify.choice == 'yes'", bindings)).toBe(true);
  expect(await evalCondition("classify.choice == 'no'", bindings)).toBe(false);
});

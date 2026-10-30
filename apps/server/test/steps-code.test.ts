import { expect, vi } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { createGateway, type Gateway } from '../src/models/gateway.js';
import { executors, type Bridge, type StepContext } from '../src/steps/registry.js';
import { createTableStore, type TableStore } from '../src/tables/store.js';

function makeCtx(): StepContext {
  const create = vi.fn();
  const gateway: Gateway = createGateway({
    client: { chat: { completions: { create } } } as never,
  });
  const tables: TableStore = createTableStore(openDb(':memory:'));
  const bridge: Bridge = { call: vi.fn() };
  return { gateway, tables, bridge, signal: new AbortController().signal };
}

const EXPLANATION = 'Adds 20% to the quote.';

function configFor(code: string) {
  return {
    explanation: EXPLANATION,
    code,
    outputFields: [{ name: 'total', type: 'number' }],
  };
}

test('code.transform runs the calculation and validates the declared output fields', async () => {
  const result = await executors['code.transform']!(
    configFor('return { total: input.value.amount * 1.2 }'),
    { value: { amount: 100 } },
    makeCtx(),
  );
  expect(result.output).toEqual({ total: 120 });
  expect(result.why).toBe(EXPLANATION);
});

test('code.transform fails readably when the calculation takes too long', async () => {
  await expect(
    executors['code.transform']!(configFor('while(true){}'), { value: {} }, makeCtx()),
  ).rejects.toThrow('This calculation took too long.');
});

test('code.transform fails readably when the calculation reaches outside the sandbox', async () => {
  await expect(
    executors['code.transform']!(configFor('return process.env'), { value: {} }, makeCtx()),
  ).rejects.toThrow("This calculation tried to use something it isn't allowed to.");
});

test('code.transform fails the output schema when a declared field is missing', async () => {
  await expect(
    executors['code.transform']!(configFor('return {}'), { value: {} }, makeCtx()),
  ).rejects.toThrow("didn't return what was expected");
});

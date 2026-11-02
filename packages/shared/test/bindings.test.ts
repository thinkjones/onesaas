import { evalCondition, resolveBindings } from '../src/index.js';

test('resolveBindings resolves a dotted path from ctx', async () => {
  const out = await resolveBindings({ body: '{{trigger.email.body}}' }, { trigger: { email: { body: 'hi' } } });
  expect(out).toEqual({ body: 'hi' });
});

test('resolveBindings keeps the raw type when the value is exactly one expression', async () => {
  const obj = { a: 1, nested: { b: true } };
  const out = await resolveBindings({ data: '{{step.output}}' }, { step: { output: obj } });
  expect(out).toEqual({ data: obj });
  expect((out['data'] as object)).toBe(obj);
});

test('resolveBindings interpolates mixed text as a string', async () => {
  const out = await resolveBindings({ greeting: 'Hi {{extract.name}}!' }, { extract: { name: 'Sarah' } });
  expect(out).toEqual({ greeting: 'Hi Sarah!' });
});

test('resolveBindings resolves a missing path to undefined instead of throwing', async () => {
  const out = await resolveBindings({ body: '{{trigger.email.missing}}' }, { trigger: { email: { body: 'hi' } } });
  expect(out).toEqual({ body: undefined });
  expect('body' in out).toBe(true);
});

test('resolveBindings interpolates $-patterns verbatim in mixed text', async () => {
  const out = await resolveBindings(
    { text: 'a={{x}} b={{y}} c={{z}}' },
    { x: '$&', y: "$'", z: '$`' },
  );
  expect(out).toEqual({ text: "a=$& b=$' c=$`" });
});

test('evalCondition returns true or false from ctx', async () => {
  await expect(evalCondition('classify.isBooking == true', { classify: { isBooking: true } })).resolves.toBe(true);
  await expect(evalCondition('classify.isBooking == true', { classify: { isBooking: false } })).resolves.toBe(false);
});

test('resolveBindings resolves a whole hyphenated step id (not jexl subtraction)', async () => {
  const output = { name: 'Nicolas', email: 'n@example.com' };
  const out = await resolveBindings({ row: '{{extract-details-XhfhTM}}' }, { 'extract-details-XhfhTM': output });
  expect(out['row']).toBe(output);
});

test('resolveBindings resolves dotted paths off a hyphenated step id', async () => {
  const out = await resolveBindings(
    { email: '{{extract-details-XhfhTM.email}}' },
    { 'extract-details-XhfhTM': { email: 'n@example.com' } },
  );
  expect(out).toEqual({ email: 'n@example.com' });
});

test('resolveBindings interpolates hyphenated refs inside mixed text', async () => {
  const out = await resolveBindings(
    { greeting: 'Hi {{my-step.name}}!' },
    { 'my-step': { name: 'Sarah' } },
  );
  expect(out).toEqual({ greeting: 'Hi Sarah!' });
});

test('resolveBindings resolves a missing hyphenated path to undefined', async () => {
  const out = await resolveBindings({ v: '{{my-step.missing}}' }, { 'my-step': { name: 'x' } });
  expect(out).toEqual({ v: undefined });
});

test('resolveBindings still evaluates real jexl expressions', async () => {
  const out = await resolveBindings({ n: '{{count + 1}}' }, { count: 1 });
  expect(out).toEqual({ n: 2 });
});

test('evalCondition resolves a plain hyphenated path', async () => {
  await expect(evalCondition('my-step', { 'my-step': true })).resolves.toBe(true);
  await expect(evalCondition('my-step.ok', { 'my-step': { ok: false } })).resolves.toBe(false);
});

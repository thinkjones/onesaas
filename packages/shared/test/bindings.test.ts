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

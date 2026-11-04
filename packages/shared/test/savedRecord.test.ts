import { expect, test } from 'vitest';
import { savedRecordPath } from '../src/savedRecord.js';

const save = { type: 'table.insert', config: { table: 'jobs' } };

test('a save step links to its row', () => {
  expect(savedRecordPath(save, { id: 7 })).toBe('/lists?table=jobs&row=7');
  expect(savedRecordPath({ ...save, type: 'table.upsert' }, { id: 7, created: false })).toBe('/lists?table=jobs&row=7');
});

test('other steps, and a Try it run that saved nothing, have no link', () => {
  expect(savedRecordPath({ type: 'ai.write', config: {} }, { id: 7 })).toBeNull();
  expect(savedRecordPath(save, { id: 0 })).toBeNull();
  expect(savedRecordPath(save, undefined)).toBeNull();
});

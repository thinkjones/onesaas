import { sanitiseName } from '../tables/store.js';
import type { Executor } from './registry.js';

export const upsertExecutor: Executor = async (config, input, ctx) => {
  const table = config.table as string;
  const keyField = config.keyField as string;
  const row = input.row as Record<string, unknown>;
  const { id, created } = ctx.tables.upsert(table, row, keyField);
  // upsert succeeded, so the table exists; still tolerate a missing def.
  const displayField = ctx.tables.getTable(table)?.displayField;
  const raw =
    (displayField !== undefined ? row[displayField] : undefined) ?? row[keyField] ?? 'someone';
  const name = String(raw);
  // The email wording is the spec'd special case (flow 1 keys customers by
  // email); other key fields get the same shape generalised. The table name
  // is config.table as given.
  let why: string;
  if (keyField === 'email') {
    why = created
      ? `Saved ${name} to ${table} because the email address was new.`
      : `Updated ${name} in ${table} because we already knew this email address.`;
  } else {
    why = created
      ? `Saved ${name} to ${table} because the ${keyField} was new.`
      : `Updated ${name} in ${table} because we already knew this ${keyField}.`;
  }
  // No model/tokens/costUsd: the why is templated, this step calls no model.
  return { output: { id, created }, why };
};

// Test-mode preview: READ-ONLY mirror of the key lookup above (same
// sanitised-key match, via query), so the why can say whether a real run
// would create or update. Never writes: a would-be row reports id 0.
upsertExecutor.preview = async (config, input, ctx) => {
  const table = config.table as string;
  const keyField = config.keyField as string;
  const row = input.row as Record<string, unknown>;
  const keyEntry = Object.entries(row).find(([k]) => {
    try {
      return sanitiseName(k) === sanitiseName(keyField);
    } catch {
      return false;
    }
  });
  const keyValue = keyEntry?.[1];
  if (keyValue === null || keyValue === undefined) {
    throw new Error(`Missing value for key field: ${keyField}`);
  }
  const existing = ctx.tables.query(table, { where: { [keyField]: keyValue }, limit: 1 });
  const found = existing[0];
  const created = found === undefined;
  // The email wording mirrors the live special case above; other key fields
  // get the same shape generalised. The table name is config.table as given.
  const displayField = ctx.tables.getTable(table)?.displayField;
  const raw =
    (displayField !== undefined ? row[displayField] : undefined) ?? row[keyField] ?? 'someone';
  const name = String(raw);
  let why: string;
  if (keyField === 'email') {
    why = created
      ? `In a real run I would save ${name} to ${table} because the email address is new.`
      : `In a real run I would update ${name} in ${table} because we already know this email address.`;
  } else {
    why = created
      ? `In a real run I would save ${name} to ${table} because the ${keyField} is new.`
      : `In a real run I would update ${name} in ${table} because we already know this ${keyField}.`;
  }
  return { output: { id: created ? 0 : (found!['id'] as number), created }, why };
};

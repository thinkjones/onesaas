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

import { sanitiseName } from '../tables/store.js';
import { ctxNow, ctxTimezone, type Executor, type StepContext } from './registry.js';

// Display value for a fresh row: the list's display column, else the
// upsert-style 'someone' fallback (bookings and customers are people-shaped).
function displayOf(
  row: Record<string, unknown>,
  displayField: string | undefined,
): string {
  const raw = displayField !== undefined ? row[displayField] : undefined;
  return raw === null || raw === undefined ? 'someone' : String(raw);
}

/** A row's id when nothing in it can be relied on: 20261104-143205-x7k, in the owner's time. */
export function makeRecordId(now: Date, timezone: string): string {
  const part = (options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, ...options }).format(now);
  const date = `${part({ year: 'numeric' })}${part({ month: '2-digit' })}${part({ day: '2-digit' })}`;
  const time = part({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).replaceAll(':', '');
  const random = Math.random().toString(36).slice(2, 5).padEnd(3, '0');
  return `${date}-${time}-${random}`;
}

function recordIdCells(config: Record<string, unknown>, ctx: StepContext): Record<string, unknown> | undefined {
  const column = config['recordId'];
  if (typeof column !== 'string' || column === '') return undefined;
  return { [column]: makeRecordId(ctxNow(ctx), ctxTimezone(ctx)) };
}

export const insertExecutor: Executor = async (config, input, ctx) => {
  const table = config.table as string;
  const row = input.row as Record<string, unknown>;
  const { id } = ctx.tables.insert(table, { ...row, ...recordIdCells(config, ctx) });
  // insert succeeded, so the table exists; still tolerate a missing def.
  const def = ctx.tables.getTable(table);
  const name = displayOf(row, def?.displayField);
  const label = def?.label ?? table;
  // No model/tokens/costUsd: the why is templated, this step calls no model.
  return { output: { id }, why: `Added ${name} to ${label}.` };
};

// Test-mode preview: READ-ONLY mirror of the store guards above (unknown
// table, bad email/datetime cells — same messages as a real run, via the
// same sanitised-key matching), so "Try it" validates without writing. A
// would-be row reports id 0.
insertExecutor.preview = async (config, input, ctx) => {
  const table = config.table as string;
  const row = input.row as Record<string, unknown>;
  const def = ctx.tables.getTable(table);
  if (!def) throw new Error(`Unknown table: ${table}`);
  const types = new Map(def.columns.map((c) => [c.name, c.type]));
  for (const [rawKey, value] of Object.entries(row)) {
    let col: string;
    try {
      col = sanitiseName(rawKey);
    } catch {
      continue; // Key sanitises to nothing — unknown, ignored like writes.
    }
    const type = types.get(col);
    if (value === null || value === undefined) continue;
    if (type === 'email' && !String(value).includes('@')) {
      throw new Error(`Invalid email for column ${col}`);
    }
    if (
      type === 'datetime' &&
      !(value instanceof Date) &&
      Number.isNaN(Date.parse(String(value)))
    ) {
      throw new Error(`Invalid datetime for column ${col}`);
    }
  }
  const name = displayOf(row, def.displayField);
  return { output: { id: 0 }, why: `In a real run I would add ${name} to ${def.label}.` };
};

export const queryExecutor: Executor = async (config, input, ctx) => {
  const table = config.table as string;
  // The catalog limit default never applies at runtime (guard-only schemas),
  // so it lives here too. Keep the two in sync.
  const limit = (config.limit as number | undefined) ?? 20;
  const where = input.where as Record<string, unknown> | undefined;
  // FAIL CLOSED on unknown where keys: the store ignores them (symmetric with
  // writes), so a typo would silently return unfiltered rows as success.
  // Operator-shaped values are rejected too: only exact matches are supported.
  const def = ctx.tables.getTable(table);
  if (def && where !== undefined && where !== null && typeof where === 'object') {
    const names = new Set([
      ...def.columns.map((c) => c.name),
      'id',
      'created_at',
      'updated_at',
    ]);
    for (const [rawKey, value] of Object.entries(where)) {
      let col: string;
      try {
        col = sanitiseName(rawKey);
      } catch {
        throw new Error(`Unknown column: ${rawKey} for table ${table}`);
      }
      if (!names.has(col)) {
        throw new Error(`Unknown column: ${rawKey} for table ${table}`);
      }
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        throw new Error(`Invalid where value for column ${rawKey}: operators are not supported`);
      }
    }
  }
  const rows = ctx.tables.query(table, {
    ...(where !== undefined ? { where } : {}),
    limit,
  });
  // query succeeded, so the table exists; still tolerate a missing def.
  const label = ctx.tables.getTable(table)?.label ?? table;
  // No model/tokens/costUsd: the why is templated, this step calls no model.
  return { output: { rows, count: rows.length }, why: `Found ${rows.length} in ${label}.` };
};

export const upsertExecutor: Executor = async (config, input, ctx) => {
  const table = config.table as string;
  const keyField = config.keyField as string;
  const row = input.row as Record<string, unknown>;
  const { id, created } = ctx.tables.upsert(table, row, keyField, recordIdCells(config, ctx));
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
  // READ-ONLY GUARD PARITY with the live path (store.upsert): the table-def
  // lookup, keyField column membership, and the email check are pure reads,
  // so the preview fails exactly like a real run would (same messages) —
  // `query` alone would ignore an unknown where-key and skip validation.
  // Full-row insert validation stays preview-exempt by design: a preview
  // must never write, so only the key guards are mirrored here.
  const def = ctx.tables.getTable(table);
  if (!def) throw new Error(`Unknown table: ${table}`);
  const key = sanitiseName(keyField);
  if (!def.columns.some((c) => c.name === key)) {
    throw new Error(`Unknown column: ${keyField} for table ${table}`);
  }
  const keyEntry = Object.entries(row).find(([k]) => {
    try {
      return sanitiseName(k) === key;
    } catch {
      return false;
    }
  });
  const keyValue = keyEntry?.[1];
  if (keyValue === null || keyValue === undefined) {
    if (recordIdCells(config, ctx) === undefined) throw new Error(`Missing value for key field: ${keyField}`);
    const name = displayOf(row, def.displayField);
    return { output: { id: 0, created: true }, why: `In a real run I would save ${name} to ${table} as a new row.` };
  }
  const keyType = def.columns.find((c) => c.name === key)!.type;
  if (keyType === 'email' && !String(keyValue).includes('@')) {
    throw new Error(`Invalid email for column ${key}`);
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

import type { ColumnType } from '@onesaas/shared';
import type { Database } from '../db/connection.js';

// The union lives in @onesaas/shared (the step catalog needs it, and shared
// cannot import from server). Re-exported here so existing imports keep
// working.
export type { ColumnType } from '@onesaas/shared';

export interface TableDef {
  name: string;
  label: string;
  columns: { name: string; label: string; type: ColumnType }[];
  displayField: string;
  keyField?: string;
}

export interface TableStore {
  createTable(def: TableDef): TableDef;
  getTable(name: string): TableDef | undefined;
  listTables(): TableDef[];
  insert(table: string, row: Record<string, unknown>): { id: number };
  upsert(
    table: string,
    row: Record<string, unknown>,
    keyField: string,
    /** Cells only a new row gets. Passing it also means a blank key saves as new, and blanks don't overwrite. */
    onCreate?: Record<string, unknown>,
  ): { id: number; created: boolean };
  query(
    table: string,
    o?: { where?: Record<string, unknown>; limit?: number },
  ): Record<string, unknown>[];
}

// ColumnType → SQLite mapping:
//   text → TEXT, number → REAL, boolean → INTEGER (true/false ↔ 1/0 on
//   write/read), date → TEXT (ISO string, no format enforcement),
//   email → TEXT + `@` validation on write,
//   datetime → TEXT (ISO with offset) + Date.parse validation on write.
const SQLITE_TYPE: Record<ColumnType, string> = {
  text: 'TEXT',
  number: 'REAL',
  boolean: 'INTEGER',
  date: 'TEXT',
  email: 'TEXT',
  datetime: 'TEXT',
};

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'text',
  'number',
  'boolean',
  'date',
  'email',
  'datetime',
]);

// Physical system columns present on every table; reserved against user columns,
// but allowed as exact-match where-keys.
const RESERVED_COLUMNS: ReadonlySet<string> = new Set(['id', 'created_at', 'updated_at']);

/**
 * Sanitise a table or column name: lowercase, collapse each maximal run of
 * non-`[a-z0-9]` to a single `_`, trim leading/trailing `_`, and prefix
 * `c_` when the result starts with a digit. Throws when nothing remains.
 */
export function sanitiseName(original: string): string {
  let out = original.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  out = out.replace(/^_+|_+$/g, '');
  if (out.length === 0) throw new Error(`Invalid name: "${original}"`);
  if (/^[0-9]/.test(out)) out = `c_${out}`;
  return out;
}

/** Quote an identifier. Sanitised names never contain `"`, so this is airtight. */
function qident(name: string): string {
  return `"${name}"`;
}

function physicalTableName(sanitised: string): string {
  return `t_${sanitised}`;
}

function toStored(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (type === 'boolean') return value ? 1 : 0;
  return value;
}

function fromStored(type: ColumnType, value: unknown): unknown {
  if (type === 'boolean' && value !== null && value !== undefined) return Boolean(value);
  return value;
}

function checkEmail(column: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (!String(value).includes('@')) throw new Error(`Invalid email for column ${column}`);
}

function checkDatetime(column: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (value instanceof Date) return;
  if (Number.isNaN(Date.parse(String(value)))) {
    throw new Error(`Invalid datetime for column ${column}`);
  }
}

function sanitiseDef(def: TableDef): TableDef {
  return {
    name: sanitiseName(def.name),
    label: def.label,
    columns: def.columns.map((c) => ({ name: sanitiseName(c.name), label: c.label, type: c.type })),
    displayField: sanitiseName(def.displayField),
    ...(def.keyField !== undefined ? { keyField: sanitiseName(def.keyField) } : {}),
  };
}

export function createTableStore(db: Database): TableStore {
  db.exec('CREATE TABLE IF NOT EXISTS "_tables" ("name" TEXT PRIMARY KEY, "def" TEXT)');

  // FORGIVING LOOKUP: every entry point sanitises its table/column/key
  // arguments, so `insert('Customers', …)` addresses `t_customers`. The M3
  // builder agent will pass display-ish names; a strict match would silently
  // create ghost tables instead.
  function getDefOrThrow(callerTable: string): TableDef {
    const row = db
      .prepare('SELECT "def" FROM "_tables" WHERE "name" = ?')
      .get(sanitiseName(callerTable)) as { def: string } | undefined;
    if (!row) throw new Error(`Unknown table: ${callerTable}`);
    return JSON.parse(row.def) as TableDef;
  }

  // Keep only keys addressing known columns (caller keys are sanitised
  // first); validate email cells. Unknown keys are dropped, never written.
  function knownCells(def: TableDef, row: Record<string, unknown>): { col: string; value: unknown }[] {
    const types = new Map(def.columns.map((c) => [c.name, c.type]));
    const cells: { col: string; value: unknown }[] = [];
    for (const [rawKey, value] of Object.entries(row)) {
      let col: string;
      try {
        col = sanitiseName(rawKey);
      } catch {
        continue; // Key sanitises to nothing — unknown, ignore it.
      }
      const type = types.get(col);
      if (!type) continue;
      if (type === 'email') checkEmail(col, value);
      if (type === 'datetime') checkDatetime(col, value);
      cells.push({ col, value: toStored(type, value) });
    }
    return cells;
  }

  function insert(table: string, row: Record<string, unknown>): { id: number } {
    const def = getDefOrThrow(table);
    const cells = knownCells(def, row);
    const now = new Date().toISOString();
    const names = [...cells.map((c) => qident(c.col)), '"created_at"', '"updated_at"'].join(', ');
    const placeholders = [...cells.map(() => '?'), '?', '?'].join(', ');
    const info = db
      .prepare(
        `INSERT INTO ${qident(physicalTableName(def.name))} (${names}) VALUES (${placeholders})`,
      )
      .run(...cells.map((c) => c.value), now, now);
    return { id: Number(info.lastInsertRowid) };
  }

  return {
    createTable(def: TableDef): TableDef {
      const clean = sanitiseDef(def);
      const existing = db
        .prepare('SELECT "name" FROM "_tables" WHERE "name" = ?')
        .get(clean.name) as { name: string } | undefined;
      if (existing) throw new Error(`Table already exists: ${clean.name}`);
      for (const c of clean.columns) {
        if (!KNOWN_TYPES.has(c.type)) {
          throw new Error(`Unknown column type: ${c.type} for column ${c.name}`);
        }
      }
      const seen = new Map<string, string>();
      clean.columns.forEach((c, i) => {
        const prev = seen.get(c.name);
        if (prev !== undefined) {
          throw new Error(
            `Duplicate column after sanitising: "${prev}" and "${def.columns[i]!.name}" both become ${c.name}`,
          );
        }
        seen.set(c.name, def.columns[i]!.name);
      });
      clean.columns.forEach((c, i) => {
        if (RESERVED_COLUMNS.has(c.name)) {
          throw new Error(
            `Reserved column name: "${def.columns[i]!.name}" becomes ${c.name}, which is reserved (id, created_at, updated_at)`,
          );
        }
      });
      const names = new Set(clean.columns.map((c) => c.name));
      if (!names.has(clean.displayField)) {
        throw new Error(`Unknown column: ${clean.displayField} for table ${clean.name}`);
      }
      if (clean.keyField !== undefined && !names.has(clean.keyField)) {
        throw new Error(`Unknown column: ${clean.keyField} for table ${clean.name}`);
      }
      const cols = clean.columns
        .map((c) => `${qident(c.name)} ${SQLITE_TYPE[c.type]}`)
        .join(', ');
      const runCreate = db.transaction(() => {
        db.exec(
          `CREATE TABLE ${qident(physicalTableName(clean.name))} ("id" INTEGER PRIMARY KEY${cols ? `, ${cols}` : ''}, "created_at" TEXT NOT NULL, "updated_at" TEXT NOT NULL)`,
        );
        db.prepare('INSERT INTO "_tables" ("name", "def") VALUES (?, ?)').run(
          clean.name,
          JSON.stringify(clean),
        );
      });
      runCreate();
      return clean;
    },

    getTable(name: string): TableDef | undefined {
      const row = db
        .prepare('SELECT "def" FROM "_tables" WHERE "name" = ?')
        .get(sanitiseName(name)) as { def: string } | undefined;
      // Fresh parse per call, so callers cannot mutate the registry's copy.
      return row ? (JSON.parse(row.def) as TableDef) : undefined;
    },

    // Creation order (registry rowid).
    listTables(): TableDef[] {
      const rows = db.prepare('SELECT "def" FROM "_tables" ORDER BY "rowid"').all() as {
        def: string;
      }[];
      return rows.map((r) => JSON.parse(r.def) as TableDef);
    },

    insert,

    upsert(
      table: string,
      row: Record<string, unknown>,
      keyField: string,
      onCreate?: Record<string, unknown>,
    ): { id: number; created: boolean } {
      const def = getDefOrThrow(table);
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
        if (onCreate === undefined) throw new Error(`Missing value for key field: ${keyField}`);
        // Nothing to match a repeat on, but what was read is still worth keeping.
        const { id } = insert(table, { ...row, ...onCreate });
        return { id, created: true };
      }
      const keyType = def.columns.find((c) => c.name === key)!.type;
      if (keyType === 'email') checkEmail(key, keyValue);
      if (keyType === 'datetime') checkDatetime(key, keyValue);
      const existing = db
        .prepare(
          `SELECT "id" FROM ${qident(physicalTableName(def.name))} WHERE ${qident(key)} = ?`,
        )
        .get(toStored(keyType, keyValue)) as { id: number } | undefined;
      if (!existing) {
        const { id } = insert(table, { ...row, ...onCreate });
        return { id, created: true };
      }
      // With onCreate, a detail this run couldn't find doesn't wipe a known one.
      const cells = knownCells(def, row).filter(
        (c) => c.col !== key && (onCreate === undefined || (c.value !== null && c.value !== undefined)),
      );
      const now = new Date().toISOString();
      const set = [...cells.map((c) => `${qident(c.col)} = ?`), '"updated_at" = ?'].join(', ');
      db.prepare(`UPDATE ${qident(physicalTableName(def.name))} SET ${set} WHERE "id" = ?`).run(
        ...cells.map((c) => c.value),
        now,
        existing.id,
      );
      return { id: existing.id, created: false };
    },

    query(table: string, o?: { where?: Record<string, unknown>; limit?: number }): Record<string, unknown>[] {
      const def = getDefOrThrow(table);
      const types = new Map(def.columns.map((c) => [c.name, c.type]));
      const clauses: string[] = [];
      const params: unknown[] = [];
      for (const [rawKey, value] of Object.entries(o?.where ?? {})) {
        let col: string;
        try {
          col = sanitiseName(rawKey);
        } catch {
          continue; // Unknown where key — ignored, symmetric with writes.
        }
        const type = types.get(col);
        if (!type) {
          // System columns allow exact-match filtering; truly unknown keys stay ignored.
          if (!RESERVED_COLUMNS.has(col)) continue;
          if (value === null || value === undefined) {
            clauses.push(`${qident(col)} IS NULL`);
          } else {
            clauses.push(`${qident(col)} = ?`);
            params.push(value);
          }
          continue;
        }
        if (value === null || value === undefined) {
          clauses.push(`${qident(col)} IS NULL`);
        } else {
          clauses.push(`${qident(col)} = ?`);
          params.push(toStored(type, value));
        }
      }
      let sql = `SELECT * FROM ${qident(physicalTableName(def.name))}`;
      if (clauses.length > 0) sql += ` WHERE ${clauses.join(' AND ')}`;
      if (o?.limit !== undefined) {
        if (typeof o.limit !== 'number' || !Number.isInteger(o.limit) || o.limit < 0) {
          throw new Error(`Invalid limit: ${o.limit}`);
        }
        sql += ' LIMIT ?';
        params.push(o.limit);
      }
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          const type = types.get(k);
          out[k] = type ? fromStored(type, v) : v;
        }
        return out;
      });
    },
  };
}

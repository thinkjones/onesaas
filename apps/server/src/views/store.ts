import { nanoid } from 'nanoid';
import type { Database } from '../db/connection.js';
import { sanitiseName, type TableStore } from '../tables/store.js';

// Saved views over Dad's lists: a grid (spreadsheet), cards (one card per
// row), or a stat (one pinned number). Every list ALSO gets an automatic grid
// view without saving one — the lists page builds it on the fly.

export type ViewKind = 'grid' | 'cards' | 'stat';

export interface StatConfig {
  op: 'count' | 'sum';
  column?: string;
  where?: Record<string, unknown>;
  sinceDays?: number;
}

export interface ViewDef {
  id: string;
  table: string;
  kind: ViewKind;
  title: string;
  pinned: boolean;
  config: {
    columns?: string[];
    stat?: StatConfig;
  };
}

export type ViewData = { rows?: Record<string, unknown>[]; value?: number };

export interface ViewStore {
  list(): ViewDef[];
  save(v: Omit<ViewDef, 'id'> & { id?: string }): ViewDef;
  remove(id: string): void;
  compute(v: ViewDef): ViewData;
}

const KINDS: ReadonlySet<string> = new Set(['grid', 'cards', 'stat']);

// Row columns every table carries; allowed in grid column picks.
const SYSTEM_COLUMNS: ReadonlySet<string> = new Set(['id', 'created_at', 'updated_at']);

const VIEWS_DDL = `
CREATE TABLE IF NOT EXISTS "views" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "table_name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "config" TEXT NOT NULL,
  "pinned" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL
);
`;

interface ViewRow {
  id: string;
  table_name: string;
  kind: string;
  config: string;
  pinned: number;
  title: string;
}

function rowToView(row: ViewRow): ViewDef {
  return {
    id: row.id,
    table: row.table_name,
    kind: row.kind as ViewKind,
    title: row.title,
    pinned: row.pinned === 1,
    config: JSON.parse(row.config) as ViewDef['config'],
  };
}

export function createViewStore(d: {
  db: Database;
  tables: TableStore;
  now?: () => Date;
}): ViewStore {
  const { db, tables } = d;
  const now = d.now ?? (() => new Date());
  db.exec(VIEWS_DDL);

  function knownColumns(table: string): Set<string> {
    const def = tables.getTable(table);
    if (!def) throw new Error(`Unknown table: ${table}`);
    return new Set([...def.columns.map((c) => c.name), ...SYSTEM_COLUMNS]);
  }

  function checkStat(table: string, stat: StatConfig): void {
    if (stat.op !== 'count' && stat.op !== 'sum') {
      throw new Error(`Unknown stat op: ${String((stat as { op?: unknown }).op)}`);
    }
    if (stat.op === 'sum') {
      if (typeof stat.column !== 'string' || stat.column === '') {
        throw new Error('A sum needs a column to add up.');
      }
      const def = tables.getTable(table)!;
      const col = def.columns.find((c) => c.name === stat.column);
      if (!col) throw new Error(`Unknown column: ${stat.column} for table ${table}`);
      if (col.type !== 'number') {
        throw new Error(`Cannot add up column "${stat.column}": it is not a number column.`);
      }
    }
    if (stat.sinceDays !== undefined) {
      if (
        typeof stat.sinceDays !== 'number' ||
        !Number.isInteger(stat.sinceDays) ||
        stat.sinceDays < 0
      ) {
        throw new Error(`Invalid sinceDays: ${String(stat.sinceDays)}`);
      }
    }
    if (stat.where !== undefined) {
      if (stat.where === null || typeof stat.where !== 'object' || Array.isArray(stat.where)) {
        throw new Error('Stat filters must be an object of exact matches.');
      }
      // FAIL CLOSED on unknown filter keys, mirroring query_table: the store
      // ignores them, so a typo would silently count unfiltered rows.
      const names = knownColumns(table);
      for (const rawKey of Object.keys(stat.where)) {
        let col: string;
        try {
          col = sanitiseName(rawKey);
        } catch {
          throw new Error(`Unknown column: ${rawKey} for table ${table}`);
        }
        if (!names.has(col)) throw new Error(`Unknown column: ${rawKey} for table ${table}`);
      }
    }
  }

  function save(v: Omit<ViewDef, 'id'> & { id?: string }): ViewDef {
    if (typeof v.table !== 'string' || v.table === '') {
      throw new Error('A view needs a table.');
    }
    if (!KINDS.has(v.kind)) {
      throw new Error(`Unknown view kind: ${String(v.kind)}`);
    }
    if (typeof v.title !== 'string' || v.title.trim() === '') {
      throw new Error('A view needs a title.');
    }
    const def = tables.getTable(v.table);
    if (!def) throw new Error(`Unknown table: ${v.table}`);
    const config = v.config ?? {};
    if (config.columns !== undefined) {
      if (!Array.isArray(config.columns)) throw new Error('View columns must be a list.');
      const names = knownColumns(v.table);
      for (const col of config.columns) {
        if (typeof col !== 'string' || !names.has(col)) {
          throw new Error(`Unknown column: ${String(col)} for table ${v.table}`);
        }
      }
    }
    if (v.kind === 'stat') {
      if (!config.stat || typeof config.stat !== 'object') {
        throw new Error("Stat views need a stat config with op 'count' or 'sum'.");
      }
      checkStat(v.table, config.stat);
    }
    const view: ViewDef = {
      id: v.id ?? nanoid(),
      table: def.name,
      kind: v.kind,
      title: v.title,
      pinned: v.pinned,
      config,
    };
    db.prepare(
      'INSERT INTO "views" ("id", "table_name", "kind", "config", "pinned", "title") VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT("id") DO UPDATE SET "table_name" = excluded."table_name", "kind" = excluded."kind", "config" = excluded."config", "pinned" = excluded."pinned", "title" = excluded."title"',
    ).run(view.id, view.table, view.kind, JSON.stringify(view.config), view.pinned ? 1 : 0, view.title);
    return view;
  }

  function compute(v: ViewDef): ViewData {
    if (v.kind === 'grid' || v.kind === 'cards') {
      const rows = tables.query(v.table) as Record<string, unknown>[];
      const cols = v.config.columns;
      if (!cols) return { rows };
      return {
        rows: rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const c of cols) out[c] = row[c];
          return out;
        }),
      };
    }
    const stat = v.config.stat;
    if (!stat) throw new Error("Stat views need a stat config with op 'count' or 'sum'.");
    let rows = tables.query(v.table, {
      ...(stat.where !== undefined ? { where: stat.where } : {}),
    }) as Record<string, unknown>[];
    if (stat.sinceDays !== undefined) {
      const cutoff = now().getTime() - stat.sinceDays * 86_400_000;
      rows = rows.filter((row) => {
        const created = row['created_at'];
        if (typeof created !== 'string') return false;
        const t = Date.parse(created);
        return !Number.isNaN(t) && t >= cutoff;
      });
    }
    if (stat.op === 'count') return { value: rows.length };
    let total = 0;
    for (const row of rows) {
      const n = Number(row[stat.column!]);
      if (Number.isFinite(n)) total += n;
    }
    return { value: total };
  }

  return {
    list(): ViewDef[] {
      const rows = db.prepare('SELECT * FROM "views" ORDER BY "rowid"').all() as ViewRow[];
      return rows.map(rowToView);
    },

    save,

    remove(id: string): void {
      const info = db.prepare('DELETE FROM "views" WHERE "id" = ?').run(id);
      if (info.changes === 0) throw new Error(`Unknown view: ${id}`);
    },

    compute,
  };
}

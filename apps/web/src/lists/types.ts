import type { ColumnType } from '@dad/shared';

// Mirrors the server's TableDef/ViewDef (apps/server/src/tables/store.ts and
// apps/server/src/views/store.ts). The web package cannot import server code,
// so the shapes are redeclared here like EngineEvent in api.ts.

export interface ListColumn {
  name: string;
  label: string;
  type: ColumnType;
}

export interface ListTable {
  name: string;
  label: string;
  columns: ListColumn[];
  displayField: string;
  keyField?: string;
}

/** GET /api/lists: every table plus its row count. */
export interface ListSummary extends ListTable {
  count: number;
}

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

/** GET /api/views/:id/data: rows for grid/cards, a value for stat. */
export interface ViewData {
  rows?: Record<string, unknown>[];
  value?: number;
}

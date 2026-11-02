// In-app data reset: wipe the LIVE database + files back to fresh-install
// state (blank workflows) without stopping the server. Unlike
// scripts/demo-reset (which deletes the DB file out from under a running
// server and must run stopped), this issues DELETEs through the open handle,
// so POST /api/data/reset is safe to call from the Settings page. The seed
// half is shared with main.ts so a boot-into-empty and a reset land in
// exactly the same state.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Workflow } from '@dad/shared';
import type { Database } from './db/connection.js';
import type { Repo } from './db/repo.js';
import flow1 from './seed/flow1.json' with { type: 'json' };
import type { TableDef, TableStore } from './tables/store.js';

// Every row table a reset clears. `_tables` is handled separately (its
// physical t_* tables are dropped first); the `settings` KV table holds the
// app doc, the pairing token + codes, and the legacy timezone key.
const ROW_TABLES = [
  'workflows',
  'runs',
  'step_runs',
  'seen_emails',
  'views',
  'files',
  'conversations',
  'settings',
] as const;

/** The customers table every fresh install (and only it) carries. */
export const CUSTOMERS_TABLE: TableDef = {
  name: 'customers',
  label: 'Customers',
  columns: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'need', label: 'Need', type: 'text' },
    { name: 'urgency', label: 'Urgency', type: 'text' },
  ],
  displayField: 'name',
  keyField: 'email',
};

/**
 * Seed the customers table into a store missing it; never touches user data.
 * New installs get a BLANK workflow store — flow 1 is opt-in fixture data
 * (seedFlow1 below), not part of the customer flow.
 */
export function seedFreshInstall(deps: { repo: Repo; tables: TableStore }): void {
  if (!deps.tables.getTable('customers')) deps.tables.createTable(CUSTOMERS_TABLE);
}

/**
 * Save the flow-1 fixture ("Save as lead & reply") unless a flow-1 already
 * exists (never overwrite user edits). Demos (`demo:reset --with-flow1`) and
 * the e2e suite (SEED_FLOW1=1) opt in explicitly. Workflow.parse fails loud
 * on a broken seed file.
 */
export function seedFlow1(repo: Repo): void {
  if (!repo.getWorkflow('flow-1')) repo.saveWorkflow(Workflow.parse(flow1));
}

export interface DataResetDeps {
  db: Database;
  filesDir: string;
  repo: Repo;
  tables: TableStore;
  /** Restores the blank zone AND re-persists the defaults settings doc. */
  setTimezone: (tz: string) => void;
}

/**
 * Wipe user data, uploads, views, pairing and settings, then reseed the
 * customers table: the store afterwards equals a fresh install (blank
 * workflows, onboarded false). Idempotent. Missing tables are skipped, never
 * an error.
 */
export function resetDataToFreshInstall(deps: DataResetDeps): void {
  const { db, filesDir, repo, tables, setTimezone } = deps;
  const existing = new Set(
    (
      db.prepare(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table'`).all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  );
  for (const t of ROW_TABLES) {
    if (existing.has(t)) db.exec(`DELETE FROM "${t}"`);
  }
  if (existing.has('_tables')) {
    // Stored def names are sanitised at creation; quoted regardless.
    for (const t of tables.listTables()) db.exec(`DROP TABLE IF EXISTS "t_${t.name}"`);
    db.exec(`DELETE FROM "_tables"`);
  }
  // Upload bytes: remove every child, keep the dir itself in place.
  mkdirSync(filesDir, { recursive: true });
  for (const child of readdirSync(filesDir)) {
    rmSync(join(filesDir, child), { recursive: true, force: true });
  }
  seedFreshInstall({ repo, tables });
  setTimezone('');
}

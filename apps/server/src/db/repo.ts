import { randomUUID } from 'node:crypto';
import {
  Run,
  StepRun,
  Workflow,
  catalog,
  type Run as RunType,
  type StepRun as StepRunType,
  type Workflow as WorkflowType,
} from '@dad/shared';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { nanoid } from 'nanoid';
import type { Database } from './connection.js';
import { runs, stepRuns, workflows } from './schema.js';

// Column names here MUST match src/db/schema.ts exactly (snake_case).
// Executed with CREATE TABLE IF NOT EXISTS on every createRepo call, so it is
// idempotent and coexists with createTableStore (`_tables`/`t_*` namespace).
const DDL = `
CREATE TABLE IF NOT EXISTS "workflows" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "def" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id", "version")
);
CREATE TABLE IF NOT EXISTS "runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflow_id" TEXT NOT NULL,
  "workflow_version" INTEGER NOT NULL,
  "trigger_payload" TEXT,
  "status" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'live',
  "used_sample" INTEGER NOT NULL DEFAULT 0,
  "started_at" TEXT NOT NULL,
  "ended_at" TEXT
);
CREATE TABLE IF NOT EXISTS "step_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "step_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "input" TEXT,
  "output" TEXT,
  "error" TEXT,
  "model" TEXT,
  "tokens" TEXT,
  "cost_usd" REAL,
  "duration_ms" INTEGER,
  "why" TEXT,
  "started_at" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "seen_emails" (
  "thread_id" TEXT NOT NULL PRIMARY KEY,
  "seen_at" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "views" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "table_name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "config" TEXT NOT NULL,
  "pinned" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "files" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "path" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "source" TEXT NOT NULL,
  "created_at" TEXT NOT NULL
);
`;

export interface Repo {
  saveWorkflow(wf: WorkflowType): WorkflowType;
  getWorkflow(id: string, version?: number): WorkflowType | undefined;
  listWorkflows(): WorkflowType[];
  createWorkflow(o: { name: string; description: string }): WorkflowType;
  updateLatestInPlace(wf: WorkflowType): WorkflowType;
  createRun(
    r: Omit<RunType, 'id' | 'startedAt' | 'kind' | 'usedSample'> & { kind?: RunType['kind'] },
  ): RunType;
  updateRun(id: string, patch: Partial<RunType>): void;
  upsertStepRun(sr: StepRunType): void;
  getRun(id: string): { run: RunType; steps: StepRunType[] } | undefined;
  listRuns(o?: { workflowId?: string; limit?: number; includeTests?: boolean }): RunType[];
}

/** Deterministic JSON with recursively sorted keys; key order never matters. */
function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function fromJson<T>(raw: string | null): T | undefined {
  return raw === null ? undefined : (JSON.parse(raw) as T);
}

function parseWorkflowDef(def: string, id: string, version: number): WorkflowType {
  try {
    return Workflow.parse(JSON.parse(def));
  } catch (err) {
    throw new Error(`Invalid stored workflow ${id} v${version}: ${(err as Error).message}`);
  }
}

function rowToRun(row: typeof runs.$inferSelect): RunType {
  return Run.parse({
    id: row.id,
    workflowId: row.workflowId,
    workflowVersion: row.workflowVersion,
    triggerPayload: fromJson(row.triggerPayload),
    status: row.status,
    kind: row.kind,
    usedSample: row.usedSample === 1,
    startedAt: row.startedAt,
    ...(row.endedAt !== null ? { endedAt: row.endedAt } : {}),
  });
}

function rowToStepRun(row: typeof stepRuns.$inferSelect): StepRunType {
  return StepRun.parse({
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    status: row.status,
    ...(row.input !== null ? { input: fromJson(row.input) } : {}),
    ...(row.output !== null ? { output: fromJson(row.output) } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.tokens !== null ? { tokens: fromJson(row.tokens) } : {}),
    ...(row.costUsd !== null ? { costUsd: row.costUsd } : {}),
    ...(row.durationMs !== null ? { durationMs: row.durationMs } : {}),
    ...(row.why !== null ? { why: row.why } : {}),
    startedAt: row.startedAt,
  });
}

export function createRepo(db: Database): Repo {
  db.exec(DDL);
  // `kind` postdates existing app.db files, whose runs table was created
  // without the column (CREATE TABLE IF NOT EXISTS never alters). Backfill
  // in place; the 'live' default keeps every pre-existing run a live run.
  const runCols = db.prepare(`PRAGMA table_info("runs")`).all() as { name: string }[];
  if (!runCols.some((c) => c.name === 'kind')) {
    db.exec(`ALTER TABLE "runs" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'live'`);
  }
  // Same story for `used_sample` (M3 Task 6): old DBs predate the column, and
  // every pre-existing run keeps usedSample false via the 0 default.
  if (!runCols.some((c) => c.name === 'used_sample')) {
    db.exec(`ALTER TABLE "runs" ADD COLUMN "used_sample" INTEGER NOT NULL DEFAULT 0`);
  }
  const orm = drizzle(db);

  function insertWorkflowVersion(parsed: WorkflowType, version: number): WorkflowType {
    const stored: WorkflowType = { ...parsed, version };
    orm
      .insert(workflows)
      .values({
        id: stored.id,
        version,
        def: JSON.stringify(stored),
        status: stored.status,
        createdAt: new Date().toISOString(),
      })
      .run();
    return stored;
  }

  return {
    // A blank chore reducer: status 'draft', a manual trigger, no steps.
    // Trigger title/summary come from the catalog so the defaults stay in
    // one place. The id is regenerated on the (essentially impossible)
    // collision rather than version-bumping somebody else's workflow.
    createWorkflow(o: { name: string; description: string }): WorkflowType {
      const manual = catalog['trigger.manual']!;
      let id = `wf-${nanoid(6)}`;
      while (
        orm.select().from(workflows).where(eq(workflows.id, id)).orderBy(desc(workflows.version)).get()
      ) {
        id = `wf-${nanoid(6)}`;
      }
      return insertWorkflowVersion(
        Workflow.parse({
          id,
          name: o.name,
          description: o.description,
          version: 1,
          status: 'draft',
          trigger: {
            id: 'trigger',
            type: 'trigger.manual',
            title: manual.title,
            summary: manual.description,
            config: {},
            inputs: {},
            position: { x: 0, y: 0 },
          },
          steps: [],
          edges: [],
        }),
        1,
      );
    },

    // Rewrites the latest version's row in place: the version number and
    // created_at stay put. ONLY for position-only moves — everything else
    // goes through saveWorkflow so the version history stays meaningful.
    // The caller's version field is ignored (stamped with the latest).
    updateLatestInPlace(wf: WorkflowType): WorkflowType {
      const parsed = Workflow.parse(wf);
      const latest = orm
        .select()
        .from(workflows)
        .where(eq(workflows.id, parsed.id))
        .orderBy(desc(workflows.version))
        .get();
      if (!latest) throw new Error(`Unknown workflow: ${parsed.id}`);
      const stored: WorkflowType = { ...parsed, version: latest.version };
      orm
        .update(workflows)
        .set({ def: JSON.stringify(stored), status: stored.status })
        .where(and(eq(workflows.id, parsed.id), eq(workflows.version, latest.version)))
        .run();
      return stored;
    },

    saveWorkflow(wf: WorkflowType): WorkflowType {
      // Validate first (throws on invalid incl. dup ids/dangling edges) and
      // store the parsed def, which also strips unknown keys.
      const parsed = Workflow.parse(wf);
      const { version: _incomingVersion, ...incomingShape } = parsed;
      const incomingCanon = stableStringify(incomingShape);
      const latest = orm
        .select()
        .from(workflows)
        .where(eq(workflows.id, parsed.id))
        .orderBy(desc(workflows.version))
        .get();
      if (!latest) return insertWorkflowVersion(parsed, 1);
      const storedDef = parseWorkflowDef(latest.def, latest.id, latest.version);
      const { version: _storedVersion, ...storedShape } = storedDef;
      // Unchanged (ignoring the caller's version field): keep the stored row.
      if (stableStringify(storedShape) === incomingCanon) return storedDef;
      // ANY definition change — including a status flip — bumps the version.
      return insertWorkflowVersion(parsed, latest.version + 1);
    },

    getWorkflow(id: string, version?: number): WorkflowType | undefined {
      const row =
        version === undefined
          ? orm
              .select()
              .from(workflows)
              .where(eq(workflows.id, id))
              .orderBy(desc(workflows.version))
              .get()
          : orm
              .select()
              .from(workflows)
              .where(and(eq(workflows.id, id), eq(workflows.version, version)))
              .get();
      if (!row) return undefined;
      return parseWorkflowDef(row.def, row.id, row.version);
    },

    // Latest version of each workflow, newest first by the latest version's
    // created_at (rowid breaks created_at ties so the order is deterministic).
    listWorkflows(): WorkflowType[] {
      const rows = orm
        .select({
          id: workflows.id,
          version: workflows.version,
          def: workflows.def,
          createdAt: workflows.createdAt,
          rowid: sql<number>`"workflows"."rowid"`,
        })
        .from(workflows)
        .orderBy(asc(workflows.id), desc(workflows.version))
        .all();
      const latestById = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        if (!latestById.has(row.id)) latestById.set(row.id, row);
      }
      const latest = [...latestById.values()].sort((a, b) =>
        b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : b.rowid - a.rowid,
      );
      return latest.map((row) => parseWorkflowDef(row.def, row.id, row.version));
    },

    createRun(
      r: Omit<RunType, 'id' | 'startedAt' | 'kind' | 'usedSample'> & { kind?: RunType['kind'] },
    ): RunType {
      const run = Run.parse({ ...r, id: randomUUID(), startedAt: new Date().toISOString() });
      orm
        .insert(runs)
        .values({
          id: run.id,
          workflowId: run.workflowId,
          workflowVersion: run.workflowVersion,
          triggerPayload: toJson(run.triggerPayload),
          status: run.status,
          kind: run.kind,
          // Runs start un-sampled; testRun flips it via updateRun afterwards.
          usedSample: 0,
          startedAt: run.startedAt,
          endedAt: run.endedAt ?? null,
        })
        .run();
      return run;
    },

    updateRun(id: string, patch: Partial<RunType>): void {
      const row = orm.select().from(runs).where(eq(runs.id, id)).get();
      if (!row) throw new Error(`Unknown run: ${id}`);
      const { id: _ignored, ...rest } = patch;
      // undefined values are skipped (cannot unset a field); id is always ignored.
      const defined = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      const merged = Run.parse({ ...rowToRun(row), ...defined });
      orm
        .update(runs)
        .set({
          workflowId: merged.workflowId,
          workflowVersion: merged.workflowVersion,
          triggerPayload: toJson(merged.triggerPayload),
          status: merged.status,
          kind: merged.kind,
          usedSample: merged.usedSample ? 1 : 0,
          startedAt: merged.startedAt,
          endedAt: merged.endedAt ?? null,
        })
        .where(eq(runs.id, id))
        .run();
    },

    upsertStepRun(sr: StepRunType): void {
      const parsed = StepRun.parse(sr);
      orm
        .insert(stepRuns)
        .values({
          id: parsed.id,
          runId: parsed.runId,
          stepId: parsed.stepId,
          status: parsed.status,
          input: toJson(parsed.input),
          output: toJson(parsed.output),
          error: parsed.error ?? null,
          model: parsed.model ?? null,
          tokens: toJson(parsed.tokens),
          costUsd: parsed.costUsd ?? null,
          durationMs: parsed.durationMs ?? null,
          why: parsed.why ?? null,
          startedAt: parsed.startedAt,
        })
        .onConflictDoUpdate({
          target: stepRuns.id,
          // All mutable fields; id/run_id/step_id/started_at keep first-write values.
          set: {
            status: parsed.status,
            input: toJson(parsed.input),
            output: toJson(parsed.output),
            error: parsed.error ?? null,
            model: parsed.model ?? null,
            tokens: toJson(parsed.tokens),
            costUsd: parsed.costUsd ?? null,
            durationMs: parsed.durationMs ?? null,
            why: parsed.why ?? null,
          },
        })
        .run();
    },

    // Steps in rowid (insertion) order. Display order (topo) is the caller's job.
    getRun(id: string): { run: RunType; steps: StepRunType[] } | undefined {
      const row = orm.select().from(runs).where(eq(runs.id, id)).get();
      if (!row) return undefined;
      const stepRows = orm
        .select()
        .from(stepRuns)
        .where(eq(stepRuns.runId, id))
        .orderBy(sql`"rowid"`)
        .all();
      return { run: rowToRun(row), steps: stepRows.map(rowToStepRun) };
    },

    // Newest first (started_at DESC, rowid DESC breaks ties deterministically).
    // Test runs are hidden unless explicitly asked for (history shows live runs).
    listRuns(o?: { workflowId?: string; limit?: number; includeTests?: boolean }): RunType[] {
      if (o?.limit !== undefined) {
        if (typeof o.limit !== 'number' || !Number.isInteger(o.limit) || o.limit < 0) {
          throw new Error(`Invalid limit: ${o.limit}`);
        }
        if (o.limit === 0) return [];
      }
      const conds = [];
      if (o?.workflowId !== undefined) conds.push(eq(runs.workflowId, o.workflowId));
      if (o?.includeTests !== true) conds.push(ne(runs.kind, 'test'));
      const where = conds.length === 0 ? undefined : and(...conds);
      const order = [desc(runs.startedAt), sql`"rowid" DESC`] as const;
      if (o?.limit !== undefined) {
        return orm
          .select()
          .from(runs)
          .where(where)
          .orderBy(...order)
          .limit(o.limit)
          .all()
          .map(rowToRun);
      }
      return orm.select().from(runs).where(where).orderBy(...order).all().map(rowToRun);
    },
  };
}

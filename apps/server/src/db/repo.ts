import { randomUUID } from 'node:crypto';
import {
  Run,
  StepRun,
  Workflow,
  type Run as RunType,
  type StepRun as StepRunType,
  type Workflow as WorkflowType,
} from '@dad/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
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
`;

export interface Repo {
  saveWorkflow(wf: WorkflowType): WorkflowType;
  getWorkflow(id: string, version?: number): WorkflowType | undefined;
  listWorkflows(): WorkflowType[];
  createRun(r: Omit<RunType, 'id' | 'startedAt'>): RunType;
  updateRun(id: string, patch: Partial<RunType>): void;
  upsertStepRun(sr: StepRunType): void;
  getRun(id: string): { run: RunType; steps: StepRunType[] } | undefined;
  listRuns(o?: { workflowId?: string; limit?: number }): RunType[];
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

    createRun(r: Omit<RunType, 'id' | 'startedAt'>): RunType {
      const run = Run.parse({ ...r, id: randomUUID(), startedAt: new Date().toISOString() });
      orm
        .insert(runs)
        .values({
          id: run.id,
          workflowId: run.workflowId,
          workflowVersion: run.workflowVersion,
          triggerPayload: toJson(run.triggerPayload),
          status: run.status,
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
    listRuns(o?: { workflowId?: string; limit?: number }): RunType[] {
      if (o?.limit !== undefined) {
        if (typeof o.limit !== 'number' || !Number.isInteger(o.limit) || o.limit < 0) {
          throw new Error(`Invalid limit: ${o.limit}`);
        }
        if (o.limit === 0) return [];
      }
      const where = o?.workflowId !== undefined ? eq(runs.workflowId, o.workflowId) : undefined;
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

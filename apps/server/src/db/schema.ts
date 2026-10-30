import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Drizzle schema for workflow versions and the run log. Column names are
// declared explicitly in snake_case and MUST match the hand-written DDL in
// repo.ts exactly (M1 uses CREATE TABLE IF NOT EXISTS, no migration tool).

export const workflows = sqliteTable(
  'workflows',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    def: text('def').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] })],
);

export const runs = sqliteTable('runs', {
  id: text('id').notNull().primaryKey(),
  workflowId: text('workflow_id').notNull(),
  workflowVersion: integer('workflow_version').notNull(),
  triggerPayload: text('trigger_payload'),
  status: text('status').notNull(),
  kind: text('kind').notNull().default('live'),
  usedSample: integer('used_sample').notNull().default(0),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
});

export const conversations = sqliteTable('conversations', {
  workflowId: text('workflow_id').notNull().primaryKey(),
  messages: text('messages').notNull(),
  transcript: text('transcript').notNull().default('[]'),
  updatedAt: text('updated_at').notNull(),
});

export const stepRuns = sqliteTable('step_runs', {
  id: text('id').notNull().primaryKey(),
  runId: text('run_id').notNull(),
  stepId: text('step_id').notNull(),
  status: text('status').notNull(),
  input: text('input'),
  output: text('output'),
  error: text('error'),
  model: text('model'),
  tokens: text('tokens'),
  costUsd: real('cost_usd'),
  durationMs: integer('duration_ms'),
  why: text('why'),
  startedAt: text('started_at').notNull(),
});

import { Workflow } from '@dad/shared';
import type { Repo } from '../db/repo.js';
import flow1 from './flow1.json' with { type: 'json' };

/**
 * One-way M2 migration: installs whose flow-1 predates the approval step get
 * the new definition saved as the NEXT version — never a rewrite of v1, so
 * old runs stay pinned to the version they started on (run.workflowVersion).
 *
 * Idempotent: re-runs are no-ops, guarded both here (the approve-step check)
 * and in the repo (unchanged shapes keep the stored row). Runs AFTER the
 * empty-store seed in main.ts, so fresh installs — which seed this same file
 * directly as v1 — are already on the approval shape and no-op here.
 */
export function migrateFlow1Seed(repo: Repo): void {
  const existing = repo.getWorkflow('flow-1');
  // Fresh store (seeded by main.ts) or a user-deleted flow-1: don't resurrect.
  if (!existing) return;
  // Already on the approval shape: nothing to do.
  if (existing.steps.some((s) => s.id === 'approve')) return;
  repo.saveWorkflow(Workflow.parse(flow1));
}

import type { Run, Workflow } from '@onesaas/shared';

/**
 * ?run= validation. A valid id (present in the workflow's runs) wins,
 * otherwise the newest run is selected (the server lists newest-first, so
 * runs[0]). Undefined while loading or when the workflow has no runs yet.
 */
export function resolveRunId(raw: string | null, runs: Run[] | undefined): string | undefined {
  if (!runs || runs.length === 0) return undefined;
  if (raw !== null && runs.some((r) => r.id === raw)) return raw;
  return runs[0]!.id;
}

/**
 * ?step= validation. A valid id (the trigger or a step of the run's OWN
 * pinned workflow version — cross-version links go stale after saveWorkflow
 * bumps) selects that step; anything else closes the inspector (undefined).
 */
export function resolveStepId(
  raw: string | null,
  workflow: Workflow | undefined,
): string | undefined {
  if (raw === null || !workflow) return undefined;
  const ids = new Set([workflow.trigger.id, ...workflow.steps.map((s) => s.id)]);
  return ids.has(raw) ? raw : undefined;
}

/** Design and Runs share one screen: ?mode=runs, or any link to a specific run. */
export function isRunsMode(params: URLSearchParams): boolean {
  return params.get('mode') === 'runs' || params.get('run') !== null;
}

/** Opens an automation in Runs mode on one run. */
export function runPath(workflowId: string, runId: string): string {
  return `/automations/${workflowId}?mode=runs&run=${runId}`;
}

/** What Runs mode shows first: the oldest thing waiting for you, else the newest run. */
export function preferredRun(runs: Run[] | undefined): Run | undefined {
  if (!runs || runs.length === 0) return undefined;
  const waiting = runs.filter((r) => r.status === 'waiting');
  return waiting[waiting.length - 1] ?? runs[0];
}

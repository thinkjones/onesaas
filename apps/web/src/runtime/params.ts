import type { Run, Workflow } from '@dad/shared';

export type WorkflowMode = 'design' | 'runtime';

/**
 * ?mode= validation. Defaults to 'runtime'; 'design' falls back to 'runtime'
 * until M3 ships it (the switch renders Design disabled, so only a crafted
 * link can carry mode=design — showing the runtime view beats a dead page).
 * Unknown values (mode=garbage) also fall back to 'runtime'.
 */
export function parseModeParam(raw: string | null): WorkflowMode {
  // Until M3 every value — 'design', 'runtime', garbage, absent — lands on
  // runtime; the branch stays explicit so M3 flips one line.
  if (raw === 'design') return 'runtime'; // M3: return 'design'
  return 'runtime';
}

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

import { useQueries } from '@tanstack/react-query';
import type { StepRun } from '@dad/shared';
import { History, TriangleAlert } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { getRun, useRun, useRuns } from '../api.ts';
import WorkflowCanvas from '../canvas/WorkflowCanvas.tsx';
import EmptyState from '../design/EmptyState.tsx';
import Inspector from './Inspector.tsx';
import { resolveRunId, resolveStepId } from './params.ts';
import RunsList from './RunsList.tsx';
import RunStory from './RunStory.tsx';

/**
 * The runtime screen: runs list left (300px), run story + canvas centre,
 * inspector sheet on node click. Selections live in the URL (?run=, ?step=)
 * so they are linkable (M3's "Fix this step" and M5's explain links use it).
 *
 * Canvas seams (per review): stepRuns is a memoized Record (a fresh object
 * per SSE event would churn nodes), onSelectStep is a useCallback, and
 * renderNodeExtra is left undefined for Task 6 — no inline lambdas into the
 * canvas. There is deliberately no canvas-driven deselect: the inspector
 * closes (and ?step= clears) only around the canvas, via the sheet's close.
 */
export default function RuntimeView({ workflowId }: { workflowId: string }) {
  const [params, setParams] = useSearchParams();
  const runsQuery = useRuns(workflowId);
  const runs = runsQuery.data;

  const runId = resolveRunId(params.get('run'), runs);
  const detailQuery = useRun(runId ?? '', { enabled: runId !== undefined });
  const detail = detailQuery.data;

  // One cached detail query per row for its story last line (N+1, same as the
  // ChoreReducersPage precedent — runs lists are small in M2). The selected
  // run's query is shared with useRun above via the ['run', id] key, so it
  // costs no extra request.
  const storyQueries = useQueries({
    queries: (runs ?? []).map((r) => ({
      queryKey: ['run', r.id],
      queryFn: () => getRun(r.id),
    })),
  });
  const lastLineByRunId = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const [i, r] of (runs ?? []).entries()) {
      const story = storyQueries[i]?.data?.story;
      map[r.id] = story?.[story.length - 1];
    }
    return map;
  }, [runs, storyQueries]);

  const stepRuns = useMemo(() => {
    const map: Record<string, StepRun> = {};
    for (const s of detail?.steps ?? []) map[s.stepId] = s;
    return map;
  }, [detail]);

  const selectedStepId = resolveStepId(params.get('step'), detail?.workflow);

  const handleSelectRun = useCallback(
    (id: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('run', id);
        // A step selection belongs to its run (pinned versions can differ
        // across runs), so switching runs clears it.
        next.delete('step');
        return next;
      });
    },
    [setParams],
  );

  const handleSelectStep = useCallback(
    (stepId: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('step', stepId);
        return next;
      });
    },
    [setParams],
  );

  const handleCloseInspector = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('step');
      return next;
    });
  }, [setParams]);

  if (runsQuery.isPending) return <p className="text-base">Loading runs…</p>;
  if (runsQuery.isError || !runs) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Couldn't load runs"
        hint="Check the server is running and try again."
      />
    );
  }
  if (runs.length === 0 || runId === undefined) {
    return (
      <EmptyState
        icon={History}
        title="No runs yet"
        hint="Run this chore reducer once and it will show up here."
      />
    );
  }
  if (detailQuery.isPending || !detail) {
    return <p className="text-base">Loading run…</p>;
  }
  if (detailQuery.isError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Couldn't load this run"
        hint="It may have been deleted; pick another run on the left."
      />
    );
  }

  const selectedStep =
    selectedStepId === undefined
      ? undefined
      : selectedStepId === detail.workflow.trigger.id
        ? detail.workflow.trigger
        : detail.workflow.steps.find((s) => s.id === selectedStepId);

  return (
    <div className="flex gap-4">
      <div className="w-[300px] shrink-0">
        <RunsList
          runs={runs}
          selectedRunId={runId}
          onSelect={handleSelectRun}
          lastLineByRunId={lastLineByRunId}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <RunStory story={detail.story} />
        <div className="min-h-[480px] flex-1 rounded-[var(--radius)] border border-border bg-card">
          <WorkflowCanvas
            workflow={detail.workflow}
            mode="runtime"
            stepRuns={stepRuns}
            selectedStepId={selectedStepId}
            onSelectStep={handleSelectStep}
          />
        </div>
      </div>
      {/* Keyed by step so the sheet (incl. the Show-details toggle) resets per selection. */}
      <Inspector
        key={selectedStepId ?? 'none'}
        stepRun={selectedStepId === undefined ? undefined : stepRuns[selectedStepId]}
        title={selectedStep?.title ?? selectedStepId ?? ''}
        open={selectedStepId !== undefined}
        onClose={handleCloseInspector}
      />
    </div>
  );
}

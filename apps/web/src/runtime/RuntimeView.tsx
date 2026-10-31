import { useQueries } from '@tanstack/react-query';
import type { Run, StepRun } from '@dad/shared';
import { History, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { getRun, useRun, useRuns, useSettings } from '../api.ts';
import WorkflowCanvas from '../canvas/WorkflowCanvas.tsx';
import MoodBackdrop from '../mood/MoodBackdrop.tsx';
import EmptyState from '../design/EmptyState.tsx';
import ApprovalCard from './ApprovalCard.tsx';
import FailureCard from './FailureCard.tsx';
import Inspector from './Inspector.tsx';
import { resolveRunId, resolveStepId } from './params.ts';
import RunsList from './RunsList.tsx';
import RunStory from './RunStory.tsx';

/**
 * Two-column shell (300px runs list left, detail pane right) shared by the
 * loading, error, and loaded branches, so the list stays mounted — the
 * recovery hint ("pick another run on the left") is only honest if the
 * list is actually there. The inspector renders in a portal, so passing it
 * as a child costs the flex layout nothing.
 */
function RuntimeShell({
  runs,
  selectedRunId,
  onSelectRun,
  lastLineByRunId,
  children,
}: {
  runs: Run[];
  selectedRunId: string | undefined;
  onSelectRun: (id: string) => void;
  lastLineByRunId: Record<string, string | undefined>;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="w-[300px] shrink-0">
        <RunsList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={onSelectRun}
          lastLineByRunId={lastLineByRunId}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
    </div>
  );
}

/** Waiting approval output is `{ proposed: { text } }`; anything else yields ''. */
function proposedTextOf(output: unknown): string {
  if (typeof output !== 'object' || output === null) return '';
  const proposed = (output as Record<string, unknown>)['proposed'];
  if (typeof proposed !== 'object' || proposed === null) return '';
  const text = (proposed as Record<string, unknown>)['text'];
  return typeof text === 'string' ? text : '';
}

/**
 * The runtime screen: runs list left (300px), run story + canvas centre,
 * inspector sheet on node click. Selections live in the URL (?run=, ?step=)
 * so they are linkable (M3's "Fix this step" and M5's explain links use it).
 *
 * Canvas seams (per review): stepRuns is a memoized Record (a fresh object
 * per SSE event would churn nodes), onSelectStep is a useCallback, and
 * renderNodeExtra is a useCallback closed over the run detail — no inline
 * lambdas into the canvas. There is deliberately no canvas-driven deselect:
 * the inspector closes (and ?step= clears) only around the canvas, via the
 * sheet's close.
 */
export interface FixStepInfo {
  stepId: string;
  title: string;
  error: string;
}

export default function RuntimeView({
  workflowId,
  onFixStep,
}: {
  workflowId: string;
  /** "Fix this step" handoff: WorkflowPage opens design mode on the step. */
  onFixStep?: (info: FixStepInfo) => void;
}) {
  const [params, setParams] = useSearchParams();
  const runsQuery = useRuns(workflowId);
  const runs = runsQuery.data;
  // Runtime mode is silent and unadorned: the backdrop stays mounted but faded out.
  const { settings } = useSettings();

  const rawRunParam = params.get('run');
  const runId = resolveRunId(rawRunParam, runs);
  const detailQuery = useRun(runId ?? '', { enabled: runId !== undefined });
  const detail = detailQuery.data;

  // Pin the resolved run back into ?run=. Without this, landing bare (or on
  // a stale id) selects newest only implicitly — then a newer run arriving
  // via SSE silently yanks the whole view, and copied links diverge from
  // what's shown. Replace (not push) adds no history entry and ?step= is
  // preserved; the write fires only when different, so this never loops.
  useEffect(() => {
    if (runId !== undefined && runId !== rawRunParam) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('run', runId);
          return next;
        },
        { replace: true },
      );
    }
  }, [runId, rawRunParam, setParams]);

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
  // Recomputed every render on purpose: the useQueries result array is
  // rebuilt each render, so a useMemo keyed on it would never memoize.
  // (useQueries({ combine }) would memoize but obscures the tiny loop;
  // runs lists are small in M2, so the honest recompute wins.)
  const lastLineByRunId: Record<string, string | undefined> = {};
  for (const [i, r] of (runs ?? []).entries()) {
    const story = storyQueries[i]?.data?.story;
    lastLineByRunId[r.id] = story?.[story.length - 1];
  }

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

  // Approval / failure cards under waiting / failed nodes. A useCallback
  // closed over the run detail (an inline lambda would churn the canvas nodes
  // on every SSE event); the cards call useApprove/useRetry themselves
  // because this is a plain function, not a hook context. The question lives
  // in the pinned workflow's step config — StepRuns carry only the proposal —
  // with the manual 'Is this OK to use?' default (the catalog .default()
  // never applies at runtime). Tall extras shift React Flow node centres
  // (handles dive, accepted aesthetic); verified no edge overlaps the cards
  // on linear flow 1 — forked graphs may need extra rank spacing in M3+.
  const renderNodeExtra = useCallback(
    (stepId: string): ReactNode => {
      if (runId === undefined || detail === undefined) return undefined;
      const stepRun = stepRuns[stepId];
      if (stepRun?.status === 'waiting') {
        const step = detail.workflow.steps.find((s) => s.id === stepId);
        const rawQuestion = step?.config['question'];
        const question =
          typeof rawQuestion === 'string' ? rawQuestion : 'Is this OK to use?';
        return (
          <ApprovalCard
            runId={runId}
            stepId={stepId}
            question={question}
            proposedText={proposedTextOf(stepRun.output)}
          />
        );
      }
      if (stepRun?.status === 'failed') {
        const error = stepRun.error ?? 'Something went wrong.';
        const failed =
          stepId === detail.workflow.trigger.id
            ? detail.workflow.trigger
            : detail.workflow.steps.find((s) => s.id === stepId);
        return (
          <FailureCard
            runId={runId}
            stepId={stepId}
            error={error}
            onFixStep={
              onFixStep
                ? () => onFixStep({ stepId, title: failed?.title ?? stepId, error })
                : undefined
            }
          />
        );
      }
      return undefined;
    },
    [detail, runId, stepRuns, onFixStep],
  );

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
  // The error branch comes first: on error `detail` is undefined, so the
  // `!detail` pending check below would swallow it into "Loading run…" forever.
  if (detailQuery.isError) {
    return (
      <RuntimeShell
        runs={runs}
        selectedRunId={runId}
        onSelectRun={handleSelectRun}
        lastLineByRunId={lastLineByRunId}
      >
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this run"
          hint="It may have been deleted; pick another run on the left."
        />
      </RuntimeShell>
    );
  }
  if (detailQuery.isPending || !detail) {
    return (
      <RuntimeShell
        runs={runs}
        selectedRunId={runId}
        onSelectRun={handleSelectRun}
        lastLineByRunId={lastLineByRunId}
      >
        <p className="text-base">Loading run…</p>
      </RuntimeShell>
    );
  }

  const selectedStep =
    selectedStepId === undefined
      ? undefined
      : selectedStepId === detail.workflow.trigger.id
        ? detail.workflow.trigger
        : detail.workflow.steps.find((s) => s.id === selectedStepId);

  return (
    <RuntimeShell
      runs={runs}
      selectedRunId={runId}
      onSelectRun={handleSelectRun}
      lastLineByRunId={lastLineByRunId}
    >
      <RunStory story={detail.story} />
      <div className="relative isolate h-[560px] rounded-[var(--radius)] border border-border bg-card">
        <MoodBackdrop visible={false} fileIds={settings?.moodFileIds ?? []} />
        <WorkflowCanvas
          workflow={detail.workflow}
          mode="runtime"
          stepRuns={stepRuns}
          selectedStepId={selectedStepId}
          onSelectStep={handleSelectStep}
          renderNodeExtra={renderNodeExtra}
        />
      </div>
      {/* Keyed by step so the sheet (incl. the Show-details toggle) resets per selection. */}
      <Inspector
        key={selectedStepId ?? 'none'}
        stepRun={selectedStepId === undefined ? undefined : stepRuns[selectedStepId]}
        title={selectedStep?.title ?? selectedStepId ?? ''}
        open={selectedStepId !== undefined}
        onClose={handleCloseInspector}
        explainTarget={
          selectedStepId === undefined
            ? undefined
            : { kind: 'step', id: selectedStepId, context: detail.workflow.id }
        }
        explainLabel={selectedStep?.title}
        code={
          selectedStep?.type === 'code.transform' &&
          typeof selectedStep.config['code'] === 'string'
            ? (selectedStep.config['code'] as string)
            : undefined
        }
      />
    </RuntimeShell>
  );
}

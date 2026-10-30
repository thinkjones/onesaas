import { catalog, type Edge, type StepInstance, type StepRun, type Workflow } from '@dad/shared';
import { useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  ApiError,
  getRun,
  useAgentEvents,
  useTestRun,
  useWorkflowDetail,
  useWorkflowOp,
  type AgentEvent,
  type OpResult,
  type TestRunResponse,
  type WorkflowDetail,
  type WorkflowOpName,
} from '../api.ts';
import WorkflowCanvas, { type CanvasOp, type GhostStep } from '../canvas/WorkflowCanvas.tsx';
import { resolveStepId } from '../runtime/params.ts';
import AppButton from './AppButton.tsx';
import ConfigForm, { type ConfigSave } from './ConfigForm.tsx';
import EmptyState from './EmptyState.tsx';
import ProblemsBadge from './ProblemsBadge.tsx';
import StepPalette from './StepPalette.tsx';
import TestResults from './TestResults.tsx';

export interface BuiltInfo {
  stepId: string;
  title: string;
}

export interface DesignViewProps {
  workflowId: string;
  /** Turn-on succeeded: the mode container switches to runtime. */
  onRequestRuntime(): void;
  /**
   * Fired when an agent-built step lands on the canvas (the M5 chime hook).
   * No-op by default.
   */
  onBuilt?(info: BuiltInfo): void;
}

/** Surfaces the parsed server message; network failures get a plain-words fallback. */
function toastOpError(error: unknown): void {
  toast.error(
    error instanceof ApiError && error.message
      ? error.message
      : "Couldn't reach the server. Try again.",
  );
}

function findStep(workflow: Workflow, stepId: string): StepInstance | undefined {
  if (workflow.trigger.id === stepId) return workflow.trigger;
  return workflow.steps.find((s) => s.id === stepId);
}

/**
 * The design screen: problems-or-turn-on + "Try it" top bar, step palette on
 * the left, canvas in the middle, the selected step's settings on the right.
 *
 * Canvas edits (drag, connect, disconnect, Backspace-delete) go through the
 * ops route; deletes snapshot the step client-side first so Undo re-adds the
 * exact prior state (fields, bindings, edges, position) while the toast is
 * alive. Agent `plan` events show ghost boxes; each `built` resolves its
 * step's title against the refetched workflow and swaps the FIRST unmatched
 * ghost with that title for the real box (duplicate titles match in order).
 */
export default function DesignView({ workflowId, onRequestRuntime, onBuilt }: DesignViewProps) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const detailQuery = useWorkflowDetail(workflowId);
  const detail = detailQuery.data;
  const op = useWorkflowOp(workflowId);
  const { mutateAsync } = op;
  const testRun = useTestRun(workflowId);

  const [ghosts, setGhosts] = useState<GhostStep[]>([]);
  const [ghostEdges, setGhostEdges] = useState<Edge[]>([]);
  const [matchedGhostIds, setMatchedGhostIds] = useState<string[]>([]);
  const [pendingBuilt, setPendingBuilt] = useState<string[]>([]);
  const [builtIds, setBuiltIds] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<TestRunResponse | null>(null);
  // onBuilt must fire exactly once per built step even under effect re-runs.
  const builtFired = useRef<Set<string>>(new Set());

  // One ops call with uniform failure surfacing: refused ops toast the
  // server's readable error, transport failures the fallback. Never throws.
  const send = useCallback(
    async (call: { op: WorkflowOpName; args: unknown[] }): Promise<OpResult | undefined> => {
      try {
        const res = await mutateAsync(call);
        if (!res.ok) toast.error(res.error);
        return res;
      } catch (err) {
        toastOpError(err);
        return undefined;
      }
    },
    [mutateAsync],
  );

  const handleAgentEvent = useCallback(
    (e: AgentEvent) => {
      if (e.type === 'plan') {
        // A new plan replaces the previous ghosts wholesale.
        setGhosts(e.ghosts);
        setGhostEdges(e.edges);
        setMatchedGhostIds([]);
      } else if (e.type === 'built') {
        setPendingBuilt((prev) => (prev.includes(e.stepId) ? prev : [...prev, e.stepId]));
        // Agent ops don't push workflow state over SSE, so the fresh step
        // arrives via refetch; resolution happens in the effect below.
        void client.invalidateQueries({ queryKey: ['workflow', workflowId] });
      } else if (e.type === 'test') {
        getRun(e.runId).then(
          (runDetail) =>
            setTestResult({
              run: runDetail.run,
              steps: runDetail.steps,
              usedSample: runDetail.run.usedSample,
              story: runDetail.story,
            }),
          () => toast.error("Couldn't load the test results."),
        );
      }
    },
    [client, workflowId],
  );
  useAgentEvents(workflowId, handleAgentEvent);

  // Resolves pending builts once the refetched workflow contains their steps.
  useEffect(() => {
    if (!detail || pendingBuilt.length === 0) return;
    const stepsById = new Map<string, StepInstance>([[detail.trigger.id, detail.trigger]]);
    for (const s of detail.steps) stepsById.set(s.id, s);
    const resolved = pendingBuilt.filter((id) => stepsById.has(id) && !builtIds.includes(id));
    if (resolved.length === 0) return;
    setPendingBuilt((prev) => prev.filter((id) => !resolved.includes(id)));
    setBuiltIds((prev) => [...prev, ...resolved.filter((id) => !prev.includes(id))]);
    setMatchedGhostIds((prevMatched) => {
      const matched = [...prevMatched];
      for (const id of resolved) {
        const ghost = ghosts.find((g) => g.title === stepsById.get(id)!.title && !matched.includes(g.id));
        if (ghost) matched.push(ghost.id);
      }
      return matched;
    });
    for (const id of resolved) {
      if (!builtFired.current.has(id)) {
        builtFired.current.add(id);
        onBuilt?.({ stepId: id, title: stepsById.get(id)!.title });
      }
    }
  }, [detail, pendingBuilt, builtIds, ghosts, onBuilt]);

  const visibleGhosts = useMemo(
    () => ghosts.filter((g) => !matchedGhostIds.includes(g.id)),
    [ghosts, matchedGhostIds],
  );
  const visibleGhostEdges = useMemo(() => {
    const visible = new Set(visibleGhosts.map((g) => g.id));
    return ghostEdges.filter((e) => visible.has(e.from) && visible.has(e.to));
  }, [ghostEdges, visibleGhosts]);

  const selectedStepId = resolveStepId(params.get('step'), detail);

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

  const setSelectedStep = useCallback(
    (stepId: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('step', stepId);
        return next;
      });
    },
    [setParams],
  );

  const handleUndo = useCallback(
    async (snapshot: StepInstance, incoming: Edge[], outgoing: Edge[]) => {
      const current = client.getQueryData<WorkflowDetail>(['workflow', workflowId]);
      const beforeIds = new Set(
        current ? [current.trigger.id, ...current.steps.map((s) => s.id)] : [],
      );
      // Reattach after the first surviving predecessor; an unconnected step
      // stays unconnected, and one whose predecessors are all gone rejoins
      // at the start. Bindings to deleted steps are refused by the server
      // with a readable error (surfaced by send) rather than silently kept.
      const surviving = incoming.map((e) => e.from).find((id) => beforeIds.has(id));
      const after =
        surviving ?? (incoming.length === 0 ? undefined : current?.trigger.id);
      const added = await send({
        op: 'addStep',
        args: [
          {
            type: snapshot.type,
            title: snapshot.title,
            summary: snapshot.summary,
            config: snapshot.config,
            inputs: snapshot.inputs,
            ...(after ? { after } : {}),
          },
        ],
      });
      if (!added?.ok) return;
      const restored = added.workflow.steps.find((s) => !beforeIds.has(s.id));
      if (!restored) {
        toast.error("Couldn't bring that step back. Try again.");
        return;
      }
      const ids = new Set([added.workflow.trigger.id, ...added.workflow.steps.map((s) => s.id)]);
      const have = new Set(added.workflow.edges.map((e) => `${e.from}->${e.to}`));
      const map = (id: string): string => (id === snapshot.id ? restored.id : id);
      for (const e of [...incoming, ...outgoing]) {
        const from = map(e.from);
        const to = map(e.to);
        if (!ids.has(from) || !ids.has(to)) continue;
        if (have.has(`${from}->${to}`)) continue;
        const res = await send({
          op: 'connect',
          args: [{ from, to, ...(e.when ? { when: e.when } : {}) }],
        });
        if (!res?.ok) return;
        have.add(`${from}->${to}`);
      }
      const moved = await send({ op: 'move', args: [restored.id, snapshot.position] });
      if (!moved?.ok) return;
      setSelectedStep(restored.id);
    },
    [client, workflowId, send, setSelectedStep],
  );

  const handleRemove = useCallback(
    async (stepId: string) => {
      const wf = client.getQueryData<WorkflowDetail>(['workflow', workflowId]) ?? detail;
      if (!wf) return;
      if (stepId === wf.trigger.id) {
        toast.error("The start of the reducer can't be deleted.");
        return;
      }
      const snapshot = wf.steps.find((s) => s.id === stepId);
      if (!snapshot) return;
      const incoming = wf.edges.filter((e) => e.to === stepId);
      const outgoing = wf.edges.filter((e) => e.from === stepId);
      const res = await send({ op: 'removeStep', args: [stepId] });
      if (!res?.ok) return;
      toast.success(`Deleted "${snapshot.title}".`, {
        duration: 5000,
        action: { label: 'Undo', onClick: () => void handleUndo(snapshot, incoming, outgoing) },
      });
    },
    [client, workflowId, detail, send, handleUndo],
  );

  const handleCanvasOp = useCallback(
    (canvasOp: CanvasOp) => {
      if (canvasOp.op === 'remove') {
        void handleRemove(canvasOp.stepId);
      } else if (canvasOp.op === 'move') {
        void send({ op: 'move', args: [canvasOp.stepId, canvasOp.position] });
      } else if (canvasOp.op === 'connect') {
        void send({ op: 'connect', args: [{ from: canvasOp.from, to: canvasOp.to }] });
      } else if (canvasOp.op === 'disconnect') {
        void send({ op: 'disconnect', args: [{ from: canvasOp.from, to: canvasOp.to }] });
      }
    },
    [send, handleRemove],
  );

  const handleAddStep = useCallback(
    async (type: string) => {
      const wf = detail;
      if (!wf) return;
      const def = catalog[type];
      if (!def) return;
      if (def.kind === 'trigger') {
        // There is only ever one start box: a "When" pick swaps it, then its
        // settings open so Dad can set it up (empty config flags a problem).
        const res = await send({ op: 'setTrigger', args: [{ type, config: {} }] });
        if (res?.ok) setSelectedStep(wf.trigger.id);
        return;
      }
      const after = selectedStepId ?? wf.steps[wf.steps.length - 1]?.id ?? wf.trigger.id;
      const beforeIds = new Set([wf.trigger.id, ...wf.steps.map((s) => s.id)]);
      const res = await send({
        op: 'addStep',
        args: [
          {
            type,
            title: def.title,
            summary: def.description,
            config: {},
            inputs: {},
            after,
          },
        ],
      });
      if (!res?.ok) return;
      const addedStep = res.workflow.steps.find((s) => !beforeIds.has(s.id));
      if (addedStep) setSelectedStep(addedStep.id);
    },
    [detail, selectedStepId, send, setSelectedStep],
  );

  const handleSave = useCallback(
    async (stepId: string, patch: ConfigSave) => {
      await send({ op: 'updateStep', args: [stepId, patch] });
    },
    [send],
  );

  const handleTurnOn = useCallback(async () => {
    const res = await send({ op: 'setStatus', args: ['on'] });
    if (res?.ok) onRequestRuntime();
  }, [send, onRequestRuntime]);

  const handleTryIt = useCallback(() => {
    testRun.mutate(undefined, {
      onSuccess: (res) => setTestResult(res),
      onError: (err) => toastOpError(err),
    });
  }, [testRun]);

  const problemsByStep = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of detail?.problems ?? []) {
      const list = map.get(p.stepId) ?? [];
      list.push(p.problem);
      map.set(p.stepId, list);
    }
    return map;
  }, [detail]);

  const testByStep = useMemo(() => {
    const map = new Map<string, StepRun>();
    for (const s of testResult?.steps ?? []) map.set(s.stepId, s);
    return map;
  }, [testResult]);

  // Problems badges + "Try it" verdicts under design boxes. A useCallback
  // closed over memoized maps (an inline lambda would churn the canvas nodes
  // on every render, per the RuntimeView review seam).
  const renderNodeExtra = useCallback(
    (stepId: string): ReactNode => {
      const problems = problemsByStep.get(stepId) ?? [];
      const sr = testByStep.get(stepId);
      const verdict = sr
        ? (sr.why ?? (sr.status === 'failed' ? (sr.error ?? 'Something went wrong.') : undefined))
        : undefined;
      if (problems.length === 0 && verdict === undefined) return undefined;
      return (
        <div className="flex flex-col gap-2">
          <ProblemsBadge problems={problems} />
          {verdict !== undefined && <p className="text-base text-muted-foreground">{verdict}</p>}
        </div>
      );
    },
    [problemsByStep, testByStep],
  );

  if (detailQuery.isPending) return <p className="text-base">Loading chore reducer…</p>;
  if (detailQuery.isError || !detail) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Couldn't load this chore reducer"
        hint="Check the server is running and try again."
      />
    );
  }

  const selected = selectedStepId === undefined ? undefined : findStep(detail, selectedStepId);
  const problemCount = detail.problems.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {problemCount === 0 ? (
          <AppButton onClick={() => void handleTurnOn()} disabled={op.isPending}>
            Turn on
          </AppButton>
        ) : (
          <p className="text-base">
            {problemCount} thing{problemCount === 1 ? '' : 's'} to fix before turning on
          </p>
        )}
        <AppButton variant="outline" onClick={handleTryIt} disabled={testRun.isPending}>
          {testRun.isPending ? 'Trying…' : 'Try it'}
        </AppButton>
      </div>
      {testResult && <TestResults story={testResult.story} />}
      <div className="flex gap-4">
        <StepPalette onAddStep={(type) => void handleAddStep(type)} disabled={op.isPending} />
        <div className="min-h-[480px] flex-1 rounded-[var(--radius)] border border-border bg-card">
          <WorkflowCanvas
            workflow={detail}
            mode="design"
            ghosts={visibleGhosts}
            ghostEdges={visibleGhostEdges}
            builtIds={builtIds}
            selectedStepId={selectedStepId}
            onSelectStep={handleSelectStep}
            onChange={handleCanvasOp}
            renderNodeExtra={renderNodeExtra}
          />
        </div>
        {selected && (
          <div className="w-[340px] shrink-0">
            <ConfigForm
              key={selected.id}
              step={selected}
              workflow={detail}
              onSave={(patch) => void handleSave(selected.id, patch)}
              saving={op.isPending}
            />
          </div>
        )}
      </div>
    </div>
  );
}

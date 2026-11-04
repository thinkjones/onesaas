import { catalog, type Edge, type StepInstance, type StepRun, type Workflow } from '@onesaas/shared';
import { useQueryClient } from '@tanstack/react-query';
import Play from 'lucide-react/icons/play';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import XIcon from 'lucide-react/icons/x';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  ApiError,
  PENDING_BUILT_TIMEOUT_MS,
  getRun,
  useAgentEvents,
  useDeleteWorkflow,
  useTestRun,
  useWorkflowDetail,
  useRun,
  useRuns,
  useWorkflowOp,
  type AgentEvent,
  type OpResult,
  type TestRunResponse,
  type WorkflowDetail,
  type WorkflowOpName,
} from '../api.ts';
import type { UseAgentResult } from '../agent/useAgent.ts';
import WorkflowCanvas, { type CanvasOp, type GhostStep } from '../canvas/WorkflowCanvas.tsx';
import type { StepNodeData } from '../canvas/StepNode.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import IdeaPicker from '../home/IdeaPicker.tsx';
import MicButton from '../voice/MicButton.tsx';
import ApprovalCard from '../runtime/ApprovalCard.tsx';
import FailureCard from '../runtime/FailureCard.tsx';
import Inspector from '../runtime/Inspector.tsx';
import { outcomeOf } from '../runtime/outcome.ts';
import { formatRunStart, runDisplayName } from '../runtime/format.ts';
import { isRunsMode, preferredRun, resolveStepId } from '../runtime/params.ts';
import RunsList from '../runtime/RunsList.tsx';
import BarActions from '../shell/BarActions.tsx';
import { sound } from '../sound/sound.ts';
import { useSound } from '../sound/useSound.ts';
import AppButton from './AppButton.tsx';
import ConfigForm, { type ConfigSave } from './ConfigForm.tsx';
import EmptyState from './EmptyState.tsx';
import ModeSwitch from './ModeSwitch.tsx';
import MoreMenu from './MoreMenu.tsx';
import NodeChat, { type ChatMsg, type ChatPick } from './NodeChat.tsx';
import ProblemsBadge from './ProblemsBadge.tsx';
import TestResults from './TestResults.tsx';
import ThisRunPanel from './ThisRunPanel.tsx';
import ToolRail from './ToolRail.tsx';

export interface BuiltInfo {
  stepId: string;
  title: string;
}

export interface DesignViewProps {
  workflowId: string;
  /**
   * The workflow's conversation, owned by the page (Bug #4): the Start box
   * sends the first turn through it, and the RHS chat continues it.
   */
  agent: UseAgentResult;
  /** Append a line to the RHS "Recent changes" log (owned by the page). */
  logActivity(text: string): void;
  /** "Fix this step" on a failed run: hands the failure to the chat. */
  onFixStep?(info: FixStepInfo): void;
  /** Shown in the Runs view (the photo drop for upload flows). */
  runsExtra?: ReactNode;
  /**
   * Fired when an agent-built step lands on the canvas (the M5 chime hook).
   * No-op by default.
   */
  onBuilt?(info: BuiltInfo): void;
}

/**
 * The new-automation start (Bug #4): a step-free workflow opens on a
 * centered chat box with suggestion chips (the Start.png pattern) instead
 * of the canvas. Submitting sends the first turn and the workspace fades
 * in; the conversation continues in the RHS chat.
 */
function DesignStart({ send, busy }: { send: (text: string) => void; busy: boolean }) {
  const [input, setInput] = useState('');
  const [pickedId, setPickedId] = useState<number | undefined>(undefined);
  const submit = useCallback(
    (text: string) => {
      if (text.trim().length === 0 || busy) return;
      send(text.trim());
    },
    [busy, send],
  );
  return (
    <div className="mx-auto my-auto flex w-full max-w-3xl flex-col items-center gap-6 py-16 text-center">
      <h2 className="font-display text-4xl font-bold">What should this automation do?</h2>
      <div className="flex w-full flex-col gap-2 rounded-[var(--radius)] border border-border bg-card p-4 text-left shadow-sm">
        <Textarea
          aria-label="Describe the automation"
          placeholder="When a customer emails me, save them and draft a reply…"
          rows={3}
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(input);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <MicButton onSend={submit} />
          <AppButton variant="brand" onClick={() => submit(input)} disabled={busy || input.trim().length === 0}>
            Build it
          </AppButton>
        </div>
      </div>
      <IdeaPicker
        selectedId={pickedId}
        onPick={(idea) => {
          setInput(idea.ownerAsk);
          setPickedId(idea.id);
        }}
      />
    </div>
  );
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
 * One board, two modes, switched in the floating bar. A step-free workflow
 * opens on the Start chat box; once started, Design shows the canvas with an
 * add-a-step rail and settings attached to the selected card, and Runs lays a
 * chosen run over the same canvas with a list on the left and its story on the
 * right. Waiting and failed steps expand in place.
 *
 * Canvas edits (connect, disconnect, Backspace-delete) go through the ops
 * route; deletes snapshot the step client-side first so Undo re-adds the
 * exact prior state (fields, bindings, edges) while the toast is alive.
 * Agent `plan` events show ghost boxes; each `built` resolves its step's
 * title against the refetched workflow and swaps the FIRST unmatched ghost
 * with that title for the real box (duplicate titles match in order).
 */
export interface FixStepInfo {
  stepId: string;
  title: string;
  error: string;
}

/** A waiting approval's output is `{ proposed: { text } }`; anything else yields ''. */
function proposedTextOf(output: unknown): string {
  if (typeof output !== 'object' || output === null) return '';
  const proposed = (output as Record<string, unknown>)['proposed'];
  if (typeof proposed !== 'object' || proposed === null) return '';
  const text = (proposed as Record<string, unknown>)['text'];
  return typeof text === 'string' ? text : '';
}

export default function DesignView({ workflowId, agent, logActivity, onFixStep, runsExtra, onBuilt }: DesignViewProps) {
  // Keeps Start closed if its first send fails (the failed message leaves the transcript).
  const [started, setStarted] = useState(false);
  // Node chat: which step the mini box is open for, plus per-step histories.
  const [chatFor, setChatFor] = useState<string | undefined>(undefined);
  const [chatHistories, setChatHistories] = useState<Record<string, ChatMsg[]>>({});
  const appendChat = useCallback((stepId: string, msg: ChatMsg) => {
    setChatHistories((prev) => ({ ...prev, [stepId]: [...(prev[stepId] ?? []), msg] }));
  }, []);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const detailQuery = useWorkflowDetail(workflowId);
  const detail = detailQuery.data;
  const op = useWorkflowOp(workflowId);
  const { mutateAsync } = op;
  const testRun = useTestRun(workflowId);
  const deleteWorkflow = useDeleteWorkflow();
  // Ambient loops while the design screen is mounted; unmounting (e.g.
  // switching to runtime mode) stops them.
  useSound(true);
  const [ghosts, setGhosts] = useState<GhostStep[]>([]);
  const [ghostEdges, setGhostEdges] = useState<Edge[]>([]);
  const [matchedGhostIds, setMatchedGhostIds] = useState<string[]>([]);
  const [pendingBuilt, setPendingBuilt] = useState<string[]>([]);
  // Built steps whose refetch failed or timed out: surfaced already, but
  // still matchable so a late-arriving step swaps its ghost in.
  const [failedBuilt, setFailedBuilt] = useState<string[]>([]);
  const [builtIds, setBuiltIds] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<TestRunResponse | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // Runs mode shows one run: the one in ?run=, else whatever most needs you.
  const runsMode = isRunsMode(params);
  const rawRunId = params.get('run');
  const runsQuery = useRuns(workflowId);
  const runs = runsQuery.data;
  const overlayRunId = !runsMode
    ? undefined
    : rawRunId !== null && runs?.some((r) => r.id === rawRunId)
      ? rawRunId
      : preferredRun(runs)?.id;
  const overlayQuery = useRun(overlayRunId ?? '', { enabled: overlayRunId !== undefined });
  const overlay = overlayRunId === undefined ? undefined : overlayQuery.data;
  const stepRuns = useMemo(() => {
    const map: Record<string, StepRun> = {};
    for (const s of overlay?.steps ?? []) map[s.stepId] = s;
    return map;
  }, [overlay]);
  // onBuilt must fire exactly once per built step even under effect re-runs.
  const builtFired = useRef<Set<string>>(new Set());
  // One timeout per pending built; an entry's presence means "still
  // awaiting" (deleted on match, on surfacing, or on unmount).
  const pendingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

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

  // A pending built that cannot resolve now (its refetch failed or timed
  // out) leaves pending with a plain-words error — surfacing exactly once
  // per step — but stays matchable for a later refetch. The "work is saved"
  // claim holds: the server emits `built` only after persisting the step.
  const failPendingBuilt = useCallback((stepId: string) => {
    const timer = pendingTimers.current.get(stepId);
    if (timer === undefined) return;
    clearTimeout(timer);
    pendingTimers.current.delete(stepId);
    setPendingBuilt((prev) => prev.filter((id) => id !== stepId));
    setFailedBuilt((prev) => (prev.includes(stepId) ? prev : [...prev, stepId]));
    toast.error("Couldn't load the new step. Check your connection — the agent's work is saved.");
  }, []);

  const handleAgentEvent = useCallback(
    (e: AgentEvent) => {
      if (e.type === 'plan') {
        // A new plan replaces the previous ghosts wholesale.
        setGhosts(e.ghosts);
        setGhostEdges(e.edges);
        setMatchedGhostIds([]);
      } else if (e.type === 'built') {
        setPendingBuilt((prev) => (prev.includes(e.stepId) ? prev : [...prev, e.stepId]));
        if (!pendingTimers.current.has(e.stepId)) {
          pendingTimers.current.set(
            e.stepId,
            setTimeout(() => failPendingBuilt(e.stepId), PENDING_BUILT_TIMEOUT_MS),
          );
        }
        // Agent ops don't push workflow state over SSE, so the fresh step
        // arrives via refetch; resolution happens in the effect below. The
        // invalidate promise settles once the refetch does (it never rejects
        // for query failures), so a still-failing query surfaces here — while
        // the timeout above catches the silently-hung fetch. Either way a
        // pending built resolves or surfaces; it never strands its ghost.
        const surfaceIfFailed = (): void => {
          if (client.getQueryState(['workflow', workflowId])?.status !== 'error') return;
          failPendingBuilt(e.stepId);
        };
        void client
          .invalidateQueries({ queryKey: ['workflow', workflowId] })
          .then(surfaceIfFailed, surfaceIfFailed);
      } else if (e.type === 'test') {
        getRun(e.runId).then(
          (runDetail) => {
            setTestResult({
              run: runDetail.run,
              steps: runDetail.steps,
              usedSample: runDetail.run.usedSample,
              story: runDetail.story,
            });
            sound.chime('done');
          },
          () => toast.error("Couldn't load the test results."),
        );
      }
    },
    [client, failPendingBuilt, workflowId],
  );
  useAgentEvents(workflowId, handleAgentEvent);

  // Pending-built timeouts must not fire (and toast) after leaving the screen.
  useEffect(() => {
    const timers = pendingTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Resolves pending builts once the refetched workflow contains their steps.
  // Previously-surfaced ids stay matchable so a late step still lands.
  useEffect(() => {
    const awaiting = [...pendingBuilt, ...failedBuilt];
    if (!detail || awaiting.length === 0) return;
    const stepsById = new Map<string, StepInstance>([[detail.trigger.id, detail.trigger]]);
    for (const s of detail.steps) stepsById.set(s.id, s);
    const resolved = awaiting.filter((id) => stepsById.has(id) && !builtIds.includes(id));
    if (resolved.length === 0) return;
    for (const id of resolved) {
      const timer = pendingTimers.current.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        pendingTimers.current.delete(id);
      }
    }
    setPendingBuilt((prev) => prev.filter((id) => !resolved.includes(id)));
    setFailedBuilt((prev) => prev.filter((id) => !resolved.includes(id)));
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
        sound.chime('step');
        onBuilt?.({ stepId: id, title: stepsById.get(id)!.title });
        logActivity(`Built "${stepsById.get(id)!.title}".`);
      }
    }
  }, [detail, pendingBuilt, failedBuilt, builtIds, ghosts, onBuilt, logActivity]);

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

  const setOverlayRun = useCallback(
    (runId: string | undefined) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (runId === undefined) next.delete('run');
        else next.set('run', runId);
        next.delete('step');
        return next;
      });
    },
    [setParams],
  );

  const setRunsMode = useCallback(
    (on: boolean) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('mode', on ? 'runs' : 'design');
        next.delete('run');
        next.delete('step');
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

  const clearSelectedStep = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('step');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const copyNameAndId = useCallback(async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(`${detail.name} (${workflowId})`);
      toast.success('Copied name and id.');
    } catch {
      toast.error('Could not copy. Select the title instead.');
    }
  }, [detail, workflowId]);

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
      // Every wire is attempted even when one refuses: an early return here
      // would leave a half-restored step while the toast implied a full undo.
      let skipped = 0;
      for (const e of [...incoming, ...outgoing]) {
        const from = map(e.from);
        const to = map(e.to);
        if (!ids.has(from) || !ids.has(to)) continue;
        if (have.has(`${from}->${to}`)) continue;
        const res = await send({
          op: 'connect',
          args: [{ from, to, ...(e.when ? { when: e.when } : {}) }],
        });
        if (!res?.ok) {
          skipped += 1;
          continue;
        }
        have.add(`${from}->${to}`);
      }
      await send({ op: 'move', args: [restored.id, snapshot.position] });
      if (skipped > 0) {
        toast.error(
          skipped === 1
            ? "Step restored, but 1 wire couldn't be put back."
            : `Step restored, but ${skipped} wires couldn't be put back.`,
        );
      }
      setSelectedStep(restored.id);
    },
    [client, workflowId, send, setSelectedStep],
  );

  const handleRemove = useCallback(
    async (stepId: string) => {
      const wf = client.getQueryData<WorkflowDetail>(['workflow', workflowId]) ?? detail;
      if (!wf) return;
      if (stepId === wf.trigger.id) {
        toast.error("The start of the automation can't be deleted.");
        return;
      }
      const snapshot = wf.steps.find((s) => s.id === stepId);
      if (!snapshot) return;
      const incoming = wf.edges.filter((e) => e.to === stepId);
      const outgoing = wf.edges.filter((e) => e.from === stepId);
      const res = await send({ op: 'removeStep', args: [stepId] });
      if (!res?.ok) return;
      logActivity(`Deleted "${snapshot.title}".`);
      toast.success(`Deleted "${snapshot.title}".`, {
        duration: 5000,
        action: { label: 'Undo', onClick: () => void handleUndo(snapshot, incoming, outgoing) },
      });
    },
    [client, workflowId, detail, send, handleUndo, logActivity],
  );

  const handleCanvasOp = useCallback(
    (canvasOp: CanvasOp) => {
      if (canvasOp.op === 'remove') {
        void handleRemove(canvasOp.stepId);
      } else if (canvasOp.op === 'move') {
        void send({ op: 'move', args: [canvasOp.stepId, canvasOp.position] });
      } else if (canvasOp.op === 'connect') {
        void send({
          op: 'connect',
          args: [
            {
              from: canvasOp.from,
              to: canvasOp.to,
              ...(canvasOp.when ? { when: canvasOp.when } : {}),
            },
          ],
        });
      } else if (canvasOp.op === 'disconnect') {
        void send({ op: 'disconnect', args: [{ from: canvasOp.from, to: canvasOp.to }] });
      }
    },
    [send, handleRemove],
  );

  const handleAddStep = useCallback(
    async (spec: {
      type: string;
      title?: string;
      summary?: string;
      config?: Record<string, unknown>;
      inputs?: Record<string, unknown>;
      after?: string;
    }): Promise<string | undefined> => {
      const wf = detail;
      if (!wf) return undefined;
      const def = catalog[spec.type];
      if (!def) return undefined;
      if (def.kind === 'trigger') {
        // There is only ever one start box: a "When" pick swaps it, then its
        // settings open so the owner can set it up (empty config flags a problem).
        const res = await send({ op: 'setTrigger', args: [{ type: spec.type, config: {} }] });
        if (res?.ok) setSelectedStep(wf.trigger.id);
        return res?.ok ? def.title : undefined;
      }
      const after = spec.after ?? selectedStepId ?? wf.steps[wf.steps.length - 1]?.id ?? wf.trigger.id;
      const beforeIds = new Set([wf.trigger.id, ...wf.steps.map((s) => s.id)]);
      const res = await send({
        op: 'addStep',
        args: [
          {
            type: spec.type,
            title: spec.title ?? def.title,
            summary: spec.summary ?? def.description,
            config: spec.config ?? {},
            inputs: spec.inputs ?? {},
            after,
          },
        ],
      });
      if (!res?.ok) return undefined;
      const addedStep = res.workflow.steps.find((s) => !beforeIds.has(s.id));
      if (addedStep) setSelectedStep(addedStep.id);
      return addedStep?.title ?? def.title;
    },
    [detail, selectedStepId, send, setSelectedStep],
  );

  const handleChatSubmit = useCallback(
    async (anchorId: string, text: string, pick: ChatPick | undefined) => {
      const wf = detail;
      if (!wf) return;
      const anchor =
        wf.trigger.id === anchorId ? wf.trigger : wf.steps.find((s) => s.id === anchorId);
      if (!anchor) return;
      appendChat(anchorId, { from: 'owner', text });
      if (!pick) {
        // Free text goes to the workflow conversation with node context; the
        // outcome lands on the canvas and in the RHS chat via the existing
        // agent machinery, and the RHS log records that this node was touched.
        void agent.send(`About the "${anchor.title}" step: ${text}`);
        appendChat(anchorId, { from: 'agent', text: 'Sent — follow along in the chat.' });
        logActivity(`Asked about "${anchor.title}".`);
        return;
      }
      if (pick.kind === 'step') {
        const source = wf.steps.find((s) => s.id === pick.stepId);
        if (!source) return;
        const title = await handleAddStep({
          type: source.type,
          title: source.title,
          summary: source.summary,
          config: source.config,
          inputs: source.inputs,
          after: anchorId,
        });
        if (title === undefined) return;
        appendChat(anchorId, { from: 'agent', text: `Added a copy of "${source.title}".` });
        logActivity(`Added a copy of "${source.title}".`);
        return;
      }
      const title = await handleAddStep({ type: pick.type, after: anchorId });
      if (title === undefined) return;
      appendChat(anchorId, { from: 'agent', text: `Added "${title}".` });
      logActivity(`Added "${title}".`);
    },
    [detail, agent, appendChat, handleAddStep, logActivity],
  );

  const renderNodeDesign = useCallback(
    (s: StepInstance): StepNodeData['design'] => ({
      onAdd: () => setChatFor(s.id),
      onSelect: () => handleSelectStep(s.id),
      onDelete: () => void handleRemove(s.id),
      showDelete: detail !== undefined && s.id !== detail.trigger.id,
      nodeChat:
        chatFor === s.id && detail ? (
          <NodeChat
            anchorTitle={s.title}
            history={chatHistories[s.id] ?? []}
            busy={op.isPending || agent.busy}
            siblings={detail.steps
              .filter((o) => o.id !== s.id)
              .map((o) => ({ id: o.id, title: o.title }))}
            onSubmit={(text, pick) => void handleChatSubmit(s.id, text, pick)}
            onClose={() => setChatFor(undefined)}
          />
        ) : undefined,
      settings:
        selectedStepId === s.id && detail ? (
          <div data-testid="design-inspector" className="flex flex-col gap-3">
            <AppButton
              variant="ghost"
              size="icon-sm"
              className="absolute top-2.5 right-2.5"
              onClick={clearSelectedStep}
              aria-label="Close"
            >
              <XIcon aria-hidden />
            </AppButton>
            <ConfigForm
              key={s.id}
              step={s}
              workflow={detail}
              formId={`step-settings-${s.id}`}
              onSave={(patch) => {
                void send({ op: 'updateStep', args: [s.id, patch] satisfies [string, ConfigSave] });
                clearSelectedStep();
              }}
              saving={op.isPending}
            />
            <div className="flex gap-2 border-t border-border pt-3">
              {/* Done saves, so an edit can't be lost by closing the settings. */}
              <AppButton type="submit" form={`step-settings-${s.id}`} size="sm" className="flex-1" disabled={op.isPending}>
                Done
              </AppButton>
              {s.id !== detail.trigger.id && (
                <AppButton variant="outline" size="sm" onClick={() => void handleRemove(s.id)}>
                  Remove
                </AppButton>
              )}
            </div>
          </div>
        ) : undefined,
    }),
    [detail, chatFor, chatHistories, op.isPending, agent.busy, selectedStepId, send, clearSelectedStep, handleSelectStep, handleRemove, handleChatSubmit],
  );

  const handlePublish = useCallback(
    async (on: boolean) => {
      const res = await send({ op: 'setStatus', args: [on ? 'on' : 'off'] });
      if (res?.ok) toast.success(on ? 'Published. It now runs on its own.' : 'Unpublished. It will not run.');
    },
    [send],
  );

  const handleRename = useCallback(
    async (name: string) => {
      setRenaming(null);
      const trimmed = name.trim();
      if (trimmed === '' || trimmed === detail?.name) return;
      await send({ op: 'rename', args: [{ name: trimmed }] });
    },
    [send, detail?.name],
  );

  const handleTryIt = useCallback(() => {
    testRun.mutate(undefined, {
      onSuccess: (res) => {
        setTestResult(res);
        sound.chime('done');
      },
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
          {verdict !== undefined && <p className="text-[0.824rem] text-muted-foreground">{verdict}</p>}
        </div>
      );
    },
    [problemsByStep, testByStep],
  );

  const renderNodeOutcome = useCallback(
    (stepId: string): string | undefined => outcomeOf(stepRuns[stepId]),
    [stepRuns],
  );

  // A waiting or failed step grows in place to hold what you need to act on.
  // Question and title come from the version the run actually used.
  const renderNodeExpanded = useCallback(
    (stepId: string): ReactNode => {
      const sr = stepRuns[stepId];
      if (!overlay || overlayRunId === undefined || !sr) return undefined;
      const pinned =
        stepId === overlay.workflow.trigger.id
          ? overlay.workflow.trigger
          : overlay.workflow.steps.find((st) => st.id === stepId);
      if (sr.status === 'waiting') {
        const rawQuestion = pinned?.config['question'];
        const who = runDisplayName(overlay.run.triggerPayload);
        return (
          <ApprovalCard
            key={`${overlayRunId}-${stepId}`}
            runId={overlayRunId}
            stepId={stepId}
            question={typeof rawQuestion === 'string' ? rawQuestion : 'Is this OK to use?'}
            proposedText={proposedTextOf(sr.output)}
            recipient={who === 'Manual run' ? undefined : who}
          />
        );
      }
      if (sr.status === 'failed') {
        const error = sr.error ?? 'Something went wrong.';
        // Only say nothing went out when that's true of this run.
        const acted = overlay.steps.some((other) => {
          const step = overlay.workflow.steps.find((st) => st.id === other.stepId);
          return (
            other.status === 'done' &&
            step !== undefined &&
            step.type !== 'approval.ask' &&
            catalog[step.type]?.kind === 'act'
          );
        });
        return (
          <FailureCard
            key={`${overlayRunId}-${stepId}`}
            runId={overlayRunId}
            stepId={stepId}
            error={error}
            context={
              acted
                ? "I stopped here, so the steps after this one didn't run."
                : "I stopped here, so nothing has been booked or sent."
            }
            onFixStep={
              onFixStep ? () => onFixStep({ stepId, title: pinned?.title ?? stepId, error }) : undefined
            }
          />
        );
      }
      return undefined;
    },
    [overlay, overlayRunId, stepRuns, onFixStep],
  );

  const handleStartSubmit = useCallback(
    (text: string) => {
      setStarted(true);
      void agent.send(text);
    },
    [agent],
  );

  // Wait for the chat history too, so a conversation in progress never flashes Start.
  if (detailQuery.isPending || (agent.historyPending && detail?.steps.length === 0)) {
    return <p className="text-base">Loading automation…</p>;
  }
  if (detailQuery.isError || !detail) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Couldn't load this automation"
        hint="Check the server is running and try again."
      />
    );
  }

  const selected = selectedStepId === undefined ? undefined : findStep(detail, selectedStepId);
  const problemCount = detail.problems.length;
  // Any conversation hides Start, wherever it began (Home's box, the chat): the
  // plan's ghost boxes only draw on the canvas.
  const showStart = detail.steps.length === 0 && !started && agent.transcript.length === 0;

  const published = detail.status === 'on';
  // Everything else about an automation lives in the bar's ⋯ menu.
  const titleBar = (
    <BarActions>
      <div data-testid="design-titlebar" className="flex flex-wrap items-center gap-2">
        {renaming !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRename(renaming);
            }}
          >
            <input
              autoFocus
              aria-label="Automation name"
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={() => void handleRename(renaming)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="w-56 rounded-[var(--radius-s)] border border-input bg-background px-2 py-1 text-sm"
            />
          </form>
        )}
        {!showStart && (
          <>
            <ModeSwitch runsMode={runsMode} runs={runs} onChange={setRunsMode} />
            <AppButton
              variant="outline"
              size="sm"
              className="min-h-0"
              onClick={handleTryIt}
              disabled={testRun.isPending}
            >
              <Play aria-hidden fill="currentColor" className="size-3!" />
              {testRun.isPending ? 'Trying…' : 'Try it'}
            </AppButton>
            {!runsMode &&
              (published || problemCount === 0 ? (
                <label
                  data-explain={dataExplainValue({ kind: 'ui', id: 'turn-on' }, 'Publish')}
                  className={`inline-flex items-center gap-2 px-1 text-[0.765rem] font-semibold ${published ? 'text-success' : 'text-muted-foreground'}`}
                >
                  <Switch
                    checked={published}
                    disabled={op.isPending}
                    aria-label="Published"
                    onCheckedChange={(on) => void handlePublish(on)}
                  />
                  {published ? 'Published' : 'Not published'}
                </label>
              ) : (
                <span className="px-1 text-[0.765rem] font-semibold text-warning">
                  {problemCount} thing{problemCount === 1 ? '' : 's'} to fix before publishing
                </span>
              ))}
          </>
        )}
        <MoreMenu
          onRename={() => setRenaming(detail.name)}
          onCopy={() => void copyNameAndId()}
          onUnpublish={published ? () => void handlePublish(false) : undefined}
          deleting={deleteWorkflow.isPending}
          onDelete={() => {
            deleteWorkflow.mutate(workflowId, {
              onSuccess: () => navigate('/automate'),
              onError: () => toast.error("Couldn't delete this automation."),
            });
          }}
        />
      </div>
    </BarActions>
  );

  const runStatuses = overlay
    ? [overlay.workflow.trigger, ...overlay.workflow.steps].map((st) => stepRuns[st.id]?.status ?? 'pending')
    : [];

  const selectedRunStep =
    !overlay || selectedStepId === undefined
      ? undefined
      : selectedStepId === overlay.workflow.trigger.id
        ? overlay.workflow.trigger
        : overlay.workflow.steps.find((s) => s.id === selectedStepId);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        {showStart ? (
          <motion.div
            key="start"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="relative h-full w-full"
          >
            {titleBar}
            <div className="flex h-full overflow-y-auto p-8 pt-20">
              <DesignStart send={handleStartSubmit} busy={agent.busy} />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="work"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="relative h-full w-full"
          >
            {titleBar}
            <div className="relative isolate h-full w-full overflow-hidden">
              {runsMode && <div data-testid="board-runs" className="board-runs" />}
              <WorkflowCanvas
                workflow={detail}
                mode={runsMode ? 'runtime' : 'design'}
                stepRuns={runsMode ? stepRuns : undefined}
                ghosts={runsMode ? undefined : visibleGhosts}
                ghostEdges={runsMode ? undefined : visibleGhostEdges}
                builtIds={builtIds}
                selectedStepId={runsMode ? undefined : selectedStepId}
                onSelectStep={handleSelectStep}
                onChange={handleCanvasOp}
                renderNodeExtra={runsMode ? undefined : renderNodeExtra}
                renderNodeExpanded={runsMode ? renderNodeExpanded : undefined}
                renderNodeOutcome={runsMode ? renderNodeOutcome : undefined}
                renderNodeDesign={renderNodeDesign}
              />
            </div>
            {!runsMode && <ToolRail onPick={(type) => void handleAddStep({ type })} />}
            {runsMode && (
              <aside
                aria-label="Runs"
                data-testid="runs-panel"
                className="absolute top-20 left-3.5 z-20 flex max-h-[calc(100%-6rem)] w-[220px] flex-col gap-1 overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-3 shadow-sm"
              >
                <span className="section-label px-1.5 pt-1 pb-1.5">Real runs</span>
                {(runs?.length ?? 0) === 0 ? (
                  <p className="m-0 px-1.5 pb-1 text-[0.824rem] text-muted-foreground">
                    No real runs yet. Publish this automation and they&apos;ll show up here.
                  </p>
                ) : (
                  <RunsList runs={runs ?? []} selectedRunId={overlayRunId} onSelect={setOverlayRun} />
                )}
              </aside>
            )}
            {runsMode &&
              (overlay ? (
                <ThisRunPanel
                  name={runDisplayName(overlay.run.triggerPayload)}
                  started={formatRunStart(overlay.run.startedAt, overlay.workflow.trigger.type)}
                  statuses={runStatuses}
                  story={overlay.story}
                  note={
                    overlay.run.workflowVersion !== detail.version
                      ? 'This run used an earlier version, so some steps may have changed since.'
                      : undefined
                  }
                  onChangeDesign={() => setRunsMode(false)}
                >
                  {runsExtra}
                </ThisRunPanel>
              ) : (
                runsExtra && (
                  <div className="absolute top-20 right-3.5 z-20 w-[360px] rounded-[var(--radius)] border border-border bg-card p-5 shadow-md">
                    {runsExtra}
                  </div>
                )
              ))}
            {testResult && (
              <div className="absolute bottom-4 left-1/2 z-20 max-h-[40%] w-[32rem] max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-4 shadow-md">
                <AppButton
                  variant="ghost"
                  size="icon-sm"
                  className="float-right"
                  aria-label="Close test results"
                  onClick={() => setTestResult(null)}
                >
                  <XIcon aria-hidden />
                </AppButton>
                <TestResults story={testResult.story} />
              </div>
            )}
            {runsMode && overlay && selected && (
              <Inspector
                key={selectedStepId ?? 'none'}
                stepRun={selectedStepId === undefined ? undefined : stepRuns[selectedStepId]}
                title={selectedRunStep?.title ?? selected.title}
                open
                onClose={clearSelectedStep}
                explainTarget={{ kind: 'step', id: selected.id, context: workflowId }}
                explainLabel={selected.title}
                code={
                  selectedRunStep?.type === 'code.transform' &&
                  typeof selectedRunStep.config['code'] === 'string'
                    ? (selectedRunStep.config['code'] as string)
                    : undefined
                }
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

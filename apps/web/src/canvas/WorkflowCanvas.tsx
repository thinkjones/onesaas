import '@xyflow/react/dist/style.css';
import {
  catalog,
  type Edge as WorkflowEdge,
  type StepInstance,
  type StepKind,
  type StepRun,
  type Workflow,
} from '@onesaas/shared';
import {
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import { MotionConfig } from 'motion/react';
import Hand from 'lucide-react/icons/hand';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import GhostNode, { GhostEdge, type GhostNodeData } from '../design/GhostNode.tsx';
import FlowEdge, { type FlowEdgeData } from './FlowEdge.tsx';
import { layoutWorkflow, stepNumbers } from './layout.ts';
import StepNode, { type StepNodeData } from './StepNode.tsx';

export type CanvasMode = 'design' | 'runtime';

export type CanvasOp =
  | { op: 'move'; stepId: string; position: { x: number; y: number } }
  | { op: 'connect'; from: string; to: string; when?: string }
  | { op: 'remove'; stepId: string }
  | { op: 'disconnect'; from: string; to: string };

export interface GhostStep {
  id: string;
  type: string;
  title: string;
  summary: string;
}

export interface WorkflowCanvasProps {
  workflow: Workflow;
  mode: CanvasMode;
  /** Runtime overlay keyed by stepId. */
  stepRuns?: Record<string, StepRun>;
  /** Design-mode plan preview: dashed ghost boxes from the agent's `plan` event. */
  ghosts?: GhostStep[];
  /** Planned wires between ghost boxes (from the same `plan` event). */
  ghostEdges?: WorkflowEdge[];
  /** Real step ids that just finished building: they animate in (scale 0.9→1, 300ms). */
  builtIds?: readonly string[];
  selectedStepId?: string;
  onSelectStep(stepId: string): void;
  /** Design mode only (M3 consumes; no-op-safe). */
  onChange?(op: CanvasOp): void;
  /** Problems and Try it verdicts under a design card. */
  renderNodeExtra?(stepId: string): ReactNode;
  /** Runs mode: the approval or failure body a step expands to hold. */
  renderNodeExpanded?(stepId: string, number: number): ReactNode;
  /** Per-node outcome caption (Watch-it-Run; mirrors renderNodeExtra). */
  renderNodeOutcome?(stepId: string): string | undefined;
  /** Where to see what a step saved in this run. */
  savedPathOf?(stepId: string): string | undefined;
  /**
   * Design-mode hover actions + node chat (Bug #4). Applied only in design
   * mode; runtime passes nothing and nodes stay clean.
   */
  renderNodeDesign?(step: StepInstance): StepNodeData['design'];
}

type CanvasNode = Node<StepNodeData, 'step'>;
type CanvasGhostNode = Node<GhostNodeData, 'ghost'>;
type CanvasLineNode = Node<{ height: number }, 'line'>;
type CanvasEdge = Edge<FlowEdgeData, 'flow'>;
type CanvasGhostEdge = Edge<{ when?: string }, 'ghost'>;
type CanvasAnyNode = CanvasNode | CanvasGhostNode | CanvasLineNode;
type CanvasAnyEdge = CanvasEdge | CanvasGhostEdge;

/** Runs mode: the coral line beside the flow, down to the current step. */
function RunLineNode({ data }: NodeProps<CanvasLineNode>) {
  return <div className="run-line" style={{ height: data.height }} />;
}

const nodeTypes = { step: StepNode, ghost: GhostNode, line: RunLineNode };
const edgeTypes = { flow: FlowEdge, ghost: GhostEdge };

// Where the flow column sits: clear of the rail or Runs list, and on narrower
// windows clear of the chat too, leaving room for the settings popover.
const WIDE_WINDOW = 1400;
const flowLeft = (runs: boolean): number =>
  runs || (typeof window !== 'undefined' && window.innerWidth >= WIDE_WINDOW) ? 250 : 90;
const FLOW_TOP = 92;
const FOCUS_MARGIN = 14;
// The dagre margin the first card sits at.
const leftEdgeOf = (steps: StepInstance[]): number => Math.min(...steps.map((s) => s.position.x));
const topEdgeOf = (steps: StepInstance[]): number => Math.min(...steps.map((s) => s.position.y));

function kindOf(type: string): StepKind {
  return catalog[type]?.kind ?? 'enrich';
}

/**
 * A sort step's options for the edge condition picker. Mirrors the server's
 * classify default (apps/server/src/steps/classify.ts): the catalog options
 * default never applies at runtime, so a missing/empty options falls back to
 * yes/no. The web cannot import server code, so the literal is restated.
 */
function classifyOptions(config: Record<string, unknown>): string[] {
  const raw = config['options'];
  if (Array.isArray(raw)) {
    const options = raw.filter((o): o is string => typeof o === 'string' && o.length > 0);
    if (options.length > 0) return options;
  }
  return ['yes', 'no'];
}

/**
 * The one canvas behind Design and Runs. Nodes flow top-down, auto-laid-out
 * and never draggable. Cards are measured, and the layout re-runs with the real
 * sizes, so wrapped text and expanded steps push the flow down rather than
 * overlap. Runs nodes aren't connectable or selectable; clicks still report
 * through onSelectStep so the inspector can open.
 *
 * Design mode additionally renders the agent's planned ghosts (dashed, inert,
 * laid out together with the real graph) and deletes selected boxes on
 * Backspace (reported as `remove` ops; ghosts are unselectable so they can
 * never be deleted).
 */
const MOVE_HINT_KEY = 'onesaas.boardMoved';

function moveHintSeen(): boolean {
  try {
    return localStorage.getItem(MOVE_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberMoveHintSeen(): void {
  try {
    localStorage.setItem(MOVE_HINT_KEY, '1');
  } catch {
    // Private windows can refuse storage; the hint just comes back next time.
  }
}

export default function WorkflowCanvas({
  workflow,
  mode,
  stepRuns,
  ghosts,
  ghostEdges,
  builtIds,
  selectedStepId,
  onSelectStep,
  onChange,
  renderNodeExtra,
  renderNodeExpanded,
  renderNodeOutcome,
  savedPathOf,
  renderNodeDesign,
}: WorkflowCanvasProps) {
  // Once you've moved the board you know how; it doesn't need saying again.
  const [showMoveHint, setShowMoveHint] = useState(() => !moveHintSeen());
  const dismissMoveHint = useCallback(() => {
    setShowMoveHint(false);
    rememberMoveHintSeen();
  }, []);
  const runs = mode === 'runtime';
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasAnyNode, CanvasAnyEdge> | null>(null);
  const layout = useMemo(() => ({ sizes, gap: runs ? 10 : 44 }), [sizes, runs]);
  // Ghosts join the layout as unpositioned steps, so dagre places them
  // relative to the real graph (which keeps its positions) instead of in a
  // disconnected pile. layoutWorkflow passes edges through untouched.
  const laid = useMemo(() => {
    if (!ghosts || ghosts.length === 0) return layoutWorkflow(workflow, layout);
    // A plan's first steps hang off the end of the flow; unlinked, dagre would
    // set them beside the trigger instead of below it.
    const planTargets = new Set((ghostEdges ?? []).map((e) => e.to));
    const flowEnd = workflow.steps.at(-1)?.id ?? workflow.trigger.id;
    const planEntryEdges: WorkflowEdge[] = ghosts
      .filter((g) => !planTargets.has(g.id))
      .map((g) => ({ from: flowEnd, to: g.id }));
    const ghostSteps: StepInstance[] = ghosts.map((g) => ({
      ...g,
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    }));
    return layoutWorkflow(
      {
        ...workflow,
        steps: [...workflow.steps, ...ghostSteps],
        edges: [...workflow.edges, ...(ghostEdges ?? []), ...planEntryEdges],
      },
      layout,
    );
  }, [workflow, ghosts, ghostEdges, layout]);

  const initialNodes: CanvasAnyNode[] = useMemo(() => {
    const placed = new Map(
      [laid.trigger, ...laid.steps].map((s) => [s.id, s] as const),
    );
    const designMode = mode === 'design';
    const numbers = stepNumbers({
      ...workflow,
      trigger: placed.get(workflow.trigger.id) ?? workflow.trigger,
      steps: workflow.steps.map((s) => placed.get(s.id) ?? s),
    });
    const nodes: CanvasAnyNode[] = [workflow.trigger, ...workflow.steps].map(
      (s): CanvasNode => ({
        id: s.id,
        type: 'step',
        position: placed.get(s.id)?.position ?? s.position,
        data: {
          step: placed.get(s.id) ?? s,
          kind: kindOf(s.type),
          status: stepRuns?.[s.id]?.status,
          number: numbers[s.id],
          runs,
          extra: renderNodeExtra?.(s.id),
          expanded: runs ? renderNodeExpanded?.(s.id, numbers[s.id] ?? 0) : undefined,
          outcome: renderNodeOutcome?.(s.id),
          savedPath: savedPathOf?.(s.id),
          fresh: builtIds?.includes(s.id) ?? false,
          workflowId: workflow.id,
          design: designMode ? renderNodeDesign?.(s) : undefined,
        },
        selected: s.id === selectedStepId,
      }),
    );
    for (const g of ghosts ?? []) {
      nodes.push({
        id: g.id,
        type: 'ghost',
        position: placed.get(g.id)?.position ?? { x: 0, y: 0 },
        data: { title: g.title, summary: g.summary, kind: kindOf(g.type) },
        selectable: false,
        draggable: false,
        connectable: false,
      });
    }
    // How far the run has got: the lowest step it has reached.
    if (runs && stepRuns) {
      const real = [workflow.trigger, ...workflow.steps].map((s) => placed.get(s.id) ?? s);
      const reached = real
        .filter((s) => (stepRuns[s.id]?.status ?? 'pending') !== 'pending')
        .sort((a, b) => b.position.y - a.position.y)[0];
      if (reached) {
        const top = topEdgeOf(real);
        nodes.push({
          id: 'run-line',
          type: 'line',
          position: { x: leftEdgeOf(real) - 12, y: top + 20 },
          data: { height: Math.max(reached.position.y - top, 0) + 13 },
          selectable: false,
          draggable: false,
          connectable: false,
        });
      }
    }
    return nodes;
  }, [laid, workflow, mode, runs, stepRuns, ghosts, builtIds, selectedStepId, renderNodeExtra, renderNodeExpanded, renderNodeOutcome, savedPathOf, renderNodeDesign]);

  const initialEdges: CanvasAnyEdge[] = useMemo(() => {
    const ghostIds = new Set((ghosts ?? []).map((g) => g.id));
    const byId = new Map([workflow.trigger, ...workflow.steps].map((s) => [s.id, s]));
    const editable = mode === 'design' && onChange !== undefined;
    return laid.edges.map((e) => {
      if (ghostIds.has(e.from) || ghostIds.has(e.to)) {
        return {
          id: `${e.from}->${e.to}`,
          source: e.from,
          target: e.to,
          type: 'ghost',
          data: { when: e.when },
          selectable: false,
        };
      }
      // Wires out of a sort step carry the condition picker in design mode;
      // picking an option re-connects the wire with that condition.
      const source = byId.get(e.from);
      const condition =
        editable && source?.type === 'ai.classify'
          ? {
              stepId: source.id,
              options: classifyOptions(source.config),
              onConnect: (when: string): void => {
                onChange?.({ op: 'connect', from: e.from, to: e.to, when });
              },
            }
          : undefined;
      return {
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        type: 'flow',
        animated: stepRuns?.[e.to]?.status === 'running',
        data: {
          // Conditions are always written as words; Runs keeps the line quiet.
          ...(runs
            ? {}
            : { when: e.when, label: source?.type === 'approval.ask' ? 'if you say it looks good' : 'then' }),
          reached: runs && (stepRuns?.[e.to]?.status ?? 'pending') !== 'pending',
          ...(condition ? { condition } : {}),
        },
      };
    });
  }, [laid, runs, stepRuns, ghosts, workflow, mode, onChange]);

  const [nodes, setNodes, onNodesChangeInner] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeInner] = useEdgesState(initialEdges);
  useEffect(() => {
    // Keep each card's measurement: without it React Flow hides and re-measures.
    setNodes((current) => {
      const measured = new Map(current.map((n) => [n.id, n.measured]));
      return initialNodes.map((n) => ({ ...n, measured: measured.get(n.id) }));
    });
  }, [initialNodes, setNodes]);
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const design = mode === 'design';

  // Line the flow up with its column. Only on open and on switching mode, so
  // a later re-layout never undoes the owner's panning.
  const realSteps = useMemo(() => {
    const real = new Set([workflow.trigger.id, ...workflow.steps.map((s) => s.id)]);
    return [laid.trigger, ...laid.steps].filter((s) => real.has(s.id));
  }, [laid, workflow]);
  const viewportFor = useCallback(
    (steps: StepInstance[]) => ({
      x: flowLeft(runs) - leftEdgeOf(steps),
      y: FLOW_TOP - topEdgeOf(steps),
      zoom: 1,
    }),
    [runs],
  );
  const [initialViewport] = useState(() => viewportFor(realSteps));
  const stepsRef = useRef(realSteps);
  useEffect(() => {
    stepsRef.current = realSteps;
  }, [realSteps]);
  useEffect(() => {
    void flow?.setViewport(viewportFor(stepsRef.current));
  }, [flow, viewportFor, workflow.id]);

  // What needs the owner must be on screen: a waiting or failed step, or the
  // step whose settings are open. Moves only as far as it takes, and only when
  // that step or its place changes, so it never fights the owner's panning.
  const focusStep = runs
    ? realSteps.find((s) => ['waiting', 'failed'].includes(stepRuns?.[s.id]?.status ?? ''))
    : realSteps.find((s) => s.id === selectedStepId);
  const focusId = focusStep?.id;
  const focusY = focusStep?.position.y;
  const focusHeight = focusId === undefined ? undefined : sizes[focusId]?.height;
  useEffect(() => {
    if (!flow || focusY === undefined) return;
    const view = flow.getViewport();
    const top = focusY * view.zoom + view.y;
    const bottom = top + (focusHeight ?? 84) * view.zoom;
    const overBottom = bottom - (window.innerHeight - FOCUS_MARGIN);
    const shift = top < FLOW_TOP ? FLOW_TOP - top : overBottom > 0 ? -Math.min(overBottom, top - FLOW_TOP) : 0;
    if (shift !== 0) void flow.setViewport({ ...view, y: view.y + shift });
  }, [flow, focusId, focusY, focusHeight]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasAnyNode>[]) => {
      onNodesChangeInner(changes);
      const measured = changes.flatMap((c) =>
        c.type === 'dimensions' && c.dimensions && c.id !== 'run-line' ? [{ id: c.id, ...c.dimensions }] : [],
      );
      if (measured.length > 0) {
        setSizes((prev) => {
          const changed = measured.filter(
            (m) => prev[m.id]?.width !== m.width || prev[m.id]?.height !== m.height,
          );
          if (changed.length === 0) return prev;
          const next = { ...prev };
          for (const m of changed) next[m.id] = { width: m.width, height: m.height };
          return next;
        });
      }
      if (!design || !onChange) return;
      for (const c of changes) {
        // @xyflow/react emits a `position` change per drag frame with
        // `dragging: true`, then one final change with `dragging: false`
        // on drop (updateNodePositions in @xyflow/react 12). Only the drop
        // is an op, so M3 sees one move per drag instead of ~per-frame ops.
        if (c.type === 'position' && c.position && !c.dragging) {
          onChange({ op: 'move', stepId: c.id, position: c.position });
        } else if (c.type === 'remove') {
          onChange({ op: 'remove', stepId: c.id });
        }
      }
    },
    [design, onChange, onNodesChangeInner],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasAnyEdge>[]) => {
      onEdgesChangeInner(changes);
      if (!design || !onChange) return;
      for (const c of changes) {
        if (c.type === 'remove') {
          const edge = edges.find((e) => e.id === c.id);
          if (edge) onChange({ op: 'disconnect', from: edge.source, to: edge.target });
        }
      }
    },
    [design, onChange, onEdgesChangeInner, edges],
  );

  return (
    <MotionConfig reducedMotion="user">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={(conn) => {
          if (design && onChange && conn.source && conn.target) {
            onChange({ op: 'connect', from: conn.source, to: conn.target });
          }
        }}
        onInit={setFlow}
        onNodeClick={(_, node) => {
          if (node.type === 'step') onSelectStep(node.id);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={design}
        elementsSelectable={design}
        deleteKeyCode={design ? 'Backspace' : null}
        defaultViewport={initialViewport}
        minZoom={0.5}
        maxZoom={1.25}
        // Cards stay full size and readable; a long flow scrolls.
        panOnScroll
        zoomOnScroll={false}
        onMoveStart={(event) => {
          // Only a person moving it: fitting the flow in view fires this too.
          if (event !== null && showMoveHint) dismissMoveHint();
        }}
      >
        {showMoveHint && (
          <Panel position="bottom-center">
            <span className="board-hint" data-testid="board-hint">
              <Hand aria-hidden />
              Drag the board to move around. Scrolling works too.
            </span>
          </Panel>
        )}
      </ReactFlow>
    </MotionConfig>
  );
}

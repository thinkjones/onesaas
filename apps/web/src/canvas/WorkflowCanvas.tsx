import '@xyflow/react/dist/style.css';
import {
  catalog,
  type Edge as WorkflowEdge,
  type StepInstance,
  type StepKind,
  type StepRun,
  type Workflow,
} from '@dad/shared';
import {
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { MotionConfig } from 'motion/react';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import GhostNode, { GhostEdge, type GhostNodeData } from '../design/GhostNode.tsx';
import FlowEdge from './FlowEdge.tsx';
import { layoutWorkflow } from './layout.ts';
import StepNode, { type StepNodeData } from './StepNode.tsx';

export type CanvasMode = 'design' | 'runtime';

export type CanvasOp =
  | { op: 'move'; stepId: string; position: { x: number; y: number } }
  | { op: 'connect'; from: string; to: string }
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
  /** Approval / failure cards slot. */
  renderNodeExtra?(stepId: string): ReactNode;
}

type CanvasNode = Node<StepNodeData, 'step'>;
type CanvasGhostNode = Node<GhostNodeData, 'ghost'>;
type CanvasEdge = Edge<{ when?: string }, 'flow'>;
type CanvasGhostEdge = Edge<{ when?: string }, 'ghost'>;

const nodeTypes = { step: StepNode, ghost: GhostNode };
const edgeTypes = { flow: FlowEdge, ghost: GhostEdge };

function kindOf(type: string): StepKind {
  return catalog[type]?.kind ?? 'enrich';
}

/**
 * The workflow canvas shared by design and runtime modes. Runtime nodes are
 * not draggable/connectable and elements are not selectable; clicks still
 * report through onSelectStep so Task 5 can open the inspector.
 *
 * Design mode additionally renders the agent's planned ghosts (dashed, inert,
 * laid out together with the real graph) and deletes selected boxes on
 * Backspace (reported as `remove` ops; ghosts are unselectable so they can
 * never be deleted).
 */
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
}: WorkflowCanvasProps) {
  // Ghosts join the layout as unpositioned steps, so dagre places them
  // relative to the real graph (which keeps its positions) instead of in a
  // disconnected pile. layoutWorkflow passes edges through untouched.
  const laid = useMemo(() => {
    if (!ghosts || ghosts.length === 0) return layoutWorkflow(workflow);
    const ghostSteps: StepInstance[] = ghosts.map((g) => ({
      ...g,
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    }));
    return layoutWorkflow({
      ...workflow,
      steps: [...workflow.steps, ...ghostSteps],
      edges: [...workflow.edges, ...(ghostEdges ?? [])],
    });
  }, [workflow, ghosts, ghostEdges]);

  const initialNodes: (CanvasNode | CanvasGhostNode)[] = useMemo(() => {
    const placed = new Map(
      [laid.trigger, ...laid.steps].map((s) => [s.id, s] as const),
    );
    const nodes: (CanvasNode | CanvasGhostNode)[] = [workflow.trigger, ...workflow.steps].map(
      (s): CanvasNode => ({
        id: s.id,
        type: 'step',
        position: placed.get(s.id)?.position ?? s.position,
        data: {
          step: placed.get(s.id) ?? s,
          kind: kindOf(s.type),
          status: stepRuns?.[s.id]?.status,
          extra: renderNodeExtra?.(s.id),
          fresh: builtIds?.includes(s.id) ?? false,
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
    return nodes;
  }, [laid, workflow, stepRuns, ghosts, builtIds, selectedStepId, renderNodeExtra]);

  const initialEdges: (CanvasEdge | CanvasGhostEdge)[] = useMemo(() => {
    const ghostIds = new Set((ghosts ?? []).map((g) => g.id));
    return laid.edges.map((e) =>
      ghostIds.has(e.from) || ghostIds.has(e.to)
        ? {
            id: `${e.from}->${e.to}`,
            source: e.from,
            target: e.to,
            type: 'ghost',
            data: { when: e.when },
            selectable: false,
          }
        : {
            id: `${e.from}->${e.to}`,
            source: e.from,
            target: e.to,
            type: 'flow',
            animated: stepRuns?.[e.to]?.status === 'running',
            data: { when: e.when },
            style: { stroke: 'hsl(var(--muted-foreground) / 0.5)', strokeWidth: 2 },
          },
    );
  }, [laid, stepRuns, ghosts]);

  const [nodes, setNodes, onNodesChangeInner] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeInner] = useEdgesState(initialEdges);
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const design = mode === 'design';

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode | CanvasGhostNode>[]) => {
      onNodesChangeInner(changes);
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
    (changes: EdgeChange<CanvasEdge | CanvasGhostEdge>[]) => {
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
        onNodeClick={(_, node) => {
          if (node.type !== 'ghost') onSelectStep(node.id);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={design}
        nodesConnectable={design}
        elementsSelectable={design}
        deleteKeyCode={design ? 'Backspace' : null}
        fitView
      />
    </MotionConfig>
  );
}

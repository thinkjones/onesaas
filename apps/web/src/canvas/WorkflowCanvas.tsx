import '@xyflow/react/dist/style.css';
import { catalog, type StepKind, type StepRun, type Workflow } from '@dad/shared';
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
  /** Design-mode plan preview (M3): accepted and rendered inertly. */
  ghosts?: GhostStep[];
  selectedStepId?: string;
  onSelectStep(stepId: string): void;
  /** Design mode only (M3 consumes; no-op-safe). */
  onChange?(op: CanvasOp): void;
  /** Approval / failure cards slot. */
  renderNodeExtra?(stepId: string): ReactNode;
}

type CanvasNode = Node<StepNodeData, 'step'>;
type CanvasEdge = Edge<{ when?: string }, 'flow'>;

const nodeTypes = { step: StepNode };
const edgeTypes = { flow: FlowEdge };

function kindOf(type: string): StepKind {
  return catalog[type]?.kind ?? 'enrich';
}

/**
 * The workflow canvas shared by design and runtime modes. Runtime nodes are
 * not draggable/connectable and elements are not selectable; clicks still
 * report through onSelectStep so Task 5 can open the inspector.
 */
export default function WorkflowCanvas({
  workflow,
  mode,
  stepRuns,
  ghosts,
  selectedStepId,
  onSelectStep,
  onChange,
  renderNodeExtra,
}: WorkflowCanvasProps) {
  const laid = useMemo(() => layoutWorkflow(workflow), [workflow]);

  const initialNodes: CanvasNode[] = useMemo(() => {
    const steps = [laid.trigger, ...laid.steps];
    const nodes: CanvasNode[] = steps.map((s) => ({
      id: s.id,
      type: 'step',
      position: s.position,
      data: {
        step: s,
        kind: kindOf(s.type),
        status: stepRuns?.[s.id]?.status,
        extra: renderNodeExtra?.(s.id),
      },
      selected: s.id === selectedStepId,
    }));
    // Ghosts sit apart from the laid-out graph, inert and faded (M3 owns
    // their editing; this task only renders them).
    const maxX = Math.max(0, ...steps.map((s) => s.position.x));
    for (const [i, g] of (ghosts ?? []).entries()) {
      const position = { x: maxX + 400, y: i * 180 };
      nodes.push({
        id: g.id,
        type: 'step',
        position,
        data: {
          step: { ...g, config: {}, inputs: {}, position },
          kind: kindOf(g.type),
          ghost: true,
        },
        selectable: false,
        draggable: false,
        connectable: false,
      });
    }
    return nodes;
  }, [laid, stepRuns, ghosts, selectedStepId, renderNodeExtra]);

  const initialEdges: CanvasEdge[] = useMemo(
    () =>
      laid.edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        type: 'flow',
        animated: stepRuns?.[e.to]?.status === 'running',
        data: { when: e.when },
        style: { stroke: 'hsl(var(--muted-foreground) / 0.5)', strokeWidth: 2 },
      })),
    [laid, stepRuns],
  );

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
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChangeInner(changes);
      if (!design || !onChange) return;
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          onChange({ op: 'move', stepId: c.id, position: c.position });
        } else if (c.type === 'remove') {
          onChange({ op: 'remove', stepId: c.id });
        }
      }
    },
    [design, onChange, onNodesChangeInner],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
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
          if (!node.data?.ghost) onSelectStep(node.id);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={design}
        nodesConnectable={design}
        elementsSelectable={design}
        fitView
      />
    </MotionConfig>
  );
}

import type { StepKind } from '@onesaas/shared';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { cn } from 'cn';
import AppCard from './AppCard.tsx';
import { stepVisuals } from '../canvas/stepVisuals.ts';

export interface GhostNodeData extends Record<string, unknown> {
  title: string;
  summary: string;
  kind: StepKind;
}

/**
 * One planned-but-not-built box from the agent's `plan` event: dashed, half
 * transparent, never interactive (WorkflowCanvas marks ghost nodes
 * unselectable/undraggable/unconnectable). `data-ghost` is the test and
 * Task 7 hook for finding planned boxes.
 */
export default function GhostNode({ data }: NodeProps<Node<GhostNodeData>>) {
  const { title, summary, kind } = data;
  const { icon: Icon, tint } = stepVisuals[kind];
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <AppCard data-ghost="true" className="w-[470px] border-dashed p-4 opacity-50">
        <div className="flex items-center gap-2.5">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-s)]', tint)}>
            <Icon className="size-5" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 text-base font-semibold break-words">
            {title}
          </p>
        </div>
        <p className="mt-2 text-base break-words text-muted-foreground">{summary}</p>
      </AppCard>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export interface GhostEdgeData extends Record<string, unknown> {
  when?: string;
}

/**
 * A planned wire between ghost boxes: dashed, with the same `when` pill as a
 * real FlowEdge. (FlowEdge drops the edge `style`, so ghosts need their own
 * renderer for the dash rather than a style prop.)
 */
export function GhostEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<GhostEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ strokeDasharray: '6 4', stroke: 'hsl(var(--muted-foreground) / 0.5)', strokeWidth: 2 }}
      />
      {data?.when && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-full border border-dashed border-border bg-card px-2 py-0.5 text-sm text-muted-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.when}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

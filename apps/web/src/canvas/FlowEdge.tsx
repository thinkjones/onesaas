import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

export interface FlowEdgeData extends Record<string, unknown> {
  /** `when` condition text; shown as a small pill label when present. */
  when?: string;
}

/**
 * One workflow wire. The moving-dash animation is driven by the edge's
 * `animated` flag (set by WorkflowCanvas while the target is running) via
 * the library stylesheet; this component adds the `when` pill label.
 */
export default function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<FlowEdgeData>>) {
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
      <BaseEdge id={id} path={path} />
      {data?.when && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-full border border-border bg-card px-2 py-0.5 text-sm text-muted-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.when}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { useState } from 'react';
import { choiceWhen, conditionLabel } from './edgeConditions.ts';

/**
 * Design-mode condition editing for one wire. The canvas supplies this only
 * when the edge's source step sorts into options (ai.classify): picking an
 * option calls `onConnect` with the full `when`, and the canvas sends a
 * connect op (re-connecting replaces the wire's condition server-side).
 */
export interface EdgeCondition {
  /** Upstream sort step id: the LHS of the `when` (`<stepId>.choice == '<option>'`). */
  stepId: string;
  /** The sort step's options. */
  options: string[];
  /** Called with the new `when` when Dad picks an option. */
  onConnect(when: string): void;
}

export interface FlowEdgeData extends Record<string, unknown> {
  /** `when` condition text; shown as a small pill label when present. */
  when?: string;
  /** Plain words on the line: "then", "if you say it looks good". */
  label?: string;
  /** Runs mode: the run has reached the far end of this wire. */
  reached?: boolean;
  condition?: EdgeCondition;
}

const pillClass =
  'nodrag nopan rounded-full border border-border bg-card px-2 py-0.5 text-sm text-muted-foreground';

/**
 * One workflow wire. The moving-dash animation is driven by the edge's
 * `animated` flag (set by WorkflowCanvas while the target is running) via
 * the library stylesheet; this component adds the `when` pill label.
 *
 * In design mode on a wire out of a sort step, clicking the wire or the pill
 * opens the "Only continue when…" picker; picking an option re-connects the
 * wire with that condition.
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
  // Steps in one column get a plain line: a stepped path loops in a tight gap.
  const [path, labelX, labelY] =
    Math.abs(sourceX - targetX) < 1
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 14,
        });
  const [open, setOpen] = useState(false);
  const condition = data?.condition;
  const label = data?.when !== undefined ? conditionLabel(data.when) : undefined;

  return (
    <>
      <g onClick={condition ? () => setOpen((v) => !v) : undefined}>
        <BaseEdge
          id={id}
          path={path}
          interactionWidth={condition ? 20 : undefined}
          style={{ stroke: data?.reached ? 'var(--accent-2)' : 'var(--border-strong)', strokeWidth: 2 }}
        />
      </g>
      {label === undefined && data?.label !== undefined && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {(label !== undefined || (condition && open)) && (
        <EdgeLabelRenderer>
          <div
            className="absolute"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label !== undefined &&
              (condition ? (
                <button
                  type="button"
                  className={`${pillClass} cursor-pointer`}
                  style={{ pointerEvents: 'all' }}
                  onClick={() => setOpen((v) => !v)}
                >
                  {label}
                </button>
              ) : (
                <div className={pillClass}>{label}</div>
              ))}
            {condition && open && (
              <div
                role="dialog"
                aria-label="Only continue when"
                className="nodrag nopan absolute left-1/2 top-full z-10 mt-2 w-max -translate-x-1/2 rounded-[var(--radius)] border border-border bg-card p-3 shadow-lg"
                style={{ pointerEvents: 'all' }}
              >
                <p className="mb-2 text-base font-medium text-foreground">Only continue when…</p>
                <div className="flex flex-col gap-1.5">
                  {condition.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="min-h-10 rounded-[var(--radius)] border border-border bg-card px-3 py-1.5 text-left text-base text-foreground hover:bg-muted"
                      onClick={() => {
                        condition.onConnect(choiceWhen(condition.stepId, option));
                        setOpen(false);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

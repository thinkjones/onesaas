import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
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
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const [open, setOpen] = useState(false);
  const condition = data?.condition;
  const label = data?.when !== undefined ? conditionLabel(data.when) : undefined;

  return (
    <>
      <g onClick={condition ? () => setOpen((v) => !v) : undefined}>
        <BaseEdge id={id} path={path} interactionWidth={condition ? 20 : undefined} />
      </g>
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

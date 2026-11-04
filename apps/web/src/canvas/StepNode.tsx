import type { StepInstance, StepKind, StepRunStatus } from '@onesaas/shared';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from 'cn';
import Check from 'lucide-react/icons/check';
import Pause from 'lucide-react/icons/pause';
import Pencil from 'lucide-react/icons/pencil';
import Plus from 'lucide-react/icons/plus';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Trash2 from 'lucide-react/icons/trash-2';
import { motion } from 'motion/react';
import { useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import StatusBadge from '../design/StatusBadge.tsx';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { NODE_WIDTH } from './layout.ts';
import { stepVisuals } from './stepVisuals.ts';

export interface StepNodeData extends Record<string, unknown> {
  step: StepInstance;
  kind: StepKind;
  /** Reading-order number shown on the card. */
  number?: number;
  /** Present in Runs mode, when this step belongs to the run being shown. */
  status?: StepRunStatus;
  /** Runs mode: draws the run's card rather than the design card. */
  runs?: boolean;
  /** One plain sentence about what happened here (Runs only). */
  outcome?: string;
  /** Runs mode: the approval or failure body. The step grows in place to hold it. */
  expanded?: ReactNode;
  /** Problems and Try it verdicts under a design card. */
  extra?: ReactNode;
  /** A step that just finished building animates in bigger (0.9→1, 300ms). */
  fresh?: boolean;
  /**
   * The owning workflow id (set by WorkflowCanvas). Without it the `?`
   * button and alt-click stay off — the server scopes steps by workflow.
   */
  workflowId?: string;
  /** Design-mode actions, chat and settings. Absent in Runs mode. */
  design?: {
    onAdd(): void;
    onSelect(): void;
    onDelete(): void;
    /** False for the trigger, which cannot be deleted. */
    showDelete: boolean;
    /** Rendered node chat box, when open for this step. */
    nodeChat?: ReactNode;
    /** Rendered settings popover, attached to this card when it's selected. */
    settings?: ReactNode;
  };
}

// Connectors meet the flow column, even on a card wider than the column.
const HANDLE_STYLE = {
  left: NODE_WIDTH / 2,
  width: 8,
  height: 8,
  backgroundColor: 'var(--bg-raised)',
  borderColor: 'var(--border-strong)',
};
const QUIET_HANDLE = { ...HANDLE_STYLE, opacity: 0 };

function StatusDot({ status }: { status: StepRunStatus }) {
  return (
    <span className="status-dot" data-status={status} aria-hidden>
      {status === 'done' && <Check size={16} strokeWidth={3} />}
      {status === 'waiting' && <Pause size={14} fill="currentColor" />}
      {status === 'failed' && '!'}
    </span>
  );
}

// The floating bar's bottom edge and the board's margin.
const POPOVER_TOP_LIMIT = 80;
const POPOVER_BOTTOM_MARGIN = 14;
const POPOVER_MIN_HEIGHT = 420;

/**
 * Settings attached to the selected card. Near the bottom of the window it rides
 * up so the form stays usable, but never under the bar.
 */
function StepPopover({ cardY, children }: { cardY: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Re-fits whenever the layout moves the card.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.top = '0px';
    const { top } = el.getBoundingClientRect();
    const room = window.innerHeight - top - POPOVER_BOTTOM_MARGIN;
    const shift = Math.min(Math.max(POPOVER_MIN_HEIGHT - room, 0), Math.max(top - POPOVER_TOP_LIMIT, 0));
    el.style.top = `${-shift}px`;
    el.style.maxHeight = `${Math.max(room + shift, 0)}px`;
  }, [cardY]);
  return (
    // A click inside the settings isn't a click on the step.
    <div ref={ref} className="step-popover nodrag nopan nowheel" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/**
 * One step on the board. Design shows its number, kind tile, title and
 * description. Runs shows what happened: finished steps shrink to one line,
 * steps not reached are outlines, and a waiting or failed step expands in
 * place. Text wraps, never truncates: WorkflowCanvas measures each card and
 * re-lays out the flow to make room.
 */
export default function StepNode({ id, data, selected, positionAbsoluteY }: NodeProps<Node<StepNodeData>>) {
  const { step, kind, number, status, runs, outcome, expanded, extra, fresh, workflowId, design } = data;
  const approval = step.type === 'approval.ask';
  const { icon, tint } = stepVisuals[kind];
  const Icon = approval ? ShieldCheck : icon;
  const explainTarget =
    workflowId === undefined ? null : { kind: 'step' as const, id: step.id, context: workflowId };
  const explainData = explainTarget ? dataExplainValue(explainTarget, step.title) : undefined;
  const label = number === undefined ? step.title : `${number} · ${step.title}`;
  const stop = (fn: () => void) => (e: SyntheticEvent) => {
    e.stopPropagation();
    fn();
  };
  const runStatus: StepRunStatus = status ?? 'pending';
  const handleStyle = runs ? QUIET_HANDLE : HANDLE_STYLE;
  return (
    <div className="group">
      {design && (
        <div
          role="toolbar"
          aria-label={`${step.title} actions`}
          className="nodrag nopan absolute -top-3 right-2 z-10 hidden gap-1 group-hover:flex group-focus-within:flex"
        >
          <button
            type="button"
            aria-label={`Add a step after ${step.title}`}
            onClick={stop(design.onAdd)}
            className="rounded-full border border-border bg-card p-1.5 shadow-sm hover:bg-accent"
          >
            <Plus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Change ${step.title}`}
            onClick={stop(design.onSelect)}
            className="rounded-full border border-border bg-card p-1.5 shadow-sm hover:bg-accent"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
          {design.showDelete && (
            <button
              type="button"
              aria-label={`Delete ${step.title}`}
              onClick={stop(design.onDelete)}
              className="rounded-full border border-border bg-card p-1.5 shadow-sm hover:bg-accent"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <motion.div
        key={status ?? 'none'}
        initial={{ opacity: 0, scale: fresh === true ? 0.9 : 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: fresh === true ? 0.3 : 0.18, ease: 'easeInOut' }}
      >
        {runs && expanded ? (
          <div
            data-step-id={id}
            data-status={runStatus}
            data-explain={explainData}
            className="step-expanded nodrag nopan nowheel"
            // The card holds real controls; none of them should open the inspector.
            onClick={(e) => e.stopPropagation()}
          >
            <div className="head">
              <StatusDot status={runStatus} />
              <span className="label">{label}</span>
              <StatusBadge status={runStatus} />
              {explainTarget && <Explain target={explainTarget} label={step.title} />}
            </div>
            {expanded}
          </div>
        ) : runs ? (
          <div
            data-step-id={id}
            data-status={status}
            data-run={runStatus}
            data-explain={explainData}
            className="step-card"
          >
            <StatusDot status={runStatus} />
            <div className="main">
              <span className="label">{label}</span>
              <span data-outcome="true" className="outcome">
                {outcome ?? (runStatus === 'skipped' ? 'Skipped.' : 'Not started.')}
              </span>
            </div>
            {runStatus === 'skipped' && <StatusBadge status="skipped" />}
          </div>
        ) : (
          <div
            data-step-id={id}
            data-status={status}
            data-selected={selected ? 'true' : undefined}
            data-explain={explainData}
            className="step-card"
          >
            {number !== undefined && <span className="num">{number}</span>}
            <span className={cn('kind-tile', tint)}>
              <Icon size={19} aria-hidden />
            </span>
            <div className="main">
              <span className="title">{step.title}</span>
              <span className="desc">{step.summary}</span>
              {step.type === 'trigger.email' && (
                <span className="desc">Works while Gmail is open in Chrome.</span>
              )}
              {extra && <div className="mt-1">{extra}</div>}
            </div>
            {approval && <span className="you-decide">You decide</span>}
            {explainTarget && <Explain target={explainTarget} label={step.title} />}
          </div>
        )}
      </motion.div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
      {design?.nodeChat && <div className="mt-2 w-[470px]">{design.nodeChat}</div>}
      {design?.settings && (
        <>
          <span className="step-popover-arrow" aria-hidden />
          <StepPopover cardY={positionAbsoluteY}>{design.settings}</StepPopover>
        </>
      )}
    </div>
  );
}

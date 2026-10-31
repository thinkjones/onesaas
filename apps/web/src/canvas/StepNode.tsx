import type { StepInstance, StepKind, StepRunStatus } from '@dad/shared';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from 'cn';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode, SyntheticEvent } from 'react';
import AppCard from '../design/AppCard.tsx';
import StatusBadge from '../design/StatusBadge.tsx';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { stepVisuals } from './stepVisuals.ts';

export interface StepNodeData extends Record<string, unknown> {
  step: StepInstance;
  kind: StepKind;
  /** Present in runtime mode when this step has a run record. */
  status?: StepRunStatus;
  /** Approval / failure card slot (Task 6 via renderNodeExtra). */
  extra?: ReactNode;
  /** A step that just finished building animates in bigger (0.9→1, 300ms). */
  fresh?: boolean;
  /**
   * The owning workflow id (set by WorkflowCanvas). Without it the `?`
   * button and alt-click stay off — the server scopes steps by workflow.
   */
  workflowId?: string;
  /**
   * Design-mode hover actions + node chat (Bug #4). Absent in runtime mode
   * (and on ghosts, which use GhostNode): no toolbar, no chat.
   */
  design?: {
    onAdd(): void;
    onSelect(): void;
    onDelete(): void;
    /** False for the trigger, which cannot be deleted. */
    showDelete: boolean;
    /** Rendered node chat box, when open for this step. */
    nodeChat?: ReactNode;
  };
}

// Handle chrome matches the card language: token-derived inline styles beat
// the library stylesheet without inventing colours.
const HANDLE_STYLE = {
  backgroundColor: 'hsl(var(--card))',
  borderColor: 'hsl(var(--border))',
};

/**
 * One 280px workflow box: kind icon, title, plain-English summary, and the
 * runtime status badge when known. Enter and state changes animate
 * (opacity + scale 0.96→1, 250ms; a freshly built box scales 0.9→1 over
 * 300ms); WorkflowCanvas wraps the tree in MotionConfig
 * reducedMotion="user" for prefers-reduced-motion.
 */
export default function StepNode({ id, data, selected }: NodeProps<Node<StepNodeData>>) {
  const { step, kind, status, extra, fresh, workflowId, design } = data;
  const { icon: Icon, tint } = stepVisuals[kind];
  const explainTarget =
    workflowId === undefined ? null : { kind: 'step' as const, id: step.id, context: workflowId };
  const stop = (fn: () => void) => (e: SyntheticEvent) => {
    e.stopPropagation();
    fn();
  };
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
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <motion.div
        key={status ?? 'none'}
        initial={{ opacity: 0, scale: fresh === true ? 0.9 : 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: fresh === true ? 0.3 : 0.25, ease: 'easeInOut' }}
      >
        <AppCard
          data-step-id={id}
          data-status={status}
          data-explain={explainTarget ? dataExplainValue(explainTarget, step.title) : undefined}
          className={cn('w-[280px] p-4', selected && 'ring-2 ring-ring')}
        >
          <div className="flex items-center gap-2.5">
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', tint)}>
              <Icon className="size-5" aria-hidden />
            </span>
            {/* AppCard ships no overflow protection: long titles truncate. */}
            <p className="min-w-0 flex-1 truncate text-base font-semibold" title={step.title}>
              {step.title}
            </p>
            {explainTarget && <Explain target={explainTarget} label={step.title} />}
          </div>
          <p className="mt-2 text-base break-words text-muted-foreground">{step.summary}</p>
          {step.type === 'trigger.email' && (
            <p className="mt-1 text-sm break-words text-muted-foreground">
              Works while Gmail is open in Chrome.
            </p>
          )}
          {status && (
            <div className="mt-3">
              <StatusBadge status={status} />
            </div>
          )}
        </AppCard>
        {extra && <div className="mt-2 w-[280px]">{extra}</div>}
      </motion.div>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      {design?.nodeChat && <div className="mt-2 w-[280px]">{design.nodeChat}</div>}
    </div>
  );
}

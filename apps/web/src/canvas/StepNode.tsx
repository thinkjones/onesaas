import type { StepInstance, StepKind, StepRunStatus } from '@dad/shared';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from 'cn';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import AppCard from '../design/AppCard.tsx';
import StatusBadge from '../design/StatusBadge.tsx';
import { stepVisuals } from './stepVisuals.ts';

export interface StepNodeData extends Record<string, unknown> {
  step: StepInstance;
  kind: StepKind;
  /** Present in runtime mode when this step has a run record. */
  status?: StepRunStatus;
  /** Approval / failure card slot (Task 6 via renderNodeExtra). */
  extra?: ReactNode;
  /** Design plan preview (M3): rendered faded, never interactive. */
  ghost?: boolean;
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
 * (opacity + scale 0.96→1, 250ms); WorkflowCanvas wraps the tree in
 * MotionConfig reducedMotion="user" for prefers-reduced-motion.
 */
export default function StepNode({ id, data, selected }: NodeProps<Node<StepNodeData>>) {
  const { step, kind, status, extra, ghost } = data;
  const { icon: Icon, tint } = stepVisuals[kind];
  return (
    <>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <motion.div
        key={status ?? 'none'}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
      >
        <AppCard
          data-step-id={id}
          data-status={status}
          className={cn(
            'w-[280px] p-4',
            ghost && 'border-dashed opacity-60',
            selected && 'ring-2 ring-ring',
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', tint)}>
              <Icon className="size-5" aria-hidden />
            </span>
            {/* AppCard ships no overflow protection: long titles truncate. */}
            <p className="min-w-0 flex-1 truncate text-base font-semibold" title={step.title}>
              {step.title}
            </p>
          </div>
          <p className="mt-2 text-base break-words text-muted-foreground">{step.summary}</p>
          {status && (
            <div className="mt-3">
              <StatusBadge status={status} />
            </div>
          )}
        </AppCard>
        {extra && <div className="mt-2 w-[280px]">{extra}</div>}
      </motion.div>
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </>
  );
}

import type { StepRunStatus } from '@dad/shared';
import { cn } from 'cn';

/**
 * The one status language for the whole app (M2 Global Constraints).
 *
 * Decision: this does NOT wrap the shadcn Badge. The shadcn variants
 * (default/secondary/destructive/outline/…) don't map onto the six run
 * statuses, and every status needs its own tint anyway — a plain pill keeps
 * the status → label → colour mapping in exactly one place.
 */
const STATUS_LABEL: Record<StepRunStatus, string> = {
  pending: 'Not started',
  running: 'Working…', // U+2026 ELLIPSIS — match byte-exact, not "...".
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Needs a look',
  skipped: 'Skipped',
};

const STATUS_TINT: Record<StepRunStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'motion-safe:animate-pulse bg-accent-soft text-primary',
  waiting: 'bg-warning-soft text-warning',
  done: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-destructive',
  skipped: 'border-dashed border-muted-foreground/50 bg-muted text-muted-foreground',
};

export default function StatusBadge({ status }: { status: StepRunStatus }) {
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border border-transparent px-[0.55rem] py-[0.1rem] text-[0.72rem] font-semibold whitespace-nowrap',
        STATUS_TINT[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

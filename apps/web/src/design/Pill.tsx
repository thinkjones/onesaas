import { cn } from 'cn';
import type { ReactNode } from 'react';

export type PillTone = 'open' | 'done' | 'waiting' | 'neutral';

const TONE: Record<PillTone, string> = {
  open: 'bg-accent-soft text-primary',
  done: 'bg-success-soft text-success',
  waiting: 'bg-warning-soft text-warning',
  neutral: 'bg-muted text-muted-foreground',
};

/**
 * Craft status pill (§9) for non-run statuses: counts and stage labels.
 * (Run/step statuses use StatusBadge, which owns that mapping.)
 */
export default function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full px-[0.55rem] py-[0.1rem] text-[0.72rem] font-semibold whitespace-nowrap',
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

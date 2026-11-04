import type { StepRunStatus } from '@onesaas/shared';

export const STATUS_LABEL: Record<StepRunStatus, string> = {
  pending: 'Not started',
  running: 'Working…', // U+2026 ELLIPSIS — match byte-exact, not "...".
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Needs a look',
  skipped: 'Skipped',
};

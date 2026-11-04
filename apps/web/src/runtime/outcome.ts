import type { StepRun } from '@onesaas/shared';

/**
 * The one-line "what happened at that node" caption for Watch-it-Run. Done
 * steps show their plain-English `why` (the engine always writes one; the
 * guard is for crafted rows, mirroring story.ts), failed steps their error,
 * and the in-flight states a short label. Pending steps — and steps with no
 * record yet — get no caption: nothing has happened to report.
 */
export function outcomeOf(stepRun: StepRun | undefined): string | undefined {
  if (stepRun === undefined) return undefined;
  switch (stepRun.status) {
    case 'done':
      return stepRun.why;
    case 'failed':
      return stepRun.error ?? 'Something went wrong.';
    case 'waiting':
      return 'Waiting for you to check.';
    case 'running':
      return 'Running…';
    case 'skipped':
      return 'Skipped.';
    case 'pending':
      return undefined;
  }
}

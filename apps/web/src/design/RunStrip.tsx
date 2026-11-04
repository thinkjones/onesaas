import type { StepRunStatus } from '@onesaas/shared';

/** One segment per step, coloured by status. */
export default function RunStrip({ statuses }: { statuses: StepRunStatus[] }) {
  const done = statuses.filter((s) => s === 'done').length;
  const failedAt = statuses.indexOf('failed');
  const label =
    failedAt >= 0
      ? `Stopped at step ${failedAt + 1} of ${statuses.length}`
      : `${done} of ${statuses.length} steps done`;
  return (
    <div className="run-strip" role="img" aria-label={label}>
      {statuses.map((status, i) => (
        <span key={i} data-status={status} />
      ))}
    </div>
  );
}

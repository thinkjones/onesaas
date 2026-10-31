import type { Run } from '@dad/shared';
import { cn } from 'cn';
import StatusBadge from '../design/StatusBadge.tsx';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { formatRunListTime, runDisplayName } from './format.ts';

export interface RunsListProps {
  runs: Run[];
  selectedRunId: string | undefined;
  onSelect(runId: string): void;
  /**
   * Story last line per run id. NOTE: the story shows only the FIRST
   * failed/waiting step, so on forked flows a row's last line under-reports
   * failures elsewhere — accepted for M2 (server story rule, not list logic).
   */
  lastLineByRunId?: Record<string, string | undefined>;
}

/**
 * The left rail: one row per run — "Today 10:42 · Sarah Lee", a status badge,
 * and the run story's last line truncated. listbox/option roles so selection
 * is exposed via aria-selected.
 */
export default function RunsList({
  runs,
  selectedRunId,
  onSelect,
  lastLineByRunId,
}: RunsListProps) {
  return (
    <div role="listbox" aria-label="Runs" className="flex flex-col gap-2">
      {runs.map((run) => {
        const selected = run.id === selectedRunId;
        const lastLine = lastLineByRunId?.[run.id];
        const label = `the ${formatRunListTime(run.startedAt)} run`;
        const target = { kind: 'run' as const, id: run.id };
        return (
          <div
            key={run.id}
            role="option"
            aria-selected={selected}
            tabIndex={0}
            onClick={() => onSelect(run.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(run.id);
              }
            }}
            data-explain={dataExplainValue(target, label)}
            className={cn(
              'min-h-10 cursor-pointer rounded-[var(--radius)] border border-border bg-card p-3 shadow-sm',
              selected && 'ring-2 ring-ring',
            )}
          >
            <div className="flex items-center gap-1">
              <p className="min-w-0 flex-1 text-base font-medium">
                <span>{formatRunListTime(run.startedAt)}</span>
                {' · '}
                <span>{runDisplayName(run.triggerPayload)}</span>
              </p>
              <Explain target={target} label={label} />
            </div>
            <div className="mt-1.5">
              <StatusBadge status={run.status} />
            </div>
            {lastLine !== undefined && lastLine !== '' && (
              <p className="mt-1.5 truncate text-base text-muted-foreground" title={lastLine}>
                {lastLine}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

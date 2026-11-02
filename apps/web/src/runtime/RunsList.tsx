import type { Run } from '@dad/shared';
import { cn } from 'cn';
import StatusBadge from '../design/StatusBadge.tsx';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { formatDateTime, formatRunListTime, runDisplayName } from './format.ts';

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
    <div role="listbox" aria-label="Runs" className="rows flex flex-col">
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
            className={cn('row', selected && 'selected')}
          >
            <span className="when" title={formatDateTime(run.startedAt)}>
              {formatRunListTime(run.startedAt)}
            </span>
            <span className="body">
              <span className="t block truncate">{runDisplayName(run.triggerPayload)}</span>
              {lastLine !== undefined && lastLine !== '' && (
                <span className="dim block truncate" title={lastLine}>
                  {lastLine}
                </span>
              )}
            </span>
            <StatusBadge status={run.status} />
            <Explain target={target} label={label} />
          </div>
        );
      })}
    </div>
  );
}

import type { Run } from '@onesaas/shared';
import { STATUS_LABEL } from '../design/statusLabels.ts';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { formatDateTime, formatRunListTime, runDisplayName } from './format.ts';

export interface RunsListProps {
  runs: Run[];
  selectedRunId: string | undefined;
  onSelect(runId: string): void;
}

/**
 * Runs mode's left list: the full name, then a coloured status with the time.
 * listbox/option roles so selection is exposed via aria-selected.
 */
export default function RunsList({ runs, selectedRunId, onSelect }: RunsListProps) {
  return (
    <div role="listbox" aria-label="Runs" className="flex flex-col gap-1">
      {runs.map((run) => {
        const when = formatRunListTime(run.startedAt);
        return (
          <button
            key={run.id}
            type="button"
            role="option"
            aria-selected={run.id === selectedRunId}
            onClick={() => onSelect(run.id)}
            data-explain={dataExplainValue({ kind: 'run', id: run.id }, `the ${when} run`)}
            className="runs-list-row"
          >
            <span className="who">{runDisplayName(run.triggerPayload)}</span>
            <span className="state" data-status={run.status} title={formatDateTime(run.startedAt)}>
              {STATUS_LABEL[run.status]} · {when.replace(/^Today /, '')}
            </span>
          </button>
        );
      })}
    </div>
  );
}

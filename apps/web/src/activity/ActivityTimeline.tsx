import type { Run } from '@dad/shared';
import PencilIcon from 'lucide-react/icons/pencil';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getRun } from '../api.ts';
import StatusBadge from '../design/StatusBadge.tsx';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { formatDateTime, formatRunListTime, runDisplayName } from '../runtime/format.ts';
import { groupRunsByTime } from './grouping.ts';

export interface ActivityTimelineProps {
  runs: Run[];
  names: Map<string, string>;
  /** List review shows one reducer, so the per-row name line is noise. */
  hideReducerName?: boolean;
}

function TimelineRow({
  run,
  reducerName,
  hideReducerName,
}: {
  run: Run;
  reducerName: string;
  hideReducerName: boolean;
}) {
  // One cached detail query per row for the story's last line (the
  // RuntimeView pattern — runs lists are small; the ['run', id] key is
  // shared with the run detail view, so it costs no extra request there).
  const storyQuery = useQuery({ queryKey: ['run', run.id], queryFn: () => getRun(run.id) });
  const story = storyQuery.data?.story;
  const line = story?.length ? story[story.length - 1]! : runDisplayName(run.triggerPayload);
  const label = `${reducerName} run`;
  const target = { kind: 'run' as const, id: run.id };
  return (
    <div data-explain={dataExplainValue(target, label)} className="flex items-center gap-1">
      <Link
        to={`/reducers/${run.workflowId}?mode=runtime&run=${run.id}`}
        className="row min-w-0 flex-1"
      >
        <span className="when" title={formatDateTime(run.startedAt)}>
          {formatRunListTime(run.startedAt)}
        </span>
        <span className="body">
          {!hideReducerName && <span className="t block truncate">{reducerName}</span>}
          <span className="dim block truncate" title={line}>
            {line}
          </span>
        </span>
        <StatusBadge status={run.status} />
      </Link>
      <Link
        to={`/reducers/${run.workflowId}?mode=design&run=${run.id}`}
        aria-label="Open in design mode"
        title="Open in design mode"
        className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
      >
        <PencilIcon size={16} aria-hidden />
      </Link>
      <Explain target={target} label={label} />
    </div>
  );
}

/**
 * The Activity timeline, shared by the Activity page and the per-reducer
 * list review: runs newest-first, grouped into Today / This week / Past
 * (empty groups omitted). Rows open Watch-it-Run mode; the pencil opens
 * design mode for the same run.
 */
export default function ActivityTimeline({ runs, names, hideReducerName }: ActivityTimelineProps) {
  // "Now" is fixed per mount (lazy init keeps the render pure): groups never
  // reshuffle under a slow query settling after midnight.
  const [now] = useState(() => new Date());
  const sorted = [...runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const groups = groupRunsByTime(sorted, now);
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="dim mt-4 mb-1 first:mt-0">{group.label}</h3>
          <div className="rows flex flex-col">
            {group.runs.map((run) => (
              <TimelineRow
                key={run.id}
                run={run}
                reducerName={names.get(run.workflowId) ?? 'Deleted reducer'}
                hideReducerName={hideReducerName ?? false}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

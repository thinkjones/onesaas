import type { Run } from '@dad/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getRun, getRuns, useWorkflows } from '../api.ts';
import StatusBadge from '../design/StatusBadge.tsx';
import Explain from '../explain/Explain.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { formatRunListTime, runDisplayName } from '../runtime/format.ts';

/**
 * Inbox (Bug #3): everything the chore reducers have done, newest first —
 * one Gmail-like row per run across all reducers: when it ran, which
 * reducer ran, one line about what happened, and its status. The story
 * line comes from one cached detail query per row (the RuntimeView
 * pattern — runs lists are small); while it loads, the sender/subject
 * stands in.
 */
function InboxRow({ run, reducerName }: { run: Run; reducerName: string }) {
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
        to={`/reducers/${run.workflowId}?run=${run.id}`}
        className="min-w-0 flex-1 rounded-[var(--radius)] border border-border bg-card p-3 shadow-sm"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-base font-medium">{reducerName}</p>
          <p className="shrink-0 text-base text-muted-foreground">
            {formatRunListTime(run.startedAt)}
          </p>
        </div>
        <p className="mt-1 truncate text-base text-muted-foreground" title={line}>
          {line}
        </p>
        <div className="mt-1.5">
          <StatusBadge status={run.status} />
        </div>
      </Link>
      <Explain target={target} label={label} />
    </div>
  );
}

export default function InboxPage() {
  const workflows = useWorkflows();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });

  if (workflows.isPending || runs.isPending) return <p>Loading inbox…</p>;
  if (workflows.isError || runs.isError || !workflows.data || !runs.data) {
    return <p role="alert">Couldn&apos;t load the inbox. Try again.</p>;
  }
  const names = new Map(workflows.data.map((w) => [w.id, w.name]));
  const sorted = [...runs.data].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Inbox</h1>
      {sorted.length === 0 ? (
        <p className="text-base text-muted-foreground">
          Nothing has happened yet — describe a chore in{' '}
          <Link to="/automate" className="text-primary underline-offset-4 hover:underline">
            Automate
          </Link>{' '}
          and your runs will land here.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((run) => (
            <InboxRow
              key={run.id}
              run={run}
              reducerName={names.get(run.workflowId) ?? 'Deleted reducer'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

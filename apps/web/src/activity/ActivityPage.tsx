import { useQuery } from '@tanstack/react-query';
import type { Run } from '@dad/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getRun, getRuns, useWorkflows } from '../api.ts';
import StatusBadge from '../design/StatusBadge.tsx';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { formatDateTime, formatRunListTime, runDisplayName } from '../runtime/format.ts';

const STATUS_FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'waiting', label: 'Waiting for you' },
  { value: 'failed', label: 'Needs a look' },
  { value: 'running', label: 'Running' },
  { value: 'done', label: 'Finished' },
];

const runPath = (run: Run): string => `/reducers/${run.workflowId}?mode=design&run=${run.id}`;

function ActivityRow({ run, name }: { run: Run; name: string }) {
  const navigate = useNavigate();
  // The run's story is the "what happened" column, shared with the canvas's cache.
  const story = useQuery({ queryKey: ['run', run.id], queryFn: () => getRun(run.id) }).data?.story;
  const line = story?.length ? story[story.length - 1]! : runDisplayName(run.triggerPayload);
  return (
    <tr
      data-explain={dataExplainValue({ kind: 'run', id: run.id }, `${name} run`)}
      className="cursor-pointer border-b border-border hover:bg-accent"
      onClick={() => navigate(runPath(run))}
    >
      <td className="p-2.5 whitespace-nowrap text-muted-foreground" title={formatDateTime(run.startedAt)}>
        {formatRunListTime(run.startedAt)}
      </td>
      <td className="max-w-[16rem] truncate p-2.5 font-semibold">
        <Link to={runPath(run)} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          {name}
        </Link>
      </td>
      <td className="max-w-[32rem] truncate p-2.5" title={line}>
        {line}
      </td>
      <td className="p-2.5">
        <StatusBadge status={run.status} />
      </td>
    </tr>
  );
}

/**
 * Activity: every run as one filterable table on the board. A row opens its
 * automation with that run laid over the canvas.
 */
export default function ActivityPage() {
  const workflows = useWorkflows();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });
  const [status, setStatus] = useState('');
  const [automation, setAutomation] = useState('');

  const names = useMemo(
    () => new Map((workflows.data ?? []).map((w) => [w.id, w.name])),
    [workflows.data],
  );
  const rows = useMemo(
    () =>
      [...(runs.data ?? [])]
        .filter((r) => (status === '' || r.status === status) && (automation === '' || r.workflowId === automation))
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    [runs.data, status, automation],
  );

  if (workflows.isPending || runs.isPending) return <p>Loading activity…</p>;
  if (workflows.isError || runs.isError || !workflows.data || !runs.data) {
    return <p role="alert">Couldn&apos;t load the activity. Try again.</p>;
  }
  const selectClass = 'rounded-[var(--radius-s)] border border-border bg-card px-2 py-1.5 text-sm';
  return (
    <section className="panel mx-auto max-w-6xl" aria-label="Activity">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">
          Activity <span className="text-muted-foreground">· {rows.length}</span>
        </h1>
        <select aria-label="Filter by status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by automation"
          className={selectClass}
          value={automation}
          onChange={(e) => setAutomation(e.target.value)}
        >
          <option value="">All automations</option>
          {workflows.data.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      {runs.data.length === 0 ? (
        <p className="empty-state">
          Nothing has happened yet. Describe a chore in{' '}
          <Link to="/automate" className="text-primary underline-offset-4 hover:underline">
            Automate
          </Link>{' '}
          and your runs will land here.
        </p>
      ) : rows.length === 0 ? (
        <p className="empty-state">No runs match these filters.</p>
      ) : (
        <table className="w-full text-left text-base">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="p-2.5 font-semibold">When</th>
              <th className="p-2.5 font-semibold">Automation</th>
              <th className="p-2.5 font-semibold">What happened</th>
              <th className="p-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <ActivityRow key={run.id} run={run} name={names.get(run.workflowId) ?? 'Deleted automation'} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

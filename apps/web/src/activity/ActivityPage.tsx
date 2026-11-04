import { useQueries, useQuery } from '@tanstack/react-query';
import type { Run } from '@onesaas/shared';
import Pause from 'lucide-react/icons/pause';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getRun, getRuns, useWorkflows } from '../api.ts';
import { buttonVariants } from '../components/ui/button.tsx';
import StatusBadge from '../design/StatusBadge.tsx';
import { STATUS_LABEL } from '../design/statusLabels.ts';
import { dataExplainValue } from '../explain/useAltClickExplain.ts';
import { formatDateTime, formatRunListTime, plainLine, runDisplayName } from '../runtime/format.ts';
import { runPath } from '../runtime/params.ts';

type Show = 'all' | 'needs' | 'done';
const SHOW: { value: Show; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'needs', label: 'Needs you' },
  { value: 'done', label: 'Done' },
];

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const inWords = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const needsYou = (run: Run): boolean => run.status === 'waiting' || run.status === 'failed';
const openPath = (run: Run): string => runPath(run.workflowId, run.id);

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

/** "Today your automations did five things. Two need you." */
function summarise(runs: Run[]): string {
  const today = runs.filter((r) => isToday(r.startedAt)).length;
  const need = runs.filter(needsYou).length;
  const did =
    today === 0
      ? 'Your automations haven’t done anything yet today.'
      : `Today your automations did ${inWords(today)} ${today === 1 ? 'thing' : 'things'}.`;
  if (need === 0) return `${did} Nothing needs you.`;
  return `${did} ${capitalise(inWords(need))} ${need === 1 ? 'needs' : 'need'} you.`;
}

/** The last line of a run's story, shared with the canvas's cache. */
function useRunLine(run: Run): string {
  const story = useQuery({ queryKey: ['run', run.id], queryFn: () => getRun(run.id) }).data?.story;
  return story?.length ? plainLine(story[story.length - 1]!) : runDisplayName(run.triggerPayload);
}

function NeedsCard({ run, name }: { run: Run; name: string }) {
  const line = useRunLine(run);
  const waiting = run.status === 'waiting';
  return (
    <Link
      to={openPath(run)}
      data-status={run.status}
      data-explain={dataExplainValue({ kind: 'run', id: run.id }, `${name} run`)}
      className="needs-card no-underline"
    >
      <span className="status-dot" data-status={run.status} aria-hidden>
        {waiting ? <Pause size={14} fill="currentColor" /> : '!'}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className={`state text-[0.765rem] font-bold`} data-status={run.status}>
          {STATUS_LABEL[run.status]} · {formatRunListTime(run.startedAt).replace(/^Today /, '')}
        </span>
        <span className="text-[1.059rem] font-bold break-words">{name}</span>
        <span className="text-[0.882rem] leading-[1.45] break-words">{line}</span>
        <span
          className={`${buttonVariants({ variant: waiting ? 'brand' : 'outline', size: 'sm' })} mt-1 self-start`}
        >
          {waiting ? 'Check it' : 'See what happened'}
        </span>
      </span>
    </Link>
  );
}

function ActivityRow({ run, name }: { run: Run; name: string }) {
  const navigate = useNavigate();
  const line = useRunLine(run);
  return (
    <tr
      data-explain={dataExplainValue({ kind: 'run', id: run.id }, `${name} run`)}
      className="cursor-pointer border-b border-border last:border-b-0 hover:bg-accent"
      onClick={() => navigate(openPath(run))}
    >
      <td className="px-[22px] py-4 align-top text-[0.824rem] whitespace-nowrap text-muted-foreground" title={formatDateTime(run.startedAt)}>
        {formatRunListTime(run.startedAt)}
      </td>
      <td className="w-60 px-2 py-4 align-top text-[0.882rem] font-semibold">
        <Link to={openPath(run)} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          {name}
        </Link>
      </td>
      <td className="px-2 py-4 align-top text-[0.882rem] leading-[1.45] break-words">{line}</td>
      <td className="px-[22px] py-4 text-right align-top">
        <StatusBadge status={run.status} />
      </td>
    </tr>
  );
}

/**
 * Activity: a one-line summary, cards for the runs waiting on the owner, then
 * everything else as a table whose rows wrap. Any of them opens the automation
 * in Runs mode on that run.
 */
export default function ActivityPage() {
  const workflows = useWorkflows();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });
  const [show, setShow] = useState<Show>('all');
  const [automation, setAutomation] = useState('');

  const names = useMemo(
    () => new Map((workflows.data ?? []).map((w) => [w.id, w.name])),
    [workflows.data],
  );
  const matching = useMemo(
    () =>
      [...(runs.data ?? [])]
        .filter((r) => automation === '' || r.workflowId === automation)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    [runs.data, automation],
  );
  // Cheap for owner-scale lists, and rows and cards then read from the cache.
  useQueries({
    queries: matching.map((r) => ({ queryKey: ['run', r.id], queryFn: () => getRun(r.id) })),
  });

  if (workflows.isPending || runs.isPending) return <p>Loading activity…</p>;
  if (workflows.isError || runs.isError || !workflows.data || !runs.data) {
    return <p role="alert">Couldn&apos;t load the activity. Try again.</p>;
  }

  const nameOf = (run: Run): string => names.get(run.workflowId) ?? 'Deleted automation';
  const cards = show === 'done' ? [] : matching.filter(needsYou);
  const rows = show === 'needs' ? [] : matching.filter((r) => !needsYou(r) && (show === 'all' || r.status === 'done'));

  return (
    <section className="mx-auto flex max-w-[1160px] flex-col gap-[18px] pt-3" aria-label="Activity">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">
            Activity <span className="count">· {cards.length + rows.length}</span>
          </h1>
          <p className="mt-1.5 mb-0 text-[0.941rem] text-muted-foreground">{summarise(runs.data)}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="seg" role="group" aria-label="Show">
            {SHOW.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={show === s.value}
                className={show === s.value ? 'on' : ''}
                onClick={() => setShow(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Filter by automation"
            className="rounded-full! px-3 py-1.5 text-[0.824rem]"
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
      </div>

      {runs.data.length === 0 ? (
        <p className="empty-state">
          Nothing has happened yet. Describe a chore in{' '}
          <Link to="/automate" className="text-primary underline-offset-4 hover:underline">
            Automate
          </Link>{' '}
          and your runs will land here.
        </p>
      ) : cards.length + rows.length === 0 ? (
        <p className="empty-state">
          {show === 'needs' ? (
            <>
              Nothing needs you right now. You&apos;re all caught up.
            </>
          ) : (
            'No runs match these filters.'
          )}
        </p>
      ) : (
        <>
          {cards.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {cards.map((run) => (
                <NeedsCard key={run.id} run={run} name={nameOf(run)} />
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border bg-background text-[0.765rem] text-muted-foreground">
                    <th className="px-[22px] py-3 font-bold">When</th>
                    <th className="px-2 py-3 font-bold">Automation</th>
                    <th className="px-2 py-3 font-bold">What happened</th>
                    <th className="px-[22px] py-3 text-right font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((run) => (
                    <ActivityRow key={run.id} run={run} name={nameOf(run)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

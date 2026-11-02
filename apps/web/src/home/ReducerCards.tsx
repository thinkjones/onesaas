import type { Run, Workflow } from '@dad/shared';
import BotIcon from 'lucide-react/icons/bot';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiError, getRuns, useWorkflows, useWorkflowOp } from '../api.ts';
import { Switch } from '../components/ui/switch.tsx';
import CardHeading from '../design/CardHeading.tsx';
import Pill from '../design/Pill.tsx';
import { formatDateTime, formatRunListTime } from '../runtime/format.ts';

// "Your chore reducers" (M5 Task 6): one row per workflow with a working
// on/off switch (the setStatus op, like DesignView's Turn on), the last run,
// and an amber "N waiting for you" pill linking to the OLDEST waiting run
// (the one waiting longest — earliest startedAt — gets Dad first).

function oldestWaitingFirst(a: Run, b: Run): number {
  return a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0;
}

/** Surfaces the parsed server message; network failures get a plain-words fallback. Mirrors DesignView's: a component file may only export components, so the helper is local here too. */
function toastOpError(error: unknown): void {
  toast.error(
    error instanceof ApiError && error.message
      ? error.message
      : "Couldn't reach the server. Try again.",
  );
}

function ReducerRow({ workflow, runs }: { workflow: Workflow; runs: Run[] }) {
  const op = useWorkflowOp(workflow.id);
  const mine = runs.filter((r) => r.workflowId === workflow.id);
  const waiting = mine.filter((r) => r.status === 'waiting').sort(oldestWaitingFirst);
  const lastRun = mine.reduce<string | undefined>(
    (latest, r) => (latest === undefined || r.startedAt > latest ? r.startedAt : latest),
    undefined,
  );

  return (
    <div className="row cursor-default">
      <span className="body">
        <Link
          to={`/reducers/${workflow.id}`}
          className="t block truncate text-primary underline-offset-4 hover:underline"
        >
          {workflow.name}
        </Link>
        <span className="dim block">
          Last run:{' '}
          {lastRun === undefined ? (
            'never'
          ) : (
            <span title={formatDateTime(lastRun)}>{formatRunListTime(lastRun)}</span>
          )}
        </span>
      </span>
      {waiting.length > 0 && (
        <Link to={`/reducers/${workflow.id}?run=${waiting[0]!.id}`}>
          <Pill tone="waiting">
            {waiting.length} waiting for you
          </Pill>
        </Link>
      )}
      <span className="flex items-center gap-2">
        <Switch
          checked={workflow.status === 'on'}
          disabled={op.isPending}
          aria-label={`${workflow.name} enabled`}
          onCheckedChange={(on) => {
            op.mutate(
              { op: 'setStatus', args: [on ? 'on' : 'off'] },
              {
                onSuccess: (res) => {
                  if (!res.ok) toast.error(res.error);
                },
                onError: (err) => toastOpError(err),
              },
            );
          }}
        />
        <span className="dim w-7">{workflow.status === 'on' ? 'On' : 'Off'}</span>
      </span>
    </div>
  );
}

export default function ReducerCards() {
  const workflows = useWorkflows();
  // One unfiltered list for every card (not N+1 per-card queries): the cards
  // split it by workflowId client-side.
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });

  if (workflows.isPending || runs.isPending) return <p>Loading your chore reducers…</p>;
  if (workflows.isError || runs.isError || !workflows.data || !runs.data) {
    return <p role="alert">Couldn&apos;t load your chore reducers. Try again.</p>;
  }
  return (
    <section className="panel" aria-label="Your chore reducers">
      <CardHeading icon={BotIcon} title="Your chore reducers" count={workflows.data.length} />
      {workflows.data.length === 0 ? (
        <p className="empty-state">
          Nothing here yet — describe a chore above and I&apos;ll build your first one.
        </p>
      ) : (
        <div className="flex flex-col">
          {workflows.data.map((w) => (
            <ReducerRow key={w.id} workflow={w} runs={runs.data} />
          ))}
        </div>
      )}
    </section>
  );
}

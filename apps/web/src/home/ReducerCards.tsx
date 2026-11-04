import type { Run, Workflow } from '@dad/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiError, getRuns, useWorkflowOp, useWorkflows } from '../api.ts';
import { Switch } from '../components/ui/switch.tsx';
import Pill from '../design/Pill.tsx';
import { formatDateTime, formatRunListTime } from '../runtime/format.ts';

function oldestWaitingFirst(a: Run, b: Run): number {
  return a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0;
}

/** Surfaces the parsed server message; network failures get a plain-words fallback. */
function toastOpError(error: unknown): void {
  toast.error(
    error instanceof ApiError && error.message
      ? error.message
      : "Couldn't reach the server. Try again.",
  );
}

function AutomationCard({ workflow, runs }: { workflow: Workflow; runs: Run[] }) {
  const op = useWorkflowOp(workflow.id);
  const mine = runs.filter((r) => r.workflowId === workflow.id);
  const waiting = mine.filter((r) => r.status === 'waiting').sort(oldestWaitingFirst);
  const lastRun = mine.reduce<string | undefined>(
    (latest, r) => (latest === undefined || r.startedAt > latest ? r.startedAt : latest),
    undefined,
  );
  return (
    <div className="panel flex min-h-[8.5rem] flex-col gap-2">
      <Link
        to={`/reducers/${workflow.id}?mode=design`}
        className="truncate text-base font-semibold text-primary underline-offset-4 hover:underline"
      >
        {workflow.name}
      </Link>
      <p className="text-sm text-muted-foreground">
        {workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'} · Last run:{' '}
        {lastRun === undefined ? (
          'never'
        ) : (
          <span title={formatDateTime(lastRun)}>{formatRunListTime(lastRun)}</span>
        )}
      </p>
      {waiting.length > 0 && (
        <Link to={`/reducers/${workflow.id}?mode=design&run=${waiting[0]!.id}`} className="w-fit">
          <Pill tone="waiting">{waiting.length} waiting for you</Pill>
        </Link>
      )}
      <span className="mt-auto flex items-center gap-2">
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
        <span className="text-sm text-muted-foreground">
          {workflow.status === 'on' ? 'Published' : 'Not published'}
        </span>
      </span>
    </div>
  );
}

/** Every automation as a card on the board; a card opens its canvas. */
export default function ReducerCards() {
  const workflows = useWorkflows();
  // One unfiltered list for every card; they split it by workflowId.
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });

  if (workflows.isPending || runs.isPending) return <p>Loading your automations…</p>;
  if (workflows.isError || runs.isError || !workflows.data || !runs.data) {
    return <p role="alert">Couldn&apos;t load your automations. Try again.</p>;
  }
  return (
    <section
      aria-label="Your automations"
      className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4"
    >
      {workflows.data.map((w) => (
        <AutomationCard key={w.id} workflow={w} runs={runs.data} />
      ))}
    </section>
  );
}

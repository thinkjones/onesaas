import type { Run, Workflow } from '@dad/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiError, getRuns, useWorkflows, useWorkflowOp } from '../api.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { formatRunListTime } from '../runtime/format.ts';

// "Your chore reducers" (M5 Task 6): one card per workflow with a working
// on/off switch (the setStatus op, like DesignView's Turn on), the last run,
// and an amber "N waiting for you" badge linking to the OLDEST waiting run
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

function ReducerCard({ workflow, runs }: { workflow: Workflow; runs: Run[] }) {
  const op = useWorkflowOp(workflow.id);
  const mine = runs.filter((r) => r.workflowId === workflow.id);
  const waiting = mine.filter((r) => r.status === 'waiting').sort(oldestWaitingFirst);
  const lastRun = mine.reduce<string | undefined>(
    (latest, r) => (latest === undefined || r.startedAt > latest ? r.startedAt : latest),
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{workflow.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
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
          <span>{workflow.status === 'on' ? 'On' : 'Off'}</span>
        </div>
        <p>Last run: {lastRun === undefined ? 'never' : formatRunListTime(lastRun)}</p>
        {waiting.length > 0 && (
          <Link to={`/reducers/${workflow.id}?run=${waiting[0]!.id}`}>
            <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-900">
              {waiting.length} waiting for you
            </Badge>
          </Link>
        )}
      </CardContent>
    </Card>
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
    <section aria-label="Your chore reducers" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Your chore reducers</h2>
      {workflows.data.length === 0 ? (
        <p>Nothing here yet — describe a chore above and I&apos;ll build your first one.</p>
      ) : (
        <div className="grid gap-4">
          {workflows.data.map((w) => (
            <ReducerCard key={w.id} workflow={w} runs={runs.data} />
          ))}
        </div>
      )}
    </section>
  );
}

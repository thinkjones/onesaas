import type { Workflow } from '@dad/shared';
import { useRuns, useWorkflows } from '../api.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Switch } from '../components/ui/switch.tsx';

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  // N+1 scaffold: one GET /api/runs?workflowId= per card. Acceptable until a
  // summary endpoint exists; runs lists are small in M2.
  const { data: runs } = useRuns(workflow.id);
  const waiting = runs?.filter((r) => r.status === 'waiting').length ?? 0;
  // Last run time from startedAt (endedAt is meaningless on live runs).
  const lastRun = runs?.reduce<string | undefined>(
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
          <Switch checked={workflow.status === 'on'} aria-label={`${workflow.name} enabled`} />
          <span>{workflow.status === 'on' ? 'On' : 'Off'}</span>
        </div>
        <p>Last run: {lastRun ?? 'never'}</p>
        {waiting > 0 && <Badge variant="secondary">{waiting} waiting</Badge>}
      </CardContent>
    </Card>
  );
}

export default function ChoreReducersPage() {
  const { data: workflows, isPending, error } = useWorkflows();

  if (isPending) return <p>Loading chore reducers…</p>;
  if (error) return <p>Couldn&apos;t load chore reducers.</p>;
  return (
    <div>
      <h1>Chore reducers</h1>
      <div className="grid gap-4">
        {workflows.map((w) => (
          <WorkflowCard key={w.id} workflow={w} />
        ))}
      </div>
    </div>
  );
}

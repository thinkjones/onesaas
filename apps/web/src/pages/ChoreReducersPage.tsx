import type { Workflow } from '@dad/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateWorkflow, useRuns, useWorkflows } from '../api.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Switch } from '../components/ui/switch.tsx';
import AppButton from '../design/AppButton.tsx';

/**
 * A blank reducer starts untitled with no description; Dad (or the agent,
 * via `rename_workflow`) names it once the plan exists. The panel opens empty
 * — unlike HomePage's one-sentence start, there is no opening send.
 */
export const UNTITLED_CHORE_REDUCER = 'Untitled chore reducer';

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
        <CardTitle>
          <Link
            to={`/reducers/${workflow.id}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {workflow.name}
          </Link>
        </CardTitle>
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
  const create = useCreateWorkflow();
  const navigate = useNavigate();
  const [createError, setCreateError] = useState(false);

  const handleNew = (): void => {
    setCreateError(false);
    create.mutate(
      { name: UNTITLED_CHORE_REDUCER, description: '' },
      {
        onSuccess: (wf) => navigate(`/reducers/${wf.id}?mode=design`),
        onError: () => setCreateError(true),
      },
    );
  };

  if (isPending) return <p>Loading chore reducers…</p>;
  if (error) return <p>Couldn&apos;t load chore reducers.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-3">
        <AppButton onClick={handleNew} disabled={create.isPending}>
          <Plus />
          {create.isPending ? 'Creating…' : 'New chore reducer'}
        </AppButton>
      </div>
      {createError && (
        <p role="alert" className="text-base text-destructive">
          Couldn&apos;t create a chore reducer. Try again.
        </p>
      )}
      <div className="grid gap-4">
        {workflows.map((w) => (
          <WorkflowCard key={w.id} workflow={w} />
        ))}
      </div>
    </div>
  );
}

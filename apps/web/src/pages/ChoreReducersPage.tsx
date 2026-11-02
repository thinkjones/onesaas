import type { Workflow } from '@dad/shared';
import BotIcon from 'lucide-react/icons/bot';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateWorkflow, useRuns, useWorkflows } from '../api.ts';
import { Switch } from '../components/ui/switch.tsx';
import AppButton from '../design/AppButton.tsx';
import CardHeading from '../design/CardHeading.tsx';
import Pill from '../design/Pill.tsx';

/**
 * A blank reducer starts untitled with no description; Dad (or the agent,
 * via `rename_workflow`) names it once the plan exists. The panel opens empty
 * — unlike HomePage's one-sentence start, there is no opening send.
 */
export const UNTITLED_CHORE_REDUCER = 'Untitled chore reducer';

function WorkflowRow({ workflow }: { workflow: Workflow }) {
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
    <div className="row cursor-default">
      <span className="body">
        <Link
          to={`/reducers/${workflow.id}`}
          className="t block truncate text-primary underline-offset-4 hover:underline"
        >
          {workflow.name}
        </Link>
        <span className="dim block">Last run: {lastRun ?? 'never'}</span>
      </span>
      {waiting > 0 && <Pill tone="waiting">{waiting} waiting</Pill>}
      <span className="flex items-center gap-2">
        <Switch checked={workflow.status === 'on'} aria-label={`${workflow.name} enabled`} />
        <span className="dim w-7">{workflow.status === 'on' ? 'On' : 'Off'}</span>
      </span>
    </div>
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
      <section className="panel" aria-label="Chore reducers">
        <CardHeading icon={BotIcon} title="Chore reducers" count={workflows.length} />
        {workflows.length === 0 ? (
          <p className="empty-state">No chore reducers yet — create one above.</p>
        ) : (
          <div className="flex flex-col">
            {workflows.map((w) => (
              <WorkflowRow key={w.id} workflow={w} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

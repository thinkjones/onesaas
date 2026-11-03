import BotIcon from 'lucide-react/icons/bot';
import { useParams } from 'react-router';
import ActivityTimeline from '../activity/ActivityTimeline.tsx';
import { useRuns, useWorkflows } from '../api.ts';
import CardHeading from '../design/CardHeading.tsx';

/**
 * List review: the Activity timeline filtered to one chore reducer. Reached
 * by clicking a reducer on the Automate screen; rows open Watch-it-Run mode
 * exactly like Activity rows do.
 */
export default function ReducerRunsPage() {
  const { workflowId = '' } = useParams();
  const workflows = useWorkflows();
  const runs = useRuns(workflowId);

  if (workflows.isPending || runs.isPending) return <p>Loading runs…</p>;
  if (workflows.isError || runs.isError || !workflows.data || !runs.data) {
    return <p role="alert">Couldn&apos;t load the runs. Try again.</p>;
  }
  const name = workflows.data.find((w) => w.id === workflowId)?.name ?? 'Chore reducer';
  return (
    <section className="panel" aria-label={`${name} runs`}>
      <CardHeading icon={BotIcon} title={`${name} runs`} count={runs.data.length} />
      {runs.data.length === 0 ? (
        <p className="empty-state">No runs yet.</p>
      ) : (
        <ActivityTimeline
          runs={runs.data}
          names={new Map([[workflowId, name]])}
          hideReducerName
        />
      )}
    </section>
  );
}

import ActivityIcon from 'lucide-react/icons/activity';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getRuns, useWorkflows } from '../api.ts';
import CardHeading from '../design/CardHeading.tsx';
import ActivityTimeline from './ActivityTimeline.tsx';

/**
 * Activity (was Inbox): everything the chore reducers have done as a
 * timeline — Today / This week / Past groups, one Gmail-like row per run:
 * when it ran, which reducer ran, one line about what happened, and its
 * status. Rows open Watch-it-Run mode; the pencil opens design mode.
 */
export default function ActivityPage() {
  const workflows = useWorkflows();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });

  if (workflows.isPending || runs.isPending) return <p>Loading activity…</p>;
  if (workflows.isError || runs.isError || !workflows.data || !runs.data) {
    return <p role="alert">Couldn&apos;t load the activity. Try again.</p>;
  }
  const names = new Map(workflows.data.map((w) => [w.id, w.name]));
  return (
    <section className="panel" aria-label="Activity">
      <CardHeading icon={ActivityIcon} title="Activity" count={runs.data.length} />
      {runs.data.length === 0 ? (
        <p className="empty-state">
          Nothing has happened yet — describe a chore in{' '}
          <Link to="/automate" className="text-primary underline-offset-4 hover:underline">
            Automate
          </Link>{' '}
          and your runs will land here.
        </p>
      ) : (
        <ActivityTimeline runs={runs.data} names={names} />
      )}
    </section>
  );
}

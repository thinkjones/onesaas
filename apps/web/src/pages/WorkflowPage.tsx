import { useParams, useSearchParams } from 'react-router';

// Placeholder until Task 5 builds the runtime screen: it just echoes the
// route params (?mode=design|runtime&run=:runId&step=:stepId) so deep links
// are verifiable now.
export default function WorkflowPage() {
  const { workflowId } = useParams();
  const [params] = useSearchParams();
  return (
    <div>
      <h1>Workflow {workflowId}</h1>
      <p>
        Mode: {params.get('mode') ?? '—'} · Run: {params.get('run') ?? '—'} · Step:{' '}
        {params.get('step') ?? '—'}
      </p>
    </div>
  );
}

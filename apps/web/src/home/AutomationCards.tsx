import type { Run, StepRunStatus, Workflow } from '@onesaas/shared';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiError, useWorkflowOp } from '../api.ts';
import { Switch } from '../components/ui/switch.tsx';
import StatusBadge from '../design/StatusBadge.tsx';
import { formatDateTime, formatRunListTime } from '../runtime/format.ts';
import { runPath } from '../runtime/params.ts';
import FlowPreview from './FlowPreview.tsx';
import { flowStepsOf } from './flowSteps.ts';
import { needsYouRank, runToShow } from './needsYou.ts';

/** Surfaces the parsed server message; network failures get a plain-words fallback. */
function toastOpError(error: unknown): void {
  toast.error(
    error instanceof ApiError && error.message
      ? error.message
      : "Couldn't reach the server. Try again.",
  );
}

function latestRunAt(workflowId: string, runs: Run[]): string | undefined {
  return runs
    .filter((r) => r.workflowId === workflowId)
    .reduce<string | undefined>((latest, r) => (latest === undefined || r.startedAt > latest ? r.startedAt : latest), undefined);
}

function AutomationCard({ workflow, runs }: { workflow: Workflow; runs: Run[] }) {
  const op = useWorkflowOp(workflow.id);
  const run = runToShow(workflow.id, runs);
  const lastRunAt = latestRunAt(workflow.id, runs);
  const published = workflow.status === 'on';
  const status: StepRunStatus = run?.status ?? 'pending';
  const needsYou = status === 'waiting' || status === 'failed';
  const steps = workflow.steps.length;
  const badge = <StatusBadge status={status} />;
  return (
    <article className="automation-card" data-needs={needsYou ? status : undefined}>
      <FlowPreview steps={flowStepsOf(workflow)} size="card" />
      <div className="automation-card-text">
        <h3 className="automation-card-title">
          {/* Stretched over the whole card; the footer sits above it. */}
          <Link to={`/automations/${workflow.id}?mode=design`}>{workflow.name}</Link>
        </h3>
        <p className="setup-hint">
          {lastRunAt === undefined ? (
            'Not run yet'
          ) : (
            <span title={formatDateTime(lastRunAt)}>{formatRunListTime(lastRunAt)}</span>
          )}
          {` · ${steps} step${steps === 1 ? '' : 's'}`}
        </p>
      </div>
      <div className="automation-card-footer">
        {needsYou && run ? <Link to={runPath(workflow.id, run.id)}>{badge}</Link> : badge}
        <label className="automation-card-switch">
          <Switch
            checked={published}
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
          {published ? 'Published' : 'Off'}
        </label>
      </div>
    </article>
  );
}

/** Every automation as a card; the ones that need you come first. */
export default function AutomationCards({ workflows, runs }: { workflows: Workflow[]; runs: Run[] }) {
  const sorted = [...workflows].sort(
    (a, b) => needsYouRank(runToShow(a.id, runs)?.status) - needsYouRank(runToShow(b.id, runs)?.status),
  );
  return (
    <section aria-label="Your automations" className="automation-grid">
      {sorted.map((w) => (
        <AutomationCard key={w.id} workflow={w} runs={runs} />
      ))}
    </section>
  );
}

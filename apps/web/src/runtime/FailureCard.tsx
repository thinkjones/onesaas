import { toast } from 'sonner';
import { ApiError, useRetry } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import AppCard from '../design/AppCard.tsx';

export interface FailureCardProps {
  runId: string;
  stepId: string;
  /** The step's plain-words error (stepRun.error). */
  error: string;
  /**
   * Opens design mode on this step with its settings and a pre-filled agent
   * prompt (wired by RuntimeView). Absent only outside the workflow screen,
   * where the button stays disabled with its "Coming soon" tooltip.
   */
  onFixStep?: () => void;
}

/**
 * The card under a `failed` node: the error in plain words, "Try again", and
 * "Fix this step". "Try again" disables while the retry is in flight (same
 * double-submit guard as ApprovalCard). "Fix this step" opens design mode on
 * the failed step (?mode=design&step=<id>) with the agent input pre-filled.
 */
/** Surfaces the parsed server message; network failures get a plain-words fallback. */
function toastMutationError(error: Error): void {
  toast.error(
    error instanceof ApiError && error.message
      ? error.message
      : "Couldn't reach the server. Try again.",
  );
}

export default function FailureCard({ runId, stepId, error, onFixStep }: FailureCardProps) {
  const retry = useRetry(runId, stepId);
  const onError = toastMutationError;

  return (
    <AppCard className="w-full p-4">
      <p role="alert" className="text-base">
        {error}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <AppButton
          disabled={retry.isPending}
          onClick={() => retry.mutate(undefined, { onError })}
        >
          Try again
        </AppButton>
        <AppButton
          variant="outline"
          disabled={onFixStep === undefined}
          title={onFixStep === undefined ? 'Coming soon' : undefined}
          // The card lives INSIDE its canvas node: without this the click
          // also fires the canvas onNodeClick, whose setParams overwrites
          // the mode change below (same-tick functional updates share one
          // stale base, last write wins) and Dad lands on the inspector
          // instead of design mode.
          onClick={(e) => {
            e.stopPropagation();
            onFixStep?.();
          }}
        >
          Fix this step
        </AppButton>
      </div>
    </AppCard>
  );
}

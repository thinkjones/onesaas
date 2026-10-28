import { toast } from 'sonner';
import { ApiError, useRetry } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import AppCard from '../design/AppCard.tsx';

export interface FailureCardProps {
  runId: string;
  stepId: string;
  /** The step's plain-words error (stepRun.error). */
  error: string;
}

/**
 * The card under a `failed` node: the error in plain words, "Try again", and
 * "Fix this step". "Try again" disables while the retry is in flight (same
 * double-submit guard as ApprovalCard). "Fix this step" links to
 * ?mode=design&step=<id> once M3 wires the design branch — until then it is
 * disabled with a "Coming soon" tooltip.
 */
/** Surfaces the parsed server message; network failures get a plain-words fallback. */
function toastMutationError(error: Error): void {
  toast.error(
    error instanceof ApiError && error.message
      ? error.message
      : "Couldn't reach the server. Try again.",
  );
}

export default function FailureCard({ runId, stepId, error }: FailureCardProps) {
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
        <AppButton variant="outline" disabled title="Coming soon">
          Fix this step
        </AppButton>
      </div>
    </AppCard>
  );
}

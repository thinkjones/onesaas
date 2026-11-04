import { toast } from 'sonner';
import { ApiError, useRetry } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import { plainError } from './format.ts';

export interface FailureCardProps {
  runId: string;
  stepId: string;
  /** The step's plain-words error (stepRun.error). */
  error: string;
  /** What didn't happen, in one line. */
  context?: string;
  /** Opens Design on this step with a pre-filled chat message. */
  onFixStep?: () => void;
}

/** Surfaces the parsed server message; network failures get a plain-words fallback. */
function toastMutationError(error: Error): void {
  toast.error(
    error instanceof ApiError && error.message
      ? error.message
      : "Couldn't reach the server. Try again.",
  );
}

/** "I need Google Calendar open in Chrome…" becomes a step you can follow. */
function fixSteps(error: string): string[] {
  const missing = /^I need (.+) open in Chrome/.exec(error)?.[1];
  return [
    missing ? `Open ${missing} in a Chrome tab.` : 'Sort out what I said above.',
    "Come back here and press Try again. I'll pick up from this step.",
  ];
}

/** The body of a failed step: what stopped, what to do, and two ways forward. */
export default function FailureCard({ runId, stepId, error: rawError, context, onFixStep }: FailureCardProps) {
  const error = plainError(rawError);
  const retry = useRetry(runId, stepId);
  return (
    <>
      <h2 role="alert" className="question">
        {error}
      </h2>
      {context && <p className="context">{context}</p>}
      {fixSteps(error).map((line, i) => (
        <div key={line} className="fix-step">
          <b>{i + 1}</b>
          <span>{line}</span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2.5">
        <AppButton
          variant="brand"
          size="lg"
          disabled={retry.isPending}
          onClick={() => retry.mutate(undefined, { onError: toastMutationError })}
        >
          Try again from here
        </AppButton>
        <AppButton variant="soft" size="lg" disabled={onFixStep === undefined} onClick={onFixStep}>
          Fix this step
        </AppButton>
        <span className="ml-auto text-[0.765rem] text-muted-foreground">Fix this step opens Design</span>
      </div>
    </>
  );
}

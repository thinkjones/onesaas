import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, useApprove } from '../api.ts';
import { Textarea } from '../components/ui/textarea.tsx';
import AppButton from '../design/AppButton.tsx';

export interface ApprovalCardProps {
  runId: string;
  stepId: string;
  /** From the pinned workflow's step config (the engine stores only the proposal). */
  question: string;
  /** stepRun.output.proposed.text — the text awaiting approval. */
  proposedText: string;
  /** Who this run is about, when known: "To Priya Nair. Change anything…" */
  recipient?: string;
}

/** Surfaces the parsed server message; network failures get a plain-words fallback. */
function toastMutationError(error: Error): void {
  toast.error(
    error instanceof ApiError && error.message
      ? error.message
      : "Couldn't reach the server. Try again.",
  );
}

/**
 * The body of a waiting step: the question, the proposed text to edit, and
 * Looks good / Skip. "Looks good" sends whatever is in the box, so an edit
 * needs no second button.
 *
 * Bodies match the server's strict union EXACTLY ({action:'approve'} |
 * {action:'edit',text} | {action:'skip'}) — surplus keys 400. Empty (incl.
 * whitespace-only) disables Looks good, mirroring the server's 422; Skip stays
 * enabled as the escape hatch. Every button disables while the mutation is in
 * flight, so a double-click can't fire twice.
 */
export default function ApprovalCard({ runId, stepId, question, proposedText, recipient }: ApprovalCardProps) {
  const [text, setText] = useState(proposedText);
  const approve = useApprove(runId, stepId);
  const empty = text.trim().length === 0;
  const busy = approve.isPending;
  const onError = toastMutationError;
  const fieldId = `approval-${stepId}`;

  return (
    <>
      <h2 className="question">{question}</h2>
      <div className="grid grid-cols-[minmax(0,1fr)_13rem] items-stretch gap-[18px]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-[0.765rem] text-muted-foreground">
            {recipient ? `To ${recipient}. ` : ''}Change anything before it goes.
          </label>
          <Textarea
            id={fieldId}
            aria-label="Proposed reply"
            rows={7}
            className="min-h-40 flex-1 resize-none text-[0.882rem]"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {empty && (
            <p role="alert" className="text-[0.824rem] text-destructive">
              The reply is empty
            </p>
          )}
        </div>
        <div className="flex flex-col justify-end gap-2.5">
          <AppButton
            variant="brand"
            size="lg"
            disabled={empty || busy}
            onClick={() =>
              approve.mutate(
                text === proposedText ? { action: 'approve' } : { action: 'edit', text },
                { onError },
              )
            }
          >
            Looks good
          </AppButton>
          <AppButton
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={() => approve.mutate({ action: 'skip' }, { onError })}
          >
            Skip
          </AppButton>
          <span className="text-[0.765rem] leading-[1.4] text-muted-foreground">
            Nothing goes out until you say so.
          </span>
        </div>
      </div>
    </>
  );
}

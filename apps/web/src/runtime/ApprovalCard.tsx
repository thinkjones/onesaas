import { useState } from 'react';
import { useApprove } from '../api.ts';
import { Textarea } from '../components/ui/textarea.tsx';
import AppButton from '../design/AppButton.tsx';
import AppCard from '../design/AppCard.tsx';

export interface ApprovalCardProps {
  runId: string;
  stepId: string;
  /** From the pinned workflow's step config (the engine stores only the proposal). */
  question: string;
  /** stepRun.output.proposed.text — the text awaiting approval. */
  proposedText: string;
}

/**
 * The card under a `waiting` node: the approval question, the proposed text as
 * an editable textarea, and Looks good / Use my changes / Skip.
 *
 * Bodies match the server's strict union EXACTLY ({action:'approve'} |
 * {action:'edit',text} | {action:'skip'}) — surplus keys 400. Empty (incl.
 * whitespace-only) disables the approve buttons with "The reply is empty",
 * mirroring the server's 422; Skip stays enabled as the escape hatch for an
 * empty proposal. Every button disables while the mutation is in flight, so a
 * double-click can't fire twice (the server would reject the loser with a
 * confusing toast).
 *
 * Key={status} on the node remounts this card on a status flip, discarding an
 * in-flight textarea edit — accepted: only another client resolving mid-edit
 * triggers it, and a local approve/edit sends before the flip lands.
 */
export default function ApprovalCard({ runId, stepId, question, proposedText }: ApprovalCardProps) {
  const [text, setText] = useState(proposedText);
  const approve = useApprove(runId, stepId);
  const empty = text.trim().length === 0;
  const changed = text !== proposedText;
  const busy = approve.isPending;

  return (
    <AppCard className="w-full p-4">
      <p className="text-base font-medium">{question}</p>
      <Textarea
        aria-label="Proposed reply"
        className="mt-2"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {empty && (
        <p role="alert" className="mt-2 text-base text-destructive">
          The reply is empty
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <AppButton disabled={empty || busy} onClick={() => approve.mutate({ action: 'approve' })}>
          Looks good
        </AppButton>
        <AppButton
          variant="outline"
          disabled={empty || !changed || busy}
          onClick={() => approve.mutate({ action: 'edit', text })}
        >
          Use my changes
        </AppButton>
        <AppButton variant="ghost" disabled={busy} onClick={() => approve.mutate({ action: 'skip' })}>
          Skip
        </AppButton>
      </div>
    </AppCard>
  );
}

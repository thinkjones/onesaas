import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { workflowNameFromSentence } from '../agent/useAgent.ts';
import { useCreateWorkflow, useWorkflows } from '../api.ts';
import { Textarea } from '../components/ui/textarea.tsx';
import AppButton from '../design/AppButton.tsx';
import MicButton from '../voice/MicButton.tsx';
import ReducerCards from '../home/ReducerCards.tsx';
import Suggestions from '../home/Suggestions.tsx';

// Home (M5 Task 6): the centred Nunito prompt, a 72 px mic, a wide text box
// and four suggestion cards. Submitting text — or a spoken sentence — creates
// a workflow and navigates to it in design mode with the message sent (the
// M3 flow: the opening send happens on the workflow page via location state,
// so the panel's optimistic row keeps Dad's first message in the transcript).
// Bug #7: with no chores yet this is the first-time landing — the pure
// prompt, centred, with no reducer cards (the sidebar hides too, in
// AppShell); the cards appear under the prompt once a chore exists.

export const HOME_PROMPT = 'What do you want to achieve today?';

export default function HomePage() {
  const create = useCreateWorkflow();
  const workflowsQuery = useWorkflows();
  const navigate = useNavigate();
  const location = useLocation();
  // TellMeMoreFallback's last resort: with no reducers yet there is no
  // helper panel to send to, so "Tell me more" lands here with the message
  // already in the box — Dad presses Build it to create one and send it.
  // Box text (not an auto-send), so the state needs no consuming. Applied
  // via the previous-render pattern (not an initializer): a same-path
  // re-navigation — already Home when it fires — re-renders without
  // remounting, and the prefill must land then too. A prefill lands only on a
  // CHANGED value into an untouched box (empty, or still showing the previous
  // prefill): neither re-renders nor a new prefill arriving mid-sentence
  // clobbers Dad's typing.
  const [sentence, setSentence] = useState('');
  const [appliedPrefill, setAppliedPrefill] = useState<string | undefined>(undefined);
  const locationState = location.state as { homePrefill?: unknown } | null;
  const homePrefill =
    typeof locationState?.homePrefill === 'string' ? locationState.homePrefill : undefined;
  if (homePrefill !== appliedPrefill) {
    setAppliedPrefill(homePrefill);
    if (
      homePrefill !== undefined &&
      (sentence === '' || sentence === appliedPrefill)
    ) {
      setSentence(homePrefill);
    }
  }
  const [error, setError] = useState<string | null>(null);

  const handleStart = (raw: string): void => {
    const text = raw.trim();
    if (text.length === 0) {
      setError('Tell me what you want to achieve first.');
      return;
    }
    setError(null);
    create.mutate(
      { name: workflowNameFromSentence(text), description: text },
      {
        onSuccess: (wf) => navigate(`/reducers/${wf.id}?mode=design`, { state: { agentPrompt: text } }),
        onError: () => setError("Couldn't create a chore reducer. Try again."),
      },
    );
  };

  if (workflowsQuery.isPending) {
    return <p className="text-base text-muted-foreground">Loading…</p>;
  }
  // A failed list degrades to the prompt-only view (the prefill box must
  // still work when the reducers list can't load).
  const firstTime = (workflowsQuery.data?.length ?? 0) === 0;

  return (
    <div
      className={
        firstTime
          ? 'mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center gap-8'
          : 'mx-auto flex max-w-3xl flex-col gap-8'
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-display text-[44px] leading-tight font-semibold text-balance">
          {HOME_PROMPT}
        </h1>
        <MicButton sizePx={72} onSend={(text) => handleStart(text)} />
        <Textarea
          aria-label={HOME_PROMPT}
          placeholder="For example: when a customer emails me, save them and draft a reply for me to check"
          rows={3}
          value={sentence}
          disabled={create.isPending}
          onChange={(e) => setSentence(e.target.value)}
          className="w-full text-left"
        />
        {error && (
          <p role="alert" className="text-base text-destructive">
            {error}
          </p>
        )}
        <AppButton onClick={() => handleStart(sentence)} disabled={create.isPending}>
          {create.isPending ? 'Starting…' : 'Build it'}
        </AppButton>
      </div>
      <Suggestions
        onPick={(s) => {
          setSentence(s);
          setError(null);
        }}
      />
      {!firstTime && <ReducerCards />}
    </div>
  );
}

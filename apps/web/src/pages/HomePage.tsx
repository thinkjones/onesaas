import { useState } from 'react';
import { useNavigate } from 'react-router';
import { workflowNameFromSentence } from '../agent/useAgent.ts';
import { useCreateWorkflow } from '../api.ts';
import { Textarea } from '../components/ui/textarea.tsx';
import AppButton from '../design/AppButton.tsx';
import MicButton from '../voice/MicButton.tsx';
import AtAGlance from '../home/AtAGlance.tsx';
import ReducerCards from '../home/ReducerCards.tsx';
import Suggestions from '../home/Suggestions.tsx';

// Home (M5 Task 6): the centred Nunito prompt, a 72 px mic, a wide text box
// and four suggestion cards. Submitting text — or a spoken sentence — creates
// a workflow and navigates to it in design mode with the message sent (the
// M3 flow: the opening send happens on the workflow page via location state,
// so the panel's optimistic row keeps Dad's first message in the transcript).

export const HOME_PROMPT = 'What do you want to achieve today?';

export default function HomePage() {
  const create = useCreateWorkflow();
  const navigate = useNavigate();
  const [sentence, setSentence] = useState('');
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
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
      <ReducerCards />
      <AtAGlance />
    </div>
  );
}

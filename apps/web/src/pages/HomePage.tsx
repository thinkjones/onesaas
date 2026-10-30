import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { workflowNameFromSentence } from '../agent/useAgent.ts';
import { useCreateWorkflow } from '../api.ts';
import { Textarea } from '../components/ui/textarea.tsx';
import AppButton from '../design/AppButton.tsx';

export default function HomePage() {
  const create = useCreateWorkflow();
  const navigate = useNavigate();
  const [sentence, setSentence] = useState('');
  const [error, setError] = useState<string | null>(null);

  // TEMPORARY (M5 replaces this page): one sentence → a named reducer whose
  // panel opens with the sentence already sent. The opening send happens on
  // the workflow page (via location state), not here, so the panel's
  // optimistic row keeps Dad's first message in the transcript.
  const handleStart = (): void => {
    const text = sentence.trim();
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
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Home</h1>
      <p>Your day at a glance — coming in a later milestone.</p>
      <section aria-label="Start something new" className="flex max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">What do you want to achieve today?</h2>
        <Textarea
          aria-label="What do you want to achieve today?"
          placeholder="For example: when a customer emails me, save them and draft a reply for me to check"
          rows={3}
          value={sentence}
          disabled={create.isPending}
          onChange={(e) => setSentence(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-base text-destructive">
            {error}
          </p>
        )}
        <AppButton className="self-start" onClick={handleStart} disabled={create.isPending}>
          {create.isPending ? 'Starting…' : 'Build it'}
        </AppButton>
      </section>
      <p>
        New here? <Link to="/settings">Connect Gmail in Settings</Link> so the agent
        can watch your inbox.
      </p>
    </div>
  );
}

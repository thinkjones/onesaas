import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import Plus from 'lucide-react/icons/plus';
import X from 'lucide-react/icons/x';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { workflowNameFromSentence } from '../agent/useAgent.ts';
import { getRuns, useCreateWorkflow, useWorkflows } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import AutomationCards from '../home/AutomationCards.tsx';
import { automationsSummary } from '../home/needsYou.ts';
import SetupBox from '../home/SetupBox.tsx';

const OPEN_TRANSITION = { duration: 0.18, ease: [0.4, 0, 0.2, 1] } as const;

// Automate: with no automations, the setup box alone. With some, a header and
// the cards, and Add new opens the box in place above them.
export default function HomePage() {
  const create = useCreateWorkflow();
  const workflowsQuery = useWorkflows();
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: () => getRuns() });
  const navigate = useNavigate();
  const location = useLocation();
  const [adding, setAdding] = useState(false);
  const [boxSettled, setBoxSettled] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  // TellMeMoreFallback's last resort lands here with a message for the box
  // (not an auto-send). Applied via the previous-render pattern: a same-path
  // re-navigation re-renders without remounting, and the prefill must land
  // then too. It only lands on a CHANGED value into an untouched box, so it
  // never clobbers Dad's typing.
  const [sentence, setSentence] = useState('');
  const [appliedPrefill, setAppliedPrefill] = useState<string | undefined>(undefined);
  const locationState = location.state as { homePrefill?: unknown } | null;
  const homePrefill =
    typeof locationState?.homePrefill === 'string' ? locationState.homePrefill : undefined;
  if (homePrefill !== appliedPrefill) {
    setAppliedPrefill(homePrefill);
    if (homePrefill !== undefined && (sentence === '' || sentence === appliedPrefill)) {
      setSentence(homePrefill);
      setAdding(true);
    }
  }
  const [error, setError] = useState<string | null>(null);

  const closeBox = (): void => {
    setAdding(false);
    toggle.current?.focus();
  };

  useEffect(() => {
    if (!adding) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setAdding(false);
      toggle.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [adding]);

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
        onError: () => setError("Couldn't create an automation. Try again."),
      },
    );
  };

  if (workflowsQuery.isPending) {
    return <p className="text-base text-muted-foreground">Loading…</p>;
  }

  const box = {
    value: sentence,
    onChange: (text: string) => {
      setSentence(text);
      setError(null);
    },
    onBuild: handleStart,
    pending: create.isPending,
    error,
  };

  // A failed list degrades to the setup box: it must still work without the list.
  const workflows = workflowsQuery.data ?? [];
  if (workflows.length === 0) {
    return (
      <div className="automate-empty">
        <SetupBox {...box} headingLevel="h1" />
      </div>
    );
  }

  const runs = runsQuery.data ?? [];
  return (
    <MotionConfig reducedMotion="user">
      <div className="automate-page">
        <header className="automate-header">
          <div>
            <h1 className="page-title">
              Automations <span className="count">· {workflows.length}</span>
            </h1>
            {runsQuery.isSuccess && (
              <p className="m-0 mt-1 text-[var(--text-dim)]">{automationsSummary(workflows, runs)}</p>
            )}
          </div>
          {/* One element in both states, so focus can come back to it. */}
          <AppButton
            ref={toggle}
            variant={adding ? 'outline' : 'brand'}
            className={cn(
              'automate-toggle h-[2.824rem] font-bold',
              adding && 'border-[var(--border-strong)] bg-[var(--bg-raised)] font-semibold dark:border-[var(--border-strong)] dark:bg-[var(--bg-raised)]',
            )}
            onClick={() => (adding ? closeBox() : setAdding(true))}
          >
            {adding ? <X aria-hidden /> : <Plus aria-hidden />}
            {adding ? 'Not now' : 'Add new'}
          </AppButton>
        </header>
        <AnimatePresence initial={false}>
          {adding && (
            <motion.div
              key="setup"
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={OPEN_TRANSITION}
              // Clipped only while it moves, or the open box loses its shadow.
              style={{ overflow: boxSettled ? 'visible' : 'hidden' }}
              onAnimationStart={() => setBoxSettled(false)}
              onAnimationComplete={() => setBoxSettled(true)}
            >
              <SetupBox {...box} heading="What else should I take off your hands?" focusOnOpen />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="automate-list">
          {adding && <h2 className="section-label m-0">Your automations · {workflows.length}</h2>}
          {runsQuery.isError && <p role="alert">Couldn&apos;t load the latest runs. Try again.</p>}
          <AutomationCards workflows={workflows} runs={runs} />
        </div>
      </div>
    </MotionConfig>
  );
}

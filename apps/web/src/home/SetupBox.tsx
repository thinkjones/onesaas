import type { StarterIdea } from '@dad/shared';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import AppButton from '../design/AppButton.tsx';
import MicButton from '../voice/MicButton.tsx';
import IdeaPicker from './IdeaPicker.tsx';

export interface SetupBoxProps {
  heading?: string;
  /** The empty state's box is the page's main heading; opened under a title it isn't. */
  headingLevel?: 'h1' | 'h2';
  value: string;
  onChange(value: string): void;
  onBuild(text: string): void;
  pending: boolean;
  error: string | null;
  /** Add new moves focus straight into the box. */
  focusOnOpen?: boolean;
}

/** Say or type what to automate, or start from a playbook idea. */
export default function SetupBox({
  heading = 'What chore should I take off your hands?',
  headingLevel: Heading = 'h2',
  value,
  onChange,
  onBuild,
  pending,
  error,
  focusOnOpen = false,
}: SetupBoxProps) {
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [picked, setPicked] = useState<StarterIdea | null>(null);
  const [pickCount, setPickCount] = useState(0);

  useEffect(() => {
    if (focusOnOpen) input.current?.focus();
  }, [focusOnOpen]);

  // After the picked text lands, so the cursor goes to the end of it.
  useEffect(() => {
    if (pickCount === 0) return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [pickCount]);

  // Grows with the text; 'auto' first so it can shrink again.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const pick = (idea: StarterIdea): void => {
    onChange(idea.ownerAsk);
    setPicked(idea);
    setPickCount((n) => n + 1);
  };

  return (
    <section aria-label="Set up a new automation" className="setup-box">
      <div className="setup-box-intro">
        <Heading className="setup-box-heading">{heading}</Heading>
        <p className="m-0 text-[var(--text-dim)]">
          Say it or type it. I&apos;ll draw it up for you to check. Nothing runs until you say so.
        </p>
      </div>
      <div className="setup-box-ask">
        <div className="setup-input">
          <MicButton bare onSend={onBuild} />
          <label htmlFor={inputId} className="sr-only">
            Describe the chore
          </label>
          <textarea
            ref={input}
            id={inputId}
            rows={2}
            placeholder="For example: when a customer emails me, save them and draft a reply for me to check"
            value={value}
            disabled={pending}
            onChange={(e) => {
              onChange(e.target.value);
              if (e.target.value.trim() === '') setPicked(null);
            }}
          />
          <AppButton variant="brand" className="setup-build h-[3.059rem] px-[1.412rem] max-[480px]:px-[1.059rem]" onClick={() => onBuild(value)} disabled={pending}>
            {pending ? 'Starting…' : 'Build it'}
            <ArrowRight aria-hidden />
          </AppButton>
        </div>
        {error && (
          <p role="alert" className="m-0 text-destructive">
            {error}
          </p>
        )}
        <p className="setup-hint">
          {picked
            ? `Starting from “${picked.title}”. Change any words you like.`
            : 'Hold the mic and talk, or pick an idea below to start from.'}
        </p>
      </div>
      <IdeaPicker selectedId={picked?.id} onPick={pick} />
    </section>
  );
}

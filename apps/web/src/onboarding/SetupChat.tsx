import Send from 'lucide-react/icons/send';
import { useState } from 'react';
import MicButton from '../voice/MicButton.tsx';
import type { UseVoiceResult } from '../voice/useVoice.ts';
import { cannedReply, type ChatChip } from './steps.ts';

export interface ChatLine {
  from: 'agent' | 'owner';
  text: string;
}

/** Setup's helper. It answers from the step's own copy; the builder agent isn't involved yet. */
export default function SetupChat({
  seed,
  chips,
  lines,
  onLines,
  useVoiceFn,
}: {
  seed: string[];
  chips: ChatChip[];
  lines: ChatLine[];
  onLines(next: ChatLine[]): void;
  useVoiceFn?: () => UseVoiceResult;
}) {
  const [input, setInput] = useState('');
  const say = (question: string, answer: string) =>
    onLines([...lines, { from: 'owner', text: question }, { from: 'agent', text: answer }]);
  const send = (text: string) => {
    const message = text.trim();
    if (message === '') return;
    setInput('');
    say(message, cannedReply());
  };
  return (
    <aside aria-label="Chat" className="onb-chat">
      <h2 className="onb-chat-title">Chat</h2>
      <div aria-live="polite" className="onb-chat-lines">
        {seed.map((text) => (
          <p key={text} className="onb-bubble" data-from="agent">
            {text}
          </p>
        ))}
        {lines.map((line, i) => (
          <p key={i} className="onb-bubble" data-from={line.from}>
            {line.text}
          </p>
        ))}
      </div>
      <div className="onb-chat-chips">
        {chips.map((chip) => (
          <button key={chip.label} type="button" className="onb-chat-chip" onClick={() => say(chip.label, chip.answer)}>
            {chip.label}
          </button>
        ))}
      </div>
      <form
        className="onb-chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="onboarding-chat" className="sr-only">
          Message
        </label>
        <input
          id="onboarding-chat"
          className="onb-input"
          placeholder="Type or hold to talk"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {input.trim() !== '' ? (
          <button type="submit" className="mic-bare" aria-label="Send">
            <Send aria-hidden className="size-[1.059rem]" />
          </button>
        ) : (
          <MicButton bare useVoiceFn={useVoiceFn} onSend={send} />
        )}
      </form>
    </aside>
  );
}

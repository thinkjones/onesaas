import { cn } from 'cn';
import ActivityLine from './ActivityLine.tsx';
import AskChips from './AskChips.tsx';
import type { AgentTranscriptItem } from './useAgent.ts';

export interface MessageProps {
  item: AgentTranscriptItem;
  /**
   * True only for the LATEST ask: older asks keep their chips visible but
   * disabled, so the owner can't answer a stale question. Ignored for other kinds.
   */
  latestAsk: boolean;
  /** While a turn runs, chips don't act (the spinner on activity lines runs). */
  busy: boolean;
  onSend(text: string): void;
}

/**
 * One transcript row. The owner's messages sit right in the primary bubble, the
 * agent's left in muted; `activity` is a small grey line, `ask` the question
 * plus its chips. Bubbles reuse the app's single radius and surfaces.
 */
export default function Message({ item, latestAsk, busy, onSend }: MessageProps) {
  if (item.kind === 'activity') {
    return (
      <div className="flex justify-start">
        <ActivityLine text={item.text} busy={busy} />
      </div>
    );
  }
  if (item.kind === 'ask') {
    return (
      <div className="flex justify-start">
        <div className="flex max-w-[90%] flex-col gap-2 rounded-[var(--radius)] bg-muted px-3 py-2">
          <p className="text-base whitespace-pre-line">{item.question}</p>
          <AskChips options={item.options} disabled={busy || !latestAsk} onSelect={onSend} />
        </div>
      </div>
    );
  }
  const owner = item.kind === 'owner';
  return (
    <div className={cn('flex', owner ? 'justify-end' : 'justify-start')}>
      <p
        className={cn(
          'max-w-[85%] rounded-[var(--radius)] px-3 py-2 text-base',
          owner ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {item.text}
      </p>
    </div>
  );
}

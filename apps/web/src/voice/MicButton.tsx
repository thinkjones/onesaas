import Mic from 'lucide-react/icons/mic';
import { useEffect, useRef, useState } from 'react';
import { useVoice, type UseVoiceResult } from './useVoice.ts';

export const EMPTY_FINAL_HINT = "I didn't catch that. Try again?";
/** A press held this long counts as hold-to-talk; shorter is a tap toggle. */
const HOLD_MS = 250;

export interface MicButtonProps {
  onSend(text: string): void;
  /** Test seam; the live hook otherwise. */
  useVoiceFn?: () => UseVoiceResult;
  /** Button diameter in px; the agent panel default is 64, home uses 72. */
  sizePx?: number;
  /** The compact "Hold to talk" pill, for sitting beside a text box. */
  pill?: boolean;
}

/**
 * The 64 px round push-to-talk button: hold to talk, or click to toggle
 * (tap once to start, click again to stop). While listening it shows a
 * pulsing ring and the live partial transcript. A non-empty final goes to
 * `onSend`; an empty one shows a hint instead.
 */
export default function MicButton({ onSend, useVoiceFn = useVoice, sizePx, pill = false }: MicButtonProps) {
  const voice = useVoiceFn();
  const [hint, setHint] = useState<string | null>(null);

  const onSendRef = useRef(onSend);
  useEffect(() => {
    // The ref update lives here (not in render). Re-running when onSend
    // changes only replaces the hook's single callback: no leak, no dupes.
    onSendRef.current = onSend;
    voice.onFinal((text: string) => {
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        setHint(null);
        onSendRef.current(trimmed);
      } else {
        setHint(EMPTY_FINAL_HINT);
      }
    });
  }, [voice, onSend]);

  const listening = voice.state === 'listening';
  const thinking = voice.state === 'thinking';
  const pressRef = useRef<{ downAt: number } | null>(null);
  // The click that ends a press belongs to that press: it must neither stop
  // a tap-started session nor restart a hold-released one.
  const startedByPressRef = useRef(false);

  const begin = (): void => {
    setHint(null);
    void voice.start();
  };

  const handlePointerDown = (): void => {
    if (voice.state === 'idle' || voice.state === 'error') {
      pressRef.current = { downAt: Date.now() };
      startedByPressRef.current = true;
      begin();
    }
  };

  const handlePointerUp = (): void => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;
    // Hold release stops; a tap stays listening for a second click.
    if (Date.now() - press.downAt >= HOLD_MS) voice.stop();
  };

  const handlePointerCancel = (): void => {
    if (pressRef.current) {
      pressRef.current = null;
      voice.stop();
    }
  };

  const handleClick = (): void => {
    if (startedByPressRef.current) {
      startedByPressRef.current = false;
      return;
    }
    if (voice.state === 'listening' || voice.state === 'thinking') {
      // From thinking, stop() is the user's cancel back to idle.
      voice.stop();
    } else if (voice.state === 'idle' || voice.state === 'error') {
      begin();
    }
  };

  return (
    <div className={pill ? 'relative flex-none' : 'flex flex-col items-center gap-1'}>
      <button
        type="button"
        aria-label="Hold to talk"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
        onClick={handleClick}
        style={sizePx === undefined ? undefined : { width: sizePx, height: sizePx }}
        className={
          pill
            ? 'relative flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full border-0 bg-primary px-4 text-[0.824rem] font-semibold text-primary-foreground shadow-none hover:brightness-110'
            : 'relative flex h-16 w-16 items-center justify-center rounded-full border-0 bg-primary text-primary-foreground shadow-sm transition-all hover:brightness-110'
        }
      >
        {listening && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-primary/30 motion-safe:animate-ping"
          />
        )}
        <Mic aria-hidden className={pill ? 'relative h-[18px] w-[18px]' : 'relative h-7 w-7'} />
        {pill && <span className="relative">Hold to talk</span>}
      </button>
      {!pill && <span className="text-sm text-muted-foreground">Hold to talk</span>}
      {/* Beside a text box there's no room below, so what the mic says floats above it. */}
      <div className={pill ? 'absolute bottom-full left-0 mb-2 w-64 rounded-[var(--radius-s)] bg-card empty:hidden' : 'contents'}>
        {listening && voice.partial.length > 0 && (
          <p aria-live="polite" className="max-w-56 text-center text-sm text-muted-foreground italic">
            {voice.partial}
          </p>
        )}
        {thinking && (
          <p
            aria-live="polite"
            className="text-center text-sm text-muted-foreground motion-safe:animate-pulse"
          >
            Thinking… tap to cancel
          </p>
        )}
        {hint && <p className="text-center text-sm text-muted-foreground">{hint}</p>}
        {voice.error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {voice.error}
          </p>
        )}
      </div>
    </div>
  );
}

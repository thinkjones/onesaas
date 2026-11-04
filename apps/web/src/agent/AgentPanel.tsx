import PanelRightClose from 'lucide-react/icons/panel-right-close';
import Send from 'lucide-react/icons/send';
import { useEffect, useRef, useState } from 'react';
import { Textarea } from '../components/ui/textarea.tsx';
import AppButton from '../design/AppButton.tsx';
import MicButton from '../voice/MicButton.tsx';
import Message from './Message.tsx';
import type { UseAgentResult } from './useAgent.ts';

export interface AgentPanelProps {
  /**
   * The workflow's conversation, owned by the page (Bug #4): the design
   * Start box and this chat share one useAgent instance so a turn started
   * in one place continues in the other.
   */
  agent: UseAgentResult;
  /** WorkflowPage's agentPrefill seam: applied to the input once, then cleared. */
  prefill?: string;
  onPrefillConsumed?(): void;
  /** HomePage's first sentence: sent once on mount as Dad's opening message. */
  initialPrompt?: string;
  /** Fired after the opening send so the page can consume `initialPrompt`. */
  onInitialSent?(): void;
  /**
   * An external send request (Explain's "Tell me more"): each new nonce
   * sends its text once. Follows the prefill seam's ref-guard idiom so
   * StrictMode and re-renders never double-send.
   */
  sendRequest?: { text: string; nonce: number };
  /** The page collapses the panel (state lives in the page, per mount). */
  onCollapse?(): void;
}

/**
 * The chat: transcript (Dad right, agent left, activity as small grey
 * lines, asks as chips) with a textarea + Send below and a push-to-talk mic
 * button. Only the LATEST ask renders clickable chips — older ones stay
 * visible but disabled, and everything locks while busy.
 */
export default function AgentPanel({
  agent,
  prefill,
  onPrefillConsumed,
  initialPrompt,
  onInitialSent,
  sendRequest,
  onCollapse,
}: AgentPanelProps) {
  const { transcript, busy, sendError, historyPending, historyError, send } = agent;
  const [input, setInput] = useState('');

  // Each prefill value applies once (guarded by ref, so re-renders and
  // callback-identity churn never re-apply it over Dad's typing); the seam
  // clears on consume and again on every send, so a reopened panel never
  // resurrects a stale prompt.
  const appliedPrefill = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prefill === undefined || prefill === appliedPrefill.current) return;
    appliedPrefill.current = prefill;
    setInput(prefill);
    onPrefillConsumed?.();
  }, [prefill, onPrefillConsumed]);

  // One-shot opening send (ref-guarded, so StrictMode's double effect still
  // sends exactly once — a second POST would 409 against the first turn). The
  // ref dies with the panel, so the page ALSO consumes its held prompt via
  // onInitialSent (mirroring the prefill seam): without that, collapse/reopen
  // would fire a duplicate turn.
  const initialSent = useRef(false);
  useEffect(() => {
    if (initialSent.current) return;
    if ((initialPrompt?.trim() ?? '').length === 0) return;
    initialSent.current = true;
    void send(initialPrompt!.trim());
    onInitialSent?.();
  }, [initialPrompt, onInitialSent, send]);

  // External sends (Explain's "Tell me more"): the nonce ref-guard sends
  // each request exactly once, like the opening send above.
  const lastSentNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (sendRequest === undefined || sendRequest.nonce === lastSentNonce.current) return;
    if (sendRequest.text.trim().length === 0) return;
    lastSentNonce.current = sendRequest.nonce;
    void send(sendRequest.text.trim());
  }, [sendRequest, send]);

  // Scroll-follow: keep the newest row (or error) in view. An instant jump,
  // never smooth animation, so reduced-motion needs no special case.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (transcript.length === 0 && !busy && sendError === null) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript.length, busy, sendError]);

  const lastAskIndex = transcript.findLastIndex((m) => m.kind === 'ask');

  const submitInput = (): void => {
    if (input.trim().length === 0 || busy) return;
    onPrefillConsumed?.();
    const text = input.trim();
    setInput('');
    void send(text);
  };

  const submitChip = (text: string): void => {
    if (busy) return;
    onPrefillConsumed?.();
    void send(text);
  };

  return (
    <section
      aria-label="Chat"
      className="flex h-full min-h-0 flex-col gap-2.5 rounded-[var(--radius)] border border-border bg-card p-[18px] shadow-md"
    >
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[1.059rem] font-bold">Chat</h2>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.706rem] font-semibold text-accent-ink">
          Designing
        </span>
        <span className="flex-1" />
        {onCollapse && (
          <AppButton variant="ghost" size="icon" onClick={onCollapse} aria-label="Hide chat">
            <PanelRightClose />
          </AppButton>
        )}
      </div>
      <div
        ref={scrollRef}
        aria-label="Conversation"
        className="flex min-h-[280px] flex-1 flex-col gap-3 overflow-y-auto"
      >
        {transcript.map((item, i) => (
          <Message
            key={`${item.at}-${i}`}
            item={item}
            latestAsk={item.kind === 'ask' && i === lastAskIndex}
            busy={busy}
            onSend={submitChip}
          />
        ))}
        {busy && (
          <p role="status" className="text-base text-muted-foreground">
            Working on it…
          </p>
        )}
        {historyPending && transcript.length === 0 && (
          <p className="text-base text-muted-foreground">Loading…</p>
        )}
        {transcript.length === 0 && !busy && !historyPending && !historyError && (
          <p className="text-base text-muted-foreground">
            Tell me what you want this automation to do.
          </p>
        )}
        {historyError && (
          <p className="text-base text-muted-foreground">Couldn&apos;t load earlier messages.</p>
        )}
        {sendError && (
          <p role="alert" className="text-base text-destructive">
            {sendError}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MicButton pill onSend={submitChip} />
        <Textarea
          aria-label="Chat message"
          placeholder="or type a change…"
          rows={1}
          className="min-h-12 min-w-[7rem] flex-1 resize-none text-[0.824rem]"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submitInput();
            }
          }}
        />
        <AppButton size="icon" aria-label="Send" onClick={submitInput} disabled={busy || input.trim().length === 0}>
          <Send aria-hidden />
        </AppButton>
      </div>
    </section>
  );
}

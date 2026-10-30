import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  getAgentTranscript,
  sendAgentMessage,
  useAgentEvents,
  type AgentEvent,
} from '../api.ts';

/**
 * How long after a `done` the hook stays busy before going idle. The `done`
 * event does NOT mean turn-over by itself: the `activate` tool emits a
 * mid-turn `done` (it has no endTurn, so the loop keeps going) followed by the
 * loop's final `done`. Any agent event inside the window proves the turn is
 * still alive and cancels the pending idle; only silence settles to idle.
 * Exported for the fake-timer test.
 */
export const AGENT_SETTLING_MS = 1500;

/** One visible transcript row: persisted rows plus live session events. */
export type AgentTranscriptItem =
  | { kind: 'dad'; text: string; at: number }
  | { kind: 'agent'; text: string; at: number }
  | { kind: 'ask'; question: string; options: string[]; at: number }
  | { kind: 'activity'; text: string; at: number };

export interface UseAgentResult {
  /** Persisted transcript (GET on mount) + live events appended. */
  transcript: AgentTranscriptItem[];
  /** True from send until the turn's final `done` settles (see above). */
  busy: boolean;
  /** The last send failure, for inline display; cleared on the next send. */
  sendError: string | null;
  /** The transcript GET hasn't resolved yet and no rows are cached. */
  historyPending: boolean;
  /** The transcript GET failed and no rows are cached. Live events still append. */
  historyError: boolean;
  send(text: string): Promise<void>;
}

/**
 * Name a new reducer from Dad's first sentence: the FIRST 6 WORDS (split on
 * whitespace runs; fewer than 6 keeps the whole sentence). Empty input names
 * nothing — callers prompt inline instead of POSTing an empty name. The agent
 * gives the reducer its proper name later via `rename_workflow`.
 */
export function workflowNameFromSentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return '';
  return trimmed.split(/\s+/).slice(0, 6).join(' ');
}

/**
 * The agent-panel conversation: transcript, busy flag, and send.
 *
 * Composition (deliberately no refetch-on-done): the persisted transcript is
 * fetched on EVERY mount — before any live turn, so it cannot overlap what
 * SSE replays — and live `say`/`ask`/`activity` events append after it. Dad's
 * sends append optimistically (the server only persists at turn end and emits
 * no event for Dad's own message). Refetching after `done` would duplicate
 * every live row against its freshly-persisted twin, so the hook never does;
 * refetching on mount is safe because `live` starts empty on every mount (a
 * collapse/reopen mid-turn loses its optimistic rows — the accepted,
 * refresh-like loss — but can never duplicate them). `plan`/`built`/`test`
 * events are the canvas's, not the transcript's — they still prove the turn
 * is alive for the settling window.
 *
 * Send failures: a 409 (a turn is already running) keeps `busy` and surfaces
 * the server's message in `sendError`; anything else idles with a fallback.
 * Either way the rejected optimistic row is removed — it was never recorded.
 */
export function useAgent(workflowId: string): UseAgentResult {
  const [live, setLive] = useState<AgentTranscriptItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const settlingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Refetched on every mount (no invalidation anywhere): without it a
  // collapse/reopen would serve the cached pre-turn transcript while `live`
  // resets, hiding the completed answer until reload. Safe per above.
  const persistedQuery = useQuery({
    queryKey: ['agent-transcript', workflowId],
    queryFn: () => getAgentTranscript(workflowId),
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
  const persisted = useMemo<AgentTranscriptItem[]>(
    () =>
      (persistedQuery.data ?? []).map((e) =>
        e.role === 'dad'
          ? { kind: 'dad', text: e.text, at: e.at }
          : e.ask
            ? { kind: 'ask', question: e.ask.question, options: e.ask.options, at: e.at }
            : { kind: 'agent', text: e.text, at: e.at },
      ),
    [persistedQuery.data],
  );

  const clearSettling = useCallback(() => {
    if (settlingTimer.current !== undefined) {
      clearTimeout(settlingTimer.current);
      settlingTimer.current = undefined;
    }
  }, []);

  // The pending idle must not fire after leaving the screen.
  useEffect(() => clearSettling, [clearSettling]);

  const handleAgentEvent = useCallback(
    (e: AgentEvent) => {
      // Every event proves the turn is alive; `done` restarts the window.
      clearSettling();
      if (e.type === 'say') {
        const item: AgentTranscriptItem = { kind: 'agent', text: e.text, at: Date.now() };
        setLive((prev) => [...prev, item]);
      } else if (e.type === 'ask') {
        const item: AgentTranscriptItem = {
          kind: 'ask',
          question: e.question,
          options: e.options,
          at: Date.now(),
        };
        setLive((prev) => [...prev, item]);
      } else if (e.type === 'activity') {
        const item: AgentTranscriptItem = { kind: 'activity', text: e.text, at: Date.now() };
        setLive((prev) => [...prev, item]);
      } else if (e.type === 'done') {
        settlingTimer.current = setTimeout(() => {
          settlingTimer.current = undefined;
          setBusy(false);
        }, AGENT_SETTLING_MS);
      }
    },
    [clearSettling],
  );
  useAgentEvents(workflowId, handleAgentEvent);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      clearSettling();
      setSendError(null);
      setBusy(true);
      const entry: AgentTranscriptItem = { kind: 'dad', text: trimmed, at: Date.now() };
      setLive((prev) => [...prev, entry]);
      try {
        await sendAgentMessage(workflowId, trimmed);
      } catch (err) {
        setLive((prev) => prev.filter((m) => m !== entry));
        setSendError(
          err instanceof ApiError && err.message
            ? err.message
            : "Couldn't reach the server. Try again.",
        );
        if (!(err instanceof ApiError && err.status === 409)) setBusy(false);
      }
    },
    [clearSettling, workflowId],
  );

  const transcript = useMemo(() => [...persisted, ...live], [persisted, live]);
  return {
    transcript,
    busy,
    sendError,
    // Live events append to `live` regardless of the GET outcome, so the
    // panel keeps working through a history failure (verified: the event and
    // send paths never read persistedQuery).
    historyPending: persistedQuery.isPending,
    historyError: persistedQuery.isError,
    send,
  };
}

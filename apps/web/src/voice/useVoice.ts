import { useCallback, useEffect, useRef, useState } from 'react';
import pcmWorkletSource from './pcm-worklet.js?raw';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'error';

export const MICROPHONE_ERROR_MESSAGE =
  "I can't hear you. Check your microphone in Chrome's settings.";
export const VOICE_SERVICE_ERROR = "Voice isn't working right now. Try again in a moment.";
/** Bound on waiting for the final transcript after a stop; then fail loudly. */
export const VOICE_THINKING_TIMEOUT_MS = 15_000;

export interface UseVoiceResult {
  state: VoiceState;
  partial: string;
  error?: string;
  start(): Promise<void>;
  stop(): void;
  onFinal(cb: (text: string) => void): void;
}

interface VoiceDownFrame {
  type: 'partial' | 'final' | 'speechEnd' | 'error';
  text?: string;
  message?: string;
}

function voiceWsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/voice`;
}

/**
 * Push-to-talk capture: mic → AudioWorklet (24 kHz mono 16-bit PCM, 100 ms
 * frames) → /api/voice proxy → Muse Voice Transcribe realtime. The API key
 * stays on the server; the browser only streams audio and reads transcripts.
 *
 * `listening` captures audio; `thinking` awaits the final transcript after a
 * stop (button release, second click, or the model's own `speechEnd`);
 * `error` carries a Dad-readable message in `error`.
 */
export function useVoice(): UseVoiceResult {
  const [state, setState] = useState<VoiceState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const finalCbRef = useRef<((text: string) => void) | null>(null);
  const finalSentRef = useRef(false);
  const runRef = useRef(0);
  // Socket callbacks read this instead of state: they fire outside render.
  const stateRef = useRef<VoiceState>('idle');
  // Bounds the `thinking` wait: a stalled upstream must fail, not hang.
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setVoiceState = useCallback((next: VoiceState): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearThinkingTimer = useCallback((): void => {
    if (thinkingTimerRef.current !== null) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  }, []);

  const releaseCapture = useCallback((): void => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    // Closing the context tears down the source and worklet nodes with it.
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  const closeSocket = useCallback((): void => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }
  }, []);

  /** Fully idle: no capture, no socket. The final already went out. */
  const finish = useCallback((): void => {
    clearThinkingTimer();
    releaseCapture();
    closeSocket();
    setPartial('');
    setVoiceState('idle');
  }, [clearThinkingTimer, closeSocket, releaseCapture, setVoiceState]);

  const emitFinal = useCallback(
    (text: string): void => {
      if (finalSentRef.current) return;
      finalSentRef.current = true;
      finish();
      finalCbRef.current?.(text);
    },
    [finish],
  );

  const fail = useCallback(
    (message: string): void => {
      clearThinkingTimer();
      releaseCapture();
      closeSocket();
      setPartial('');
      setError(message);
      setVoiceState('error');
    },
    [clearThinkingTimer, closeSocket, releaseCapture, setVoiceState],
  );

  const stop = useCallback((): void => {
    // A stop while thinking is the user's cancel: kill the run so late
    // frames can't land, release everything, and return to idle with no
    // error — Dad can press again to retry.
    if (stateRef.current === 'thinking') {
      runRef.current += 1;
      clearThinkingTimer();
      releaseCapture();
      closeSocket();
      setPartial('');
      setVoiceState('idle');
      return;
    }
    // stop() ends capture and waits for the server's final as `thinking`.
    if (wsRef.current === null || stateRef.current !== 'listening') return;
    releaseCapture();
    try {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    } catch {
      // The socket died; onclose reports it.
    }
    setVoiceState('thinking');
    // The final may never come: fail loudly instead of hanging in thinking.
    const run = runRef.current;
    clearThinkingTimer();
    thinkingTimerRef.current = setTimeout(() => {
      thinkingTimerRef.current = null;
      if (run !== runRef.current || stateRef.current !== 'thinking') return;
      fail(VOICE_SERVICE_ERROR);
    }, VOICE_THINKING_TIMEOUT_MS);
  }, [clearThinkingTimer, closeSocket, fail, releaseCapture, setVoiceState]);

  const start = useCallback(async (): Promise<void> => {
    const run = runRef.current + 1;
    runRef.current = run;
    // A previous run's socket and tracks (if any) die here, so a second
    // start() can never orphan them; its callbacks are stale via `run`.
    clearThinkingTimer();
    releaseCapture();
    closeSocket();
    finalSentRef.current = false;
    setError(undefined);
    setPartial('');
    setVoiceState('listening');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch {
      if (run !== runRef.current) return;
      // Denied, missing, or busy mic: one Dad-readable message either way.
      fail(MICROPHONE_ERROR_MESSAGE);
      return;
    }
    if (run !== runRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    if (typeof AudioContext === 'undefined') {
      for (const track of stream.getTracks()) track.stop();
      fail(VOICE_SERVICE_ERROR);
      return;
    }
    streamRef.current = stream;

    let ws: WebSocket;
    try {
      ws = new WebSocket(voiceWsUrl());
    } catch {
      fail(VOICE_SERVICE_ERROR);
      return;
    }
    wsRef.current = ws;

    ws.onmessage = (event: MessageEvent): void => {
      if (run !== runRef.current) return;
      let frame: VoiceDownFrame;
      try {
        frame = JSON.parse(String(event.data)) as VoiceDownFrame;
      } catch {
        return;
      }
      if (frame.type === 'partial') {
        setPartial(frame.text ?? '');
      } else if (frame.type === 'final') {
        emitFinal(frame.text ?? '');
      } else if (frame.type === 'speechEnd') {
        // The model heard Dad stop: end capture and wait for the final.
        stop();
      } else if (frame.type === 'error') {
        fail(VOICE_SERVICE_ERROR);
      }
    };
    ws.onclose = (): void => {
      if (run !== runRef.current || finalSentRef.current) return;
      wsRef.current = null;
      releaseCapture();
      setPartial('');
      if (stateRef.current === 'thinking') {
        // A close while thinking (e.g. silence flushed nothing) is an empty
        // turn, not a failure: report it so the button can show its hint.
        emitFinal('');
      } else if (stateRef.current === 'listening') {
        setError(VOICE_SERVICE_ERROR);
        setVoiceState('error');
      }
    };
    ws.onerror = (): void => {
      // Browsers fire close right after error; onclose reports it.
    };

    // Capture starts only once the socket is up, so no audio is lost to a
    // failed connection; a socket failure first fails via onclose above.
    const openCapture = async (): Promise<void> => {
      // The whole body sits inside try/catch: a throw from the AudioContext
      // or node constructors must fail the run loudly, never escape as an
      // unhandled rejection with the mic left on.
      try {
        if (run !== runRef.current) return;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        // The worklet source ships as a string (?raw) and loads via a Blob
        // URL: a plain `new URL('./pcm-worklet.js', import.meta.url)` inlines
        // to a data: URL, which AudioWorklet.addModule rejects in Chrome.
        const workletUrl = URL.createObjectURL(
          new Blob([pcmWorkletSource], { type: 'application/javascript' }),
        );
        try {
          await ctx.audioWorklet.addModule(workletUrl);
        } finally {
          URL.revokeObjectURL(workletUrl);
        }
        if (run !== runRef.current) return;
        // The socket may have died while the module loaded: onclose already
        // reported it, so bail instead of wiring nodes onto a dead socket.
        if (ws.readyState !== WebSocket.OPEN) return;
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, 'pcm-capture');
        // Never connect to the destination: Dad must not hear himself back.
        source.connect(node);
        node.port.onmessage = (event: MessageEvent): void => {
          if (run !== runRef.current) return;
          if (ws.readyState === WebSocket.OPEN) ws.send(event.data as ArrayBuffer);
        };
      } catch {
        if (run !== runRef.current) return;
        fail(VOICE_SERVICE_ERROR);
      }
    };

    if (ws.readyState === WebSocket.OPEN) {
      void openCapture();
    } else {
      ws.addEventListener(
        'open',
        () => {
          void openCapture();
        },
        { once: true },
      );
    }
  }, [clearThinkingTimer, closeSocket, emitFinal, fail, releaseCapture, setVoiceState, stop]);

  const onFinal = useCallback((cb: (text: string) => void): void => {
    finalCbRef.current = cb;
  }, []);

  // Unmount mid-turn: release the mic and the socket together.
  useEffect(() => {
    return () => {
      runRef.current += 1;
      if (thinkingTimerRef.current !== null) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return { state, partial, error, start, stop, onFinal };
}

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

// Field names and event shapes follow
// https://dev.meta.ai/docs/api-reference/voice/realtime (+ /schemas):
// the handshake is the first JSON text frame (the endpoint ignores the HTTP
// Authorization header), audio goes up as raw PCM binary frames, and
// {"type":"endStream"} half-closes input while the server flushes results.
export const VOICE_MODEL = 'muse-voice-transcribe-1.0';
export const VOICE_UPSTREAM_URL = 'wss://api.meta.ai/v1/asr/realtime';
export const VOICE_AUDIO_ENCODING = 'PCM_24KHZ';
export const VOICE_MODE = 'ENDPOINTING';

/** Frames the proxy sends down to the browser. The browser never sees the key. */
export type VoiceDownFrame =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'speechEnd' }
  | { type: 'error'; message: string };

/** The handshake frame, sent as the first upstream text frame. */
export function buildVoiceHandshake(apiKey: string): string {
  return JSON.stringify({
    authorization: { accessToken: `Bearer ${apiKey}` },
    audioEncoding: VOICE_AUDIO_ENCODING,
    model: VOICE_MODEL,
    mode: VOICE_MODE,
  });
}

/**
 * Map one upstream text frame to a browser frame. Returns null for the
 * handshake acknowledgement (the only server frame with no `type` field)
 * and for events the browser ignores (speechStart, speaker, progress).
 * In ENDPOINTING mode the turn text arrives via `speechComplete`, and
 * `speechEnd` is only the boundary — never the transcript.
 */
export function mapUpstreamEvent(raw: string): VoiceDownFrame | null {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof event !== 'object' || event === null) return null;
  const record = event as Record<string, unknown>;
  if (record['type'] === undefined) return null; // Handshake ack.
  switch (record['type']) {
    case 'transcript': {
      const text = typeof record['transcript'] === 'string' ? record['transcript'] : '';
      return record['final'] === true ? { type: 'final', text } : { type: 'partial', text };
    }
    case 'speechComplete': {
      const text = typeof record['transcript'] === 'string' ? record['transcript'] : '';
      return { type: 'final', text };
    }
    case 'speechEnd':
      return { type: 'speechEnd' };
    case 'error': {
      const message =
        typeof record['message'] === 'string' && record['message'].length > 0
          ? record['message']
          : 'Voice transcription failed.';
      return { type: 'error', message };
    }
    default:
      return null;
  }
}

export interface VoiceProxyOptions {
  apiKey?: string;
  /** Overridden in tests with a fake upstream URL. */
  upstreamUrl?: string;
}

/** The @hono/node-ws sender surface the proxy drives. */
export interface VoiceBrowserSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * One browser connection's upstream session. Binary browser frames (24 kHz
 * mono 16-bit PCM) pass through untouched; a browser {"type":"stop"} sends
 * {"type":"endStream"} upstream and the browser socket closes once the
 * final transcript arrives.
 */
class VoiceSession {
  private upstream: WebSocket | null = null;
  private stopRequested = false;
  private endStreamSent = false;
  private settled = false;
  private closed = false;

  constructor(
    private readonly browser: VoiceBrowserSocket,
    opts: VoiceProxyOptions,
  ) {
    const apiKey = opts.apiKey;
    if (!apiKey) {
      this.send({ type: 'error', message: 'Voice transcription is not configured.' });
      browser.close(1011, 'Voice not configured');
      this.closed = true;
      return;
    }
    // A per-session id for upstream log correlation (optional upstream param).
    const url = new URL(opts.upstreamUrl ?? VOICE_UPSTREAM_URL);
    url.searchParams.set('sessionId', `voice-${randomUUID()}`);
    const upstream = new WebSocket(url.toString());
    this.upstream = upstream;
    // The handshake must be the first frame, within 10 s of connect.
    upstream.on('open', () => {
      upstream.send(buildVoiceHandshake(apiKey));
    });
    upstream.on('message', (data: WebSocket.RawData) => {
      this.onUpstreamMessage(data);
    });
    upstream.on('close', (code: number) => {
      this.onUpstreamClose(code);
    });
    // 'error' always precedes 'close'; the close handler reports it.
    upstream.on('error', () => {});
  }

  onBrowserMessage(data: unknown): void {
    if (this.closed) return;
    if (typeof data === 'string') {
      let msg: unknown;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (typeof msg === 'object' && msg !== null) {
        const type = (msg as Record<string, unknown>)['type'];
        if (type === 'stop') this.requestStop();
      }
      return;
    }
    // Binary PCM: forward unchanged. @hono/node-ws delivers Buffer here.
    if (this.upstream?.readyState === WebSocket.OPEN) {
      this.upstream.send(data as Buffer);
    }
  }

  dispose(): void {
    this.closed = true;
    this.stopRequested = true;
    try {
      this.upstream?.close();
    } catch {
      // Already closed.
    }
    this.upstream = null;
  }

  private requestStop(): void {
    this.stopRequested = true;
    if (!this.endStreamSent && this.upstream?.readyState === WebSocket.OPEN) {
      this.endStreamSent = true;
      this.upstream.send(JSON.stringify({ type: 'endStream' }));
    }
  }

  private onUpstreamMessage(data: WebSocket.RawData): void {
    if (this.closed) return;
    // Text frames arrive as string or Buffer; binary audio never does, but a
    // stray binary frame fails JSON.parse and is ignored all the same.
    const raw =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : null;
    if (raw === null) return;
    const frame = mapUpstreamEvent(raw);
    if (!frame) return;
    this.send(frame);
    if (frame.type === 'final' || frame.type === 'error') {
      this.settled = true;
      if (frame.type === 'final' && this.stopRequested) this.closeBrowser(1000);
      if (frame.type === 'error') this.closeBrowser(1011, 'Voice transcription failed');
    }
  }

  private onUpstreamClose(code: number): void {
    if (this.closed) return;
    this.upstream = null;
    // A final or error already went down: close quietly, never pile an
    // error frame on top of a delivered transcript.
    if (this.settled) {
      this.closeBrowser(1000);
      return;
    }
    if (code === 1000) {
      this.closeBrowser(1000);
      return;
    }
    this.send({ type: 'error', message: 'Voice transcription ended unexpectedly.' });
    this.closeBrowser(1011, 'Upstream closed');
  }

  private send(frame: VoiceDownFrame): void {
    try {
      this.browser.send(JSON.stringify(frame));
    } catch {
      // The browser went away; dispose() follows via onClose.
    }
  }

  private closeBrowser(code: number, reason?: string): void {
    this.closed = true;
    try {
      this.upstream?.close();
    } catch {
      // Already closed.
    }
    this.upstream = null;
    try {
      this.browser.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}

/**
 * @hono/node-ws handlers for GET /api/voice: one VoiceSession per browser
 * connection. After `stop`, the socket closes once the final arrives.
 */
export function createVoiceHandlers(opts: VoiceProxyOptions): {
  onOpen(_e: Event, ws: VoiceBrowserSocket): void;
  onMessage(e: MessageEvent): void;
  onClose(): void;
  onError(): void;
} {
  let session: VoiceSession | null = null;
  return {
    onOpen(_e: Event, ws: VoiceBrowserSocket): void {
      session = new VoiceSession(ws, opts);
    },
    onMessage(e: MessageEvent): void {
      session?.onBrowserMessage(e.data);
    },
    onClose(): void {
      session?.dispose();
      session = null;
    },
    onError(): void {
      session?.dispose();
      session = null;
    },
  };
}

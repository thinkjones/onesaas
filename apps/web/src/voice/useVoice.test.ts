import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  MICROPHONE_ERROR_MESSAGE,
  useVoice,
  VOICE_SERVICE_ERROR,
  VOICE_THINKING_TIMEOUT_MS,
} from './useVoice.ts';

function stubGetUserMedia(impl: () => Promise<MediaStream>): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(impl) },
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Capture-path fakes: mic stream, socket, AudioContext, worklet node.
// ---------------------------------------------------------------------------

class FakeTrack {
  stop = vi.fn(() => {});
}

class FakeStream {
  tracks = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

function stubMic(): FakeStream {
  const stream = new FakeStream();
  stubGetUserMedia(() => Promise.resolve(stream as unknown as MediaStream));
  return stream;
}

type OpenListener = () => void;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  private listeners = new Map<string, OpenListener[]>();

  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  addEventListener(type: string, cb: OpenListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  /** Test driver: complete the connection. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const cb of this.listeners.get('open') ?? []) cb();
    this.listeners.delete('open');
  }

  /** Test driver: deliver a server text frame. */
  receive(text: string): void {
    this.onmessage?.({ data: text });
  }

  /** Test driver: the server closed the connection. */
  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

/** Every AudioContext the hook constructs. */
const audioContexts: FakeAudioContext[] = [];
/** Every worklet node the hook constructs. */
const workletNodes: FakeAudioWorkletNode[] = [];
/** Per-test override for `new AudioContext()`. Throw to simulate failure. */
let audioContextFactory: () => FakeAudioContext = () => new FakeAudioContext();
/** Per-test override for `audioWorklet.addModule`. */
let addModuleImpl: (url: string) => Promise<void> = () => Promise.resolve();

class FakeAudioContext {
  audioWorklet = { addModule: (url: string): Promise<void> => addModuleImpl(url) };
  createMediaStreamSource = vi.fn((_stream: unknown) => ({ connect: vi.fn(() => {}) }));
  close = vi.fn(() => Promise.resolve());

  constructor() {
    audioContexts.push(this);
  }
}

class FakeAudioWorkletNode {
  port: { onmessage: ((e: unknown) => void) | null } = { onmessage: null };

  ctx: unknown;
  name: string;

  constructor(ctx: unknown, name: string) {
    this.ctx = ctx;
    this.name = name;
    workletNodes.push(this);
  }
}

const realWebSocket = globalThis.WebSocket;
const realAudioContext = (globalThis as Record<string, unknown>)['AudioContext'];
const realAudioWorkletNode = (globalThis as Record<string, unknown>)['AudioWorkletNode'];
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

function stubCaptureGlobals(): void {
  (globalThis as Record<string, unknown>)['WebSocket'] = FakeWebSocket;
  (globalThis as Record<string, unknown>)['AudioContext'] = function () {
    return audioContextFactory();
  };
  (globalThis as Record<string, unknown>)['AudioWorkletNode'] = FakeAudioWorkletNode;
  URL.createObjectURL = vi.fn(() => 'blob:fake-pcm-worklet') as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn(() => {}) as unknown as typeof URL.revokeObjectURL;
}

function restoreCaptureGlobals(): void {
  globalThis.WebSocket = realWebSocket;
  (globalThis as Record<string, unknown>)['AudioContext'] = realAudioContext;
  (globalThis as Record<string, unknown>)['AudioWorkletNode'] = realAudioWorkletNode;
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
}

/** Start the hook and drive it to a live `listening` session. */
async function startListening(): Promise<{
  result: { current: ReturnType<typeof useVoice> };
  unmount: () => void;
  ws: FakeWebSocket;
  stream: FakeStream;
}> {
  stubCaptureGlobals();
  const stream = stubMic();
  FakeWebSocket.instances.length = 0;
  const { result, unmount } = renderHook(() => useVoice());
  await act(async () => {
    await result.current.start();
  });
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error('useVoice never constructed its WebSocket');
  await act(async () => {
    ws.open();
  });
  await act(async () => {});
  if (result.current.state !== 'listening') {
    throw new Error(`expected listening, got ${result.current.state}`);
  }
  return { result, unmount, ws, stream };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  restoreCaptureGlobals();
  audioContexts.length = 0;
  workletNodes.length = 0;
  FakeWebSocket.instances.length = 0;
  audioContextFactory = () => new FakeAudioContext();
  addModuleImpl = () => Promise.resolve();
});

describe('useVoice', () => {
  test('getUserMedia NotAllowedError gives state error and the microphone message', async () => {
    stubGetUserMedia(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));

    const { result } = renderHook(() => useVoice());
    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe(MICROPHONE_ERROR_MESSAGE);
    expect(MICROPHONE_ERROR_MESSAGE).toBe(
      "I can't hear you. Check your microphone in Chrome's settings.",
    );
  });

  test('stop without start stays idle', async () => {
    const { result } = renderHook(() => useVoice());
    act(() => {
      result.current.stop();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.partial).toBe('');
  });

  test('thinking without a final times out into a loud service error', async () => {
    vi.useFakeTimers();
    const { result, unmount, ws } = await startListening();

    act(() => {
      result.current.stop();
    });
    expect(result.current.state).toBe('thinking');

    // Upstream never answers: the bound fires instead of hanging forever.
    act(() => {
      vi.advanceTimersByTime(VOICE_THINKING_TIMEOUT_MS);
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe(VOICE_SERVICE_ERROR);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    unmount();
  });

  test('a final before the timeout wins and disarms the timer', async () => {
    vi.useFakeTimers();
    const finals: string[] = [];
    const { result, unmount, ws } = await startListening();
    act(() => {
      result.current.onFinal((text: string) => finals.push(text));
    });

    act(() => {
      result.current.stop();
    });
    expect(result.current.state).toBe('thinking');

    act(() => {
      ws.receive(JSON.stringify({ type: 'final', text: 'hello owner' }));
    });
    expect(finals).toEqual(['hello owner']);
    expect(result.current.state).toBe('idle');

    // The disarmed timer must not fail the next turn out from under it.
    act(() => {
      vi.advanceTimersByTime(VOICE_THINKING_TIMEOUT_MS * 2);
    });
    expect(result.current.state).toBe('idle');
    unmount();
  });

  test('stop from thinking cancels the turn back to idle', async () => {
    vi.useFakeTimers();
    const { result, unmount, ws } = await startListening();

    act(() => {
      result.current.stop();
    });
    expect(result.current.state).toBe('thinking');

    // The second stop is the user's cancel: no error, socket released.
    act(() => {
      result.current.stop();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeUndefined();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);

    // A late final for the cancelled run must not land anywhere.
    const finals: string[] = [];
    act(() => {
      result.current.onFinal((text: string) => finals.push(text));
      ws.receive(JSON.stringify({ type: 'final', text: 'too late' }));
      vi.advanceTimersByTime(VOICE_THINKING_TIMEOUT_MS * 2);
    });
    expect(finals).toEqual([]);
    expect(result.current.state).toBe('idle');
    unmount();
  });

  test('AudioContext construction failure fails loudly with the mic released', async () => {
    stubCaptureGlobals();
    const stream = stubMic();
    audioContextFactory = () => {
      throw new Error('AudioContext unavailable');
    };
    const unhandled: unknown[] = [];
    const capture = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', capture);
    try {
      FakeWebSocket.instances.length = 0;
      const { result, unmount } = renderHook(() => useVoice());
      await act(async () => {
        await result.current.start();
      });
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error('useVoice never constructed its WebSocket');
      await act(async () => {
        ws.open();
      });
      await act(async () => {});
      // Give a stray rejection a chance to surface.
      await new Promise((r) => setTimeout(r, 20));

      expect(result.current.state).toBe('error');
      expect(result.current.error).toBe(VOICE_SERVICE_ERROR);
      for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(unhandled).toEqual([]);
      unmount();
    } finally {
      process.removeListener('unhandledRejection', capture);
    }
  });

  test('capture bails silently when the socket died mid-connect', async () => {
    stubCaptureGlobals();
    stubMic();
    let releaseModule!: () => void;
    addModuleImpl = () => new Promise<void>((resolve) => {
      releaseModule = resolve;
    });
    FakeWebSocket.instances.length = 0;
    const { result, unmount } = renderHook(() => useVoice());
    await act(async () => {
      await result.current.start();
    });
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('useVoice never constructed its WebSocket');
    await act(async () => {
      ws.open();
    });
    // The socket dies while addModule is in flight: onclose reports it.
    await act(async () => {
      ws.serverClose();
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe(VOICE_SERVICE_ERROR);

    const nodesBefore = workletNodes.length;
    await act(async () => {
      releaseModule();
    });
    await act(async () => {});

    // openCapture must bail: no nodes wired onto a dead socket, no crash.
    expect(workletNodes.length).toBe(nodesBefore);
    for (const ctx of audioContexts) expect(ctx.createMediaStreamSource).not.toHaveBeenCalled();
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe(VOICE_SERVICE_ERROR);
    unmount();
  });
});

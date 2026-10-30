import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { __resetSoundForTest, sound } from './sound.ts';

/**
 * jsdom's Audio.play is unimplemented, so stand in a scripted double.
 * Mirrors the real HTMLAudioElement contract the engine relies on:
 * starts paused, throws when volume leaves 0..1, exposes the media
 * events the engine wires up.
 */
class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  loop = false;
  playCalls = 0;
  pauseCalls = 0;
  playing = false;
  /** NaN until "metadata loads", like a real not-yet-loaded element. */
  duration = NaN;
  currentTime = 0;
  onended: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onstalled: (() => void) | null = null;

  private _volume = 1;

  constructor(src?: string) {
    this.src = src ?? '';
    FakeAudio.instances.push(this);
  }

  /** Real Audio starts paused; play() unpauses, pause() repauses. */
  get paused(): boolean {
    return !this.playing;
  }

  get volume(): number {
    return this._volume;
  }

  /** Real Audio throws when volume is set outside 0..1. */
  set volume(v: number) {
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) {
      throw new RangeError(`FakeAudio volume ${String(v)} out of range 0..1`);
    }
    this._volume = v;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.playing = true;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.playing = false;
  }
}

function playingLoops(): FakeAudio[] {
  return FakeAudio.instances.filter(
    (a) => a.src.includes('ambient-') && a.playing,
  );
}

function ambientLoop(n: 1 | 2): FakeAudio {
  const el = FakeAudio.instances.find((a) => a.src.includes(`ambient-${n}`));
  if (!el) throw new Error(`ambient-${n} loop was never created`);
  return el;
}

function totalPlayCalls(): number {
  return FakeAudio.instances.reduce((n, a) => n + a.playCalls, 0);
}

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  __resetSoundForTest();
  sound.setVolume(0.5);
  sound.setEnabled(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sound', () => {
  test("chime('step') before unlock() doesn't play", () => {
    sound.chime('step');
    expect(FakeAudio.instances).toHaveLength(0);
  });

  test('after unlock it plays at the right volume', () => {
    sound.unlock();
    sound.chime('step');
    expect(FakeAudio.instances).toHaveLength(1);
    const chime = FakeAudio.instances[0]!;
    // Chimes play at volume × 1.6: 0.5 × 1.6 = 0.8.
    expect(chime.volume).toBeCloseTo(0.8, 5);
    expect(chime.playCalls).toBe(1);

    // Capped at 1: 0.9 × 1.6 would be 1.44.
    sound.setVolume(0.9);
    sound.chime('done');
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[1]!.volume).toBe(1);
  });

  test('setEnabled(false) pauses ambient', () => {
    sound.unlock();
    sound.ambient(true);
    expect(playingLoops()).toHaveLength(1);
    sound.setEnabled(false);
    expect(playingLoops()).toHaveLength(0);
    expect(FakeAudio.instances.every((a) => !a.src.includes('ambient-') || a.pauseCalls > 0)).toBe(
      true,
    );
  });

  test('ambient(true) twice creates one playing loop', () => {
    sound.unlock();
    sound.ambient(true);
    sound.ambient(true);
    expect(playingLoops()).toHaveLength(1);
    // The paused===false dedupe guard must prevent a second play() call.
    expect(playingLoops()[0]!.playCalls).toBe(1);
  });

  test('ambient(true) before unlock() starts playing on unlock', () => {
    sound.ambient(true);
    expect(playingLoops()).toHaveLength(0);
    expect(FakeAudio.instances).toHaveLength(0);
    sound.unlock();
    expect(playingLoops()).toHaveLength(1);
  });

  test('ambient(false) silences all loops', () => {
    sound.unlock();
    sound.ambient(true);
    expect(playingLoops()).toHaveLength(1);
    sound.ambient(false);
    expect(playingLoops()).toHaveLength(0);
    expect(ambientLoop(1).pauseCalls).toBeGreaterThan(0);
  });

  test('all five methods no-op when Audio is undefined', () => {
    vi.stubGlobal('Audio', undefined as unknown as typeof Audio);
    expect(() => {
      sound.unlock();
      sound.ambient(true);
      sound.chime('step');
      sound.setVolume(0.7);
      sound.setEnabled(false);
      sound.setEnabled(true);
      sound.ambient(false);
    }).not.toThrow();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  test.each([
    { v: -1, expected: 0 },
    { v: NaN, expected: 0 },
    { v: 2, expected: 1 },
  ])('setVolume($v) clamps to $expected instead of throwing', ({ v, expected }) => {
    sound.unlock();
    sound.ambient(true);
    // FakeAudio.volume throws outside 0..1 like real Audio, so an
    // unclamped write would throw here.
    expect(() => sound.setVolume(v)).not.toThrow();
    expect(ambientLoop(1).volume).toBe(expected);
  });

  test('timeupdate near the end crossfades to the other loop over 30 steps', () => {
    vi.useFakeTimers();
    sound.unlock();
    sound.ambient(true);
    const first = ambientLoop(1);
    first.duration = 120;
    first.currentTime = 118.5; // Within the 3 s crossfade window.
    first.ontimeupdate?.();
    const second = ambientLoop(2);
    expect(second.playCalls).toBe(1);
    expect(second.volume).toBe(0);

    // Halfway through the 3 s fade both loops sit at half volume.
    vi.advanceTimersByTime(1500);
    expect(second.volume).toBeCloseTo(0.25, 5);
    expect(first.volume).toBeCloseTo(0.25, 5);
    expect(first.playing).toBe(true);

    // At the end the old loop pauses and the new one is at full volume.
    vi.advanceTimersByTime(1500);
    expect(second.volume).toBeCloseTo(0.5, 5);
    expect(second.playing).toBe(true);
    expect(first.playing).toBe(false);
    expect(first.pauseCalls).toBe(1);
  });

  test('onended falls back to the other loop when timeupdate never fires', () => {
    sound.unlock();
    sound.ambient(true);
    const first = ambientLoop(1);
    // No metadata, so no crossfade — only the ended fallback.
    expect(first.duration).toBeNaN();
    first.onended?.();
    const second = ambientLoop(2);
    expect(second.playCalls).toBe(1);
    expect(second.volume).toBeCloseTo(0.5, 5);
  });

  test('broken first loop advances to the second loop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      sound.unlock();
      sound.ambient(true);
      ambientLoop(1).onerror?.();
      const second = ambientLoop(2);
      expect(second.playCalls).toBe(1);
      expect(playingLoops()).toHaveLength(1);
      expect(playingLoops()[0]).toBe(second);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('stalled loop advances to the other loop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      sound.unlock();
      sound.ambient(true);
      ambientLoop(1).onstalled?.();
      expect(ambientLoop(2).playCalls).toBe(1);
      expect(playingLoops()).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('two broken loops stop with a warning instead of ping-ponging', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      sound.unlock();
      sound.ambient(true);
      const first = ambientLoop(1);
      first.onerror?.();
      const second = ambientLoop(2);
      expect(second.playCalls).toBe(1);
      second.onerror?.();
      expect(playingLoops()).toHaveLength(0);
      const playsAfterStop = totalPlayCalls();
      // Repeated errors must not restart playback or ping-pong.
      first.onerror?.();
      second.onerror?.();
      first.onstalled?.();
      second.onstalled?.();
      expect(totalPlayCalls()).toBe(playsAfterStop);
      expect(playingLoops()).toHaveLength(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

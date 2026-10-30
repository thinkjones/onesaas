import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { __resetSoundForTest, sound } from './sound.ts';

/** jsdom's Audio.play is unimplemented, so stand in a scripted double. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  volume = 1;
  loop = false;
  playCalls = 0;
  pauseCalls = 0;
  playing = false;
  onended: (() => void) | null = null;

  constructor(src?: string) {
    this.src = src ?? '';
    FakeAudio.instances.push(this);
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
  });
});

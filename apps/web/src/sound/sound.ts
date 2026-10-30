/**
 * Ambient sound and chimes for design mode. Plain HTMLAudioElement only —
 * no sound library.
 *
 * Two ambient loops alternate with a 3 s crossfade at `settings.sound.volume`;
 * chimes play at volume × 1.6, capped at 1. Nothing plays before `unlock()`
 * (first pointerdown anywhere), while disabled, or in runtime mode — the
 * DesignView only enables ambient while it is mounted.
 */

const AMBIENT_SRC = ['/sound/ambient-1.mp3', '/sound/ambient-2.mp3'];
const CHIME_SRC = { step: '/sound/chime-step.mp3', done: '/sound/chime-done.mp3' } as const;

/** Seconds of overlap when one ambient loop hands over to the next. */
const CROSSFADE_S = 3;

export type ChimeName = 'step' | 'done';

export interface Sound {
  /** Allow playback; called once on the first pointerdown anywhere. */
  unlock(): void;
  /** Start or stop the alternating ambient loops. */
  ambient(on: boolean): void;
  /** Play a one-shot chime. Silent before unlock or while disabled. */
  chime(name: ChimeName): void;
  /** Base volume 0–1; applied to live ambient loops immediately. */
  setVolume(v: number): void;
  setEnabled(on: boolean): void;
}

function canPlay(): boolean {
  return typeof Audio !== 'undefined';
}

/** `play()` rejects when the browser blocks it; that must never throw. */
function safePlay(el: HTMLAudioElement): void {
  try {
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  } catch {
    // play() itself can throw synchronously in some test doubles.
  }
}

function clampVolume(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

class SoundEngine implements Sound {
  private unlocked = false;
  private enabled = true;
  private volume = 0.5;
  /** Whether the ambient loops *should* be playing (design mode mounted). */
  private ambientOn = false;
  private loops: (HTMLAudioElement | null)[] = [null, null];
  private current = 0;
  private fading = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  /** Consecutive ambient load failures; bounds error recovery (see below). */
  private consecutiveAmbientErrors = 0;

  unlock(): void {
    this.unlocked = true;
    this.applyAmbient();
  }

  ambient(on: boolean): void {
    this.ambientOn = on;
    this.applyAmbient();
  }

  chime(name: ChimeName): void {
    if (!this.unlocked || !this.enabled || !canPlay()) return;
    const el = new Audio(CHIME_SRC[name]);
    el.volume = Math.min(1, this.volume * 1.6);
    safePlay(el);
  }

  setVolume(v: number): void {
    this.volume = clampVolume(v);
    for (const el of this.loops) {
      if (el && !this.fading) el.volume = this.volume;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyAmbient();
  }

  /** Test-only: pause everything and return to a fresh, locked state. */
  __reset(): void {
    this.stopFade();
    for (const el of this.loops) {
      if (el) {
        el.onended = null;
        el.ontimeupdate = null;
        el.onerror = null;
        el.onstalled = null;
        el.pause();
      }
    }
    this.loops = [null, null];
    this.unlocked = false;
    this.enabled = true;
    this.volume = 0.5;
    this.ambientOn = false;
    this.current = 0;
    this.consecutiveAmbientErrors = 0;
  }

  private applyAmbient(): void {
    if (this.ambientOn && this.unlocked && this.enabled && canPlay()) {
      this.startCurrent();
    } else {
      this.stopFade();
      for (const el of this.loops) {
        if (el) el.pause();
      }
    }
  }

  private loop(i: number): HTMLAudioElement {
    let el = this.loops[i];
    if (!el) {
      el = new Audio(AMBIENT_SRC[i]!);
      el.loop = false; // Loops alternate with a crossfade instead.
      el.ontimeupdate = () => this.maybeCrossfade(el!, i);
      // Fallback when timeupdate never fires within the window.
      el.onended = () => {
        if (!this.ambientOn || this.current !== i) return;
        this.consecutiveAmbientErrors = 0;
        this.startLoop(1 - i, false);
      };
      // Load failure (404/corrupt/codec) or a stalled network must not
      // leave silence behind a UI that claims sound is on.
      el.onerror = () => this.handleLoopError(i);
      el.onstalled = () => this.handleLoopError(i);
      this.loops[i] = el;
    }
    return el;
  }

  private startCurrent(): void {
    const el = this.loop(this.current);
    if (el.paused === false) return;
    el.volume = this.volume;
    safePlay(el);
  }

  private startLoop(i: number, fadeIn: boolean): void {
    this.current = i;
    const el = this.loop(i);
    el.volume = fadeIn ? 0 : this.volume;
    safePlay(el);
  }

  private maybeCrossfade(el: HTMLAudioElement, i: number): void {
    if (this.fading || !this.ambientOn || this.current !== i) return;
    const { duration, currentTime } = el;
    if (!Number.isFinite(duration)) return;
    // Any timeupdate with metadata proves the file loads.
    this.consecutiveAmbientErrors = 0;
    if (duration - currentTime > CROSSFADE_S) return;
    this.crossfade(i, 1 - i);
  }

  /**
   * Advance past a loop that failed to load or stalled. Bounded so two
   * broken files stop playback instead of ping-ponging forever; warns
   * once per failure sequence.
   */
  private handleLoopError(i: number): void {
    if (!this.ambientOn || this.current !== i) return;
    this.consecutiveAmbientErrors += 1;
    if (this.consecutiveAmbientErrors === 1) {
      console.warn(
        `[sound] ambient loop ${i + 1} failed to load; advancing to the other loop`,
      );
    }
    this.stopFade();
    if (this.consecutiveAmbientErrors >= AMBIENT_SRC.length) {
      for (const el of this.loops) {
        if (el) el.pause();
      }
      return;
    }
    // Silence the failed element so a recovering stall can't overlap.
    const failed = this.loops[i];
    if (failed) failed.pause();
    this.startLoop(1 - i, false);
  }

  private crossfade(from: number, to: number): void {
    const oldEl = this.loop(from);
    this.fading = true;
    this.startLoop(to, true);
    const newEl = this.loop(to);
    const steps = 30;
    let n = 0;
    this.stopFade();
    this.fadeTimer = setInterval(() => {
      n += 1;
      const t = Math.min(1, n / steps);
      newEl.volume = this.volume * t;
      oldEl.volume = this.volume * (1 - t);
      if (t >= 1) {
        this.stopFade();
        oldEl.pause();
        oldEl.volume = this.volume;
        newEl.volume = this.volume;
      }
    }, (CROSSFADE_S * 1000) / steps);
  }

  private stopFade(): void {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.fading = false;
  }
}

export const sound: Sound = new SoundEngine();

/** Test-only hook; not part of the public interface. */
export function __resetSoundForTest(): void {
  (sound as unknown as SoundEngine).__reset();
}

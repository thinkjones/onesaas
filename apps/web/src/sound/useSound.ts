import { useEffect } from 'react';
import { useSettings } from '../api.ts';
import { sound } from './sound.ts';

/**
 * Binds the sound engine to settings and the page.
 *
 * - Unlocks audio on the first pointerdown anywhere (browser autoplay rules).
 * - Mirrors `settings.sound` into the engine's enabled flag and volume.
 * - When `ambient` is true, plays the ambient loops until unmount.
 *
 * Call with `ambient` only from design mode: unmounting stops the loops, so
 * runtime mode stays silent.
 */
export function useSound(ambient: boolean): void {
  const { settings } = useSettings();

  useEffect(() => {
    const unlock = (): void => sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const on = settings?.sound.on;
  const volume = settings?.sound.volume;
  useEffect(() => {
    if (on === undefined || volume === undefined) return;
    sound.setEnabled(on);
    sound.setVolume(volume);
  }, [on, volume]);

  useEffect(() => {
    if (!ambient) return;
    sound.ambient(true);
    return () => sound.ambient(false);
  }, [ambient]);
}

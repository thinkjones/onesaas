import { Volume2, VolumeX } from 'lucide-react';
import { useSettings } from '../api.ts';
import AppButton from '../design/AppButton.tsx';

/**
 * Compact sound toggle for the design screen's top bar. The full sound
 * settings (toggle + volume) live on the Settings page; this just mutes and
 * unmutes the ambient loops and chimes. Renders nothing until settings load.
 */
export default function SoundControl() {
  const { settings, update } = useSettings();
  if (!settings) return null;
  const on = settings.sound.on;
  return (
    <AppButton
      variant="outline"
      aria-label={on ? 'Mute background sound' : 'Unmute background sound'}
      aria-pressed={on}
      title={on ? 'Mute background sound' : 'Unmute background sound'}
      onClick={() => update({ sound: { ...settings.sound, on: !on } })}
    >
      {on ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
    </AppButton>
  );
}

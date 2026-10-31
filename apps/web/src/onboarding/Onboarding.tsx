import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useEvents, useSettings } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import MoodBackdrop from '../mood/MoodBackdrop.tsx';
import { sound } from '../sound/sound.ts';
import { useSound } from '../sound/useSound.ts';
import type { UseVoiceResult } from '../voice/useVoice.ts';
import StepBusiness from './StepBusiness.tsx';
import StepConnect from './StepConnect.tsx';
import StepReframe from './StepReframe.tsx';
import StepWelcome from './StepWelcome.tsx';

/**
 * How long the reframe screen waits for the generated mood set before
 * settling on the bundled defaults. The swap still happens if the set lands
 * later — the timeout only ends the "Drawing your business…" shimmer. This
 * is real behavior (a live setTimeout), not a test artifact.
 */
export const MOOD_DRAW_TIMEOUT_MS = 20_000;

/**
 * M5 Task 5: the four-screen onboarding at /welcome. Screens 2–4 sit over the
 * mood backdrop (Dad's generated set once the `mood` event lands, else the
 * bundled defaults); the welcome screen has its own full-bleed image.
 */
export default function Onboarding({ useVoiceFn }: { useVoiceFn?: () => UseVoiceResult }) {
  const { settings, update } = useSettings();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  // Set when screen 2 fires POST /api/mood/generate.
  const [moodRequested, setMoodRequested] = useState(false);
  const [moodTimedOut, setMoodTimedOut] = useState(false);
  // Ids from a live `mood` event (beats the settings refetch, converges
  // with it via the App-level useLiveEvents invalidation).
  const [liveMoodIds, setLiveMoodIds] = useState<string[] | null>(null);

  // Mirror settings.sound into the engine (+ pointerdown unlock); ambient
  // itself starts on the welcome click, not on mount.
  useSound(false);
  useEffect(() => () => sound.ambient(false), []);
  useEvents((e) => {
    if (e.type === 'mood') setLiveMoodIds(e.fileIds);
  });
  useEffect(() => {
    if (!moodRequested) return;
    const timer = setTimeout(() => setMoodTimedOut(true), MOOD_DRAW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [moodRequested]);

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (settings.onboarded) return <Navigate to="/" replace />;

  const fileIds = liveMoodIds ?? settings.moodFileIds;
  const drawing = moodRequested && !moodTimedOut && fileIds.length === 0;

  const dots = (
    <div
      role="progressbar"
      aria-label="Onboarding progress"
      aria-valuenow={step + 1}
      aria-valuemin={1}
      aria-valuemax={4}
      className="flex items-center gap-2"
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          aria-hidden
          className={`h-2.5 w-2.5 rounded-full ${i === step ? 'bg-primary' : 'bg-muted-foreground/30'}`}
        />
      ))}
    </div>
  );

  if (step === 0) {
    return (
      <div className="relative">
        <div className="absolute inset-x-0 top-0 z-10 flex justify-center pt-6">{dots}</div>
        <StepWelcome onNext={() => setStep(1)} />
      </div>
    );
  }
  return (
    <div className="relative min-h-screen">
      <MoodBackdrop visible fileIds={fileIds} />
      <div className="relative">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 pt-6">
          <AppButton type="button" variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </AppButton>
          {dots}
        </div>
        {step === 1 && (
          <StepBusiness
            settings={settings}
            update={update}
            useVoiceFn={useVoiceFn}
            onNext={() => {
              setMoodRequested(true);
              setStep(2);
            }}
          />
        )}
        {step === 2 && <StepReframe drawing={drawing} onNext={() => setStep(3)} />}
        {step === 3 && (
          <StepConnect
            onFinish={() => {
              update({ onboarded: true });
              navigate('/');
            }}
          />
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { requestMoodGeneration, type Settings, type SettingsPatch } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import MicButton from '../voice/MicButton.tsx';
import type { UseVoiceResult } from '../voice/useVoice.ts';

const inputClass =
  'w-full rounded-md border border-input bg-background px-4 py-3 text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * M5 Task 5 screen 2: the business profile. Next saves the three fields and
 * fires POST /api/mood/generate so the reframe screen can draw Dad's own
 * business; generation is best-effort and never blocks onboarding.
 */
export default function StepBusiness({
  settings,
  update,
  onNext,
  useVoiceFn,
}: {
  settings: Settings;
  update(patch: SettingsPatch): void;
  onNext(): void;
  /** Test seam, passed through to the MicButton. */
  useVoiceFn?: () => UseVoiceResult;
}) {
  const [name, setName] = useState(settings.businessName ?? '');
  const [what, setWhat] = useState(settings.businessWhat ?? '');
  const [zone, setZone] = useState(
    () => settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="font-display text-4xl font-semibold">Your business</h1>
      <div className="mt-8 space-y-6">
        <div className="space-y-2">
          <label htmlFor="onboarding-business-name" className="text-lg font-medium">
            What&apos;s your business called?
          </label>
          <input
            id="onboarding-business-name"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Corner Hardware"
            autoComplete="organization"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="onboarding-business-what" className="text-lg font-medium">
            What do you do?
          </label>
          <div className="flex items-start gap-3">
            <input
              id="onboarding-business-what"
              className={inputClass}
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder="We run a family hardware store"
            />
            <div className="shrink-0">
              <MicButton
                useVoiceFn={useVoiceFn}
                onSend={(text) => setWhat((prev) => (prev ? `${prev} ${text}` : text))}
              />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="onboarding-timezone" className="text-lg font-medium">
            Timezone
          </label>
          <input
            id="onboarding-timezone"
            className={inputClass}
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            autoComplete="off"
          />
        </div>
        <AppButton
          type="button"
          className="w-full"
          onClick={() => {
            update({ businessName: name, businessWhat: what, timezone: zone });
            void requestMoodGeneration();
            onNext();
          }}
        >
          Next
        </AppButton>
      </div>
    </div>
  );
}

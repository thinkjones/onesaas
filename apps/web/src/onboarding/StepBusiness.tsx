import { detectVertical, VERTICAL_PACKS, type Vertical } from '@onesaas/shared';
import { useState } from 'react';
import type { Settings, SettingsPatch } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import MicButton from '../voice/MicButton.tsx';
import type { UseVoiceResult } from '../voice/useVoice.ts';
import { parseZone, zoneLabel } from './steps.ts';

// Who else a guess might be: the two nearest packs.
const NEAR: Record<Vertical, [Vertical, Vertical]> = {
  taxi: ['cleaning', 'landscaping'],
  plumber: ['appliance', 'landscaping'],
  appliance: ['plumber', 'cleaning'],
  florist: ['bakery', 'salon'],
  cleaning: ['landscaping', 'plumber'],
  salon: ['florist', 'cleaning'],
  landscaping: ['cleaning', 'plumber'],
  bakery: ['florist', 'salon'],
};

/**
 * The business profile. The save is awaited before moving on, but a failed save
 * never blocks setup (the mutation shows its own message).
 */
export default function StepBusiness({
  settings,
  updateAsync,
  onNext,
  footerStart,
  useVoiceFn,
}: {
  settings: Settings;
  updateAsync(patch: SettingsPatch): Promise<unknown>;
  onNext(): void;
  footerStart: React.ReactNode;
  /** Test seam, passed through to the MicButton. */
  useVoiceFn?: () => UseVoiceResult;
}) {
  const [name, setName] = useState(settings.businessName ?? '');
  const [what, setWhat] = useState(settings.businessWhat ?? '');
  const [zone] = useState(() => settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [zoneText, setZoneText] = useState(() => zoneLabel(zone));
  const [zoneError, setZoneError] = useState<string | null>(null);
  // undefined: go with the guess. null: "Something else".
  const [chosen, setChosen] = useState<string | null | undefined>(settings.vertical ?? undefined);

  const guess = detectVertical(what);
  const vertical = chosen === undefined ? guess : chosen;
  const anchor = (guess ?? (chosen && chosen in VERTICAL_PACKS ? (chosen as Vertical) : null)) as Vertical | null;
  const options = anchor === null ? [] : [anchor, ...NEAR[anchor]];

  const submit = async () => {
    const parsed = parseZone(zoneText, zone);
    if (parsed === null) {
      // The server discards a patch with an unknown zone wholesale, so stay put.
      setZoneError('I don\'t know that time zone. Try a city, like Los Angeles.');
      return;
    }
    setZoneError(null);
    try {
      await updateAsync({ businessName: name, businessWhat: what, timezone: parsed, vertical });
    } catch {
      // A failed save must never block setup.
    }
    onNext();
  };

  return (
    <>
      <div className="onb-field">
        <label htmlFor="onboarding-business-name">Business name</label>
        <input
          id="onboarding-business-name"
          className="onb-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Corner Hardware"
          autoComplete="organization"
        />
      </div>
      <div className="onb-field">
        <label htmlFor="onboarding-business-what">What you do</label>
        <div className="onb-input-row">
          <input
            id="onboarding-business-what"
            className="onb-input"
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder="We run a family hardware store"
          />
          <MicButton
            bare
            useVoiceFn={useVoiceFn}
            onSend={(text) => setWhat((prev) => (prev ? `${prev} ${text}` : text))}
          />
        </div>
        {what.trim() !== '' && (
          <div role="group" aria-label="Sounds like" className="onb-chips">
            <span className="onb-meta">Sounds like</span>
            {options.map((v) => (
              <button
                key={v}
                type="button"
                className="onb-chip"
                aria-pressed={vertical === v}
                onClick={() => setChosen(v)}
              >
                {VERTICAL_PACKS[v].label}
              </button>
            ))}
            <button
              type="button"
              className="onb-chip"
              aria-pressed={vertical === null}
              onClick={() => setChosen(null)}
            >
              Something else
            </button>
          </div>
        )}
      </div>
      <div className="onb-field">
        <label htmlFor="onboarding-timezone">Your time zone</label>
        <input
          id="onboarding-timezone"
          className="onb-input"
          value={zoneText}
          onChange={(e) => {
            setZoneText(e.target.value);
            setZoneError(null);
          }}
          autoComplete="off"
          aria-invalid={zoneError !== null}
          aria-describedby={zoneError !== null ? 'onboarding-timezone-error' : undefined}
        />
        {zoneError !== null && (
          <p id="onboarding-timezone-error" role="alert" className="m-0 text-destructive">
            {zoneError}
          </p>
        )}
      </div>
      <div className="onb-footer">
        {footerStart}
        <AppButton type="button" variant="brand" onClick={() => void submit()}>
          Looks good
        </AppButton>
      </div>
    </>
  );
}

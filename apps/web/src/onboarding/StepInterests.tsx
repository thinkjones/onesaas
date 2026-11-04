import { STARTER_IDEAS, POPULAR_IDEA_IDS, suggestedIdeaIds, VERTICAL_PACKS, type StarterStage, type Vertical } from '@onesaas/shared';
import Check from 'lucide-react/icons/check';
import { useState } from 'react';
import type { Settings, SettingsPatch } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import MicButton from '../voice/MicButton.tsx';
import type { UseVoiceResult } from '../voice/useVoice.ts';

const STAGE_GROUPS: { stage: StarterStage; label: string }[] = [
  { stage: 'paid', label: 'Getting paid' },
  { stage: 'keep', label: 'Keeping customers' },
  { stage: 'run', label: 'Running the shop' },
];

function verticalOf(settings: Settings): Vertical | null {
  return settings.vertical !== null && settings.vertical in VERTICAL_PACKS ? (settings.vertical as Vertical) : null;
}

/** Highlights only shape which ideas show first. Nothing gets built from them. */
export default function StepInterests({
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
  useVoiceFn?: () => UseVoiceResult;
}) {
  const vertical = verticalOf(settings);
  const [picked, setPicked] = useState<number[]>(() =>
    settings.interests.length > 0 ? settings.interests : vertical ? suggestedIdeaIds(vertical) : [],
  );
  const [note, setNote] = useState(settings.interestsNote);

  const topIds = vertical ? VERTICAL_PACKS[vertical].ideas : POPULAR_IDEA_IDS;
  const groups = [
    {
      label: vertical ? `Popular with ${VERTICAL_PACKS[vertical].owners} owners` : 'Popular with owners',
      ideas: topIds.map((id) => STARTER_IDEAS.find((idea) => idea.id === id)!),
    },
    ...STAGE_GROUPS.map(({ stage, label }) => ({
      label,
      ideas: STARTER_IDEAS.filter((idea) => idea.stage === stage && !topIds.includes(idea.id)),
    })),
  ].filter((group) => group.ideas.length > 0);

  const toggle = (id: number) =>
    setPicked((now) => (now.includes(id) ? now.filter((other) => other !== id) : [...now, id]));

  const submit = async () => {
    try {
      await updateAsync({ interests: picked, interestsNote: note.trim() });
    } catch {
      // A failed save must never block setup.
    }
    onNext();
  };

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="onb-tag-group">
          <h2 className="section-label m-0">{group.label}</h2>
          <div className="onb-tags">
            {group.ideas.map((idea) => {
              const on = picked.includes(idea.id);
              return (
                <button key={idea.id} type="button" className="onb-tag" aria-pressed={on} onClick={() => toggle(idea.id)}>
                  {on && <Check aria-hidden />}
                  {idea.tag}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="onb-field">
        <label htmlFor="onboarding-interests-note">Anything else? Say it in your own words</label>
        <div className="onb-input-row">
          <input
            id="onboarding-interests-note"
            className="onb-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <MicButton bare useVoiceFn={useVoiceFn} onSend={(text) => setNote((prev) => (prev ? `${prev} ${text}` : text))} />
        </div>
      </div>
      <div className="onb-footer">
        {footerStart}
        <span className="onb-footer-end">
          <span className="onb-meta">{picked.length} highlighted</span>
          <AppButton type="button" variant="brand" onClick={() => void submit()}>
            Next
          </AppButton>
        </span>
      </div>
    </>
  );
}

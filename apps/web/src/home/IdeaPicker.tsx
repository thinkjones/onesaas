import { ideasForOwner, POPULAR_IDEA_IDS, STAGE_LABEL, STARTER_IDEAS, type StarterIdea, type StarterStage } from '@onesaas/shared';
import { useState } from 'react';
import { useSettings } from '../api.ts';
import FlowPreview from './FlowPreview.tsx';

type Filter = 'for-you' | 'popular' | StarterStage;

const FOR_YOU_COUNT = 8;

const POPULAR = POPULAR_IDEA_IDS.map((id) => STARTER_IDEAS.find((idea) => idea.id === id)!);

const FILTERS: { id: Exclude<Filter, 'for-you'>; label: string }[] = [
  { id: 'popular', label: 'Popular' },
  ...(Object.keys(STAGE_LABEL) as StarterStage[]).map((id) => ({ id, label: STAGE_LABEL[id] })),
];

/** The playbook starters, by stage. Picking one only reports it: nothing builds. */
export default function IdeaPicker({
  selectedId,
  onPick,
}: {
  selectedId?: number;
  onPick: (idea: StarterIdea) => void;
}) {
  const { settings } = useSettings();
  // What setup learned about the owner comes first, when there's anything to go on.
  const interests = settings?.interests ?? [];
  const vertical = settings?.vertical ?? null;
  const personal = interests.length > 0 || vertical !== null;
  const forYou = personal ? ideasForOwner(interests, vertical).slice(0, FOR_YOU_COUNT) : [];
  const [picked, setFilter] = useState<Filter | null>(null);
  const filter = picked ?? (personal ? 'for-you' : 'popular');
  const ideasFor = (f: Filter): StarterIdea[] =>
    f === 'for-you' ? forYou : f === 'popular' ? POPULAR : STARTER_IDEAS.filter((idea) => idea.stage === f);
  const filters = personal ? [{ id: 'for-you' as const, label: 'For you' }, ...FILTERS] : FILTERS;
  return (
    <div className="idea-picker">
      <div className="idea-picker-head">
        <h3 className="section-label m-0">Or start from an idea</h3>
        <div role="group" aria-label="Filter ideas" className="idea-chips">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className="idea-chip"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label} · {ideasFor(f.id).length}
            </button>
          ))}
        </div>
      </div>
      <div className="idea-grid">
        {ideasFor(filter).map((idea) => (
          <button
            key={idea.id}
            type="button"
            className="idea-card"
            aria-pressed={selectedId === idea.id}
            onClick={() => onPick(idea)}
          >
            <FlowPreview steps={idea.steps} size="idea" />
            <span className="idea-title">{idea.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { POPULAR_IDEA_IDS, STAGE_LABEL, STARTER_IDEAS, type StarterIdea, type StarterStage } from '@dad/shared';
import { useState } from 'react';
import FlowPreview from './FlowPreview.tsx';

type Filter = 'popular' | StarterStage;

const POPULAR = POPULAR_IDEA_IDS.map((id) => STARTER_IDEAS.find((idea) => idea.id === id)!);

function ideasFor(filter: Filter): StarterIdea[] {
  return filter === 'popular' ? POPULAR : STARTER_IDEAS.filter((idea) => idea.stage === filter);
}

const FILTERS: { id: Filter; label: string }[] = [
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
  const [filter, setFilter] = useState<Filter>('popular');
  return (
    <div className="idea-picker">
      <div className="idea-picker-head">
        <h3 className="section-label m-0">Or start from an idea</h3>
        <div role="group" aria-label="Filter ideas" className="idea-chips">
          {FILTERS.map((f) => (
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

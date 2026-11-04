import { catalog, type StepKind } from '@onesaas/shared';
import { cn } from 'cn';
import { useEffect, useRef, useState } from 'react';
import { stepVisuals } from '../canvas/stepVisuals.ts';

const KINDS: { kind: StepKind; label: string }[] = [
  { kind: 'trigger', label: 'Add a start' },
  { kind: 'fetch', label: 'Add a read step' },
  { kind: 'enrich', label: 'Add a thinking step' },
  { kind: 'store', label: 'Add a save step' },
  { kind: 'act', label: 'Add an action' },
];

/** Design mode's add-a-step rail: pick a kind, then what it should do. */
export default function ToolRail({ onPick }: { onPick(type: string): void }) {
  const [open, setOpen] = useState<StepKind | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} role="group" aria-label="Add a step" className="tool-rail">
      <span className="py-1 text-center text-[0.647rem] font-bold text-muted-foreground">ADD</span>
      {KINDS.map(({ kind, label }) => {
        const { icon: Icon, tint } = stepVisuals[kind];
        return (
          <button
            key={kind}
            type="button"
            aria-label={label}
            title={label}
            aria-expanded={open === kind}
            className={cn(tint)}
            onClick={() => setOpen((o) => (o === kind ? null : kind))}
          >
            <Icon size={18} aria-hidden />
          </button>
        );
      })}
      {open !== null && (
        <div role="menu" aria-label={KINDS.find((k) => k.kind === open)?.label} className="flyout">
          {Object.values(catalog)
            .filter((def) => def.kind === open)
            .map((def) => (
              <button
                key={def.type}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(null);
                  onPick(def.type);
                }}
              >
                <span className="t">{def.title}</span>
                <span className="d">{def.description}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

import { catalog, type StepKind } from '@dad/shared';
import { cn } from 'cn';
import AppButton from './AppButton.tsx';

// Catalog kind → the drawer's plain-words group name (U+2026 ellipses, matching
// the app's "Working…" precedent). Order is the drawer's group order.
const KIND_GROUPS: { kind: StepKind; label: string }[] = [
  { kind: 'trigger', label: 'When…' },
  { kind: 'fetch', label: 'Get…' },
  { kind: 'enrich', label: 'Work out…' },
  { kind: 'store', label: 'Save…' },
  { kind: 'act', label: 'Do…' },
];

export interface StepPaletteProps {
  /** Catalog type to add; DesignView decides addStep vs setTrigger. */
  onAddStep(type: string): void;
  disabled?: boolean;
}

/**
 * The left "add a step" drawer: every catalog step grouped by kind under
 * plain-words headings, each showing its title and `description` (never the
 * type id). Clicking adds the step after the selected one (DesignView owns
 * the op and the selection). Trigger entries swap the trigger instead —
 * there is only ever one start box.
 */
export default function StepPalette({ onAddStep, disabled }: StepPaletteProps) {
  const byKind = new Map<StepKind, { type: string; title: string; description: string }[]>();
  for (const def of Object.values(catalog)) {
    const list = byKind.get(def.kind) ?? [];
    list.push({ type: def.type, title: def.title, description: def.description });
    byKind.set(def.kind, list);
  }
  return (
    <aside aria-label="Add a step" className="flex w-[280px] shrink-0 flex-col gap-5">
      {KIND_GROUPS.map(({ kind, label }) => {
        const defs = byKind.get(kind) ?? [];
        if (defs.length === 0) return null;
        return (
          <section key={kind} aria-label={label} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-muted-foreground">{label}</h2>
            {defs.map((def) => (
              <AppButton
                key={def.type}
                variant="outline"
                aria-label={def.title}
                aria-describedby={`palette-desc-${def.type}`}
                disabled={disabled}
                onClick={() => onAddStep(def.type)}
                className={cn('h-auto flex-col items-start gap-1 p-3 text-left whitespace-normal')}
              >
                <span className="text-base font-semibold">{def.title}</span>
                <span id={`palette-desc-${def.type}`} className="text-sm font-normal text-muted-foreground">
                  {def.description}
                </span>
              </AppButton>
            ))}
          </section>
        );
      })}
    </aside>
  );
}

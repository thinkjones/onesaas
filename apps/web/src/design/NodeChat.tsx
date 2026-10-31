import { catalog, type StepKind } from '@dad/shared';
import { useMemo, useRef, useState } from 'react';
import AppButton from '../design/AppButton.tsx';

/** The palette's kind groups (StepPalette was removed in Bug #4). */
const KIND_GROUPS: { kind: StepKind; label: string }[] = [
  { kind: 'trigger', label: 'When…' },
  { kind: 'fetch', label: 'Get…' },
  { kind: 'enrich', label: 'Work out…' },
  { kind: 'store', label: 'Save…' },
  { kind: 'act', label: 'Do…' },
];

export type ChatPick =
  | { kind: 'type'; type: string; title: string }
  | { kind: 'step'; stepId: string; title: string };

export interface ChatMsg {
  from: 'dad' | 'agent';
  text: string;
}

interface FlatOption {
  pick: ChatPick;
  group: string;
  title: string;
  summary: string;
}

export interface NodeChatProps {
  /** Title of the node this chat is anchored after. */
  anchorTitle: string;
  history: ChatMsg[];
  busy: boolean;
  /** Other steps in this reducer (the "things you have created" options). */
  siblings: { id: string; title: string }[];
  onSubmit(text: string, pick: ChatPick | undefined): void;
  onClose(): void;
}

/**
 * The per-node mini chat (Bug #4): a small box anchored at a canvas node.
 * Typing filters a dropdown of catalog node types (grouped When/Get/Work
 * out/Save/Do) plus the reducer's existing steps; picking one adds it
 * after this node, while free text goes to the agent with node context.
 * The exchange stays here as a small history; the RHS chat only logs
 * that this node is being designed.
 */
export default function NodeChat({
  anchorTitle,
  history,
  busy,
  siblings,
  onSubmit,
  onClose,
}: NodeChatProps) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const options = useMemo<FlatOption[]>(() => {
    const q = input.trim().toLowerCase();
    if (q.length === 0) return [];
    const out: FlatOption[] = [];
    for (const { kind, label } of KIND_GROUPS) {
      for (const [type, def] of Object.entries(catalog)) {
        if (def.kind !== kind) continue;
        const hay = `${def.title} ${def.description}`.toLowerCase();
        if (hay.includes(q)) out.push({ pick: { kind: 'type', type, title: def.title }, group: label, title: def.title, summary: def.description });
      }
    }
    for (const s of siblings) {
      if (s.title.toLowerCase().includes(q)) {
        out.push({
          pick: { kind: 'step', stepId: s.id, title: s.title },
          group: 'In this reducer',
          title: s.title,
          summary: 'Add a copy after this step',
        });
      }
    }
    return out;
  }, [input, siblings]);
  const showDropdown = open && options.length > 0;

  const submit = (text: string, pick: ChatPick | undefined) => {
    if (text.trim().length === 0 || busy) return;
    onSubmit(text.trim(), pick);
    setInput('');
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  };

  let lastGroup = '';
  return (
    <div
      className="nodrag nopan nowheel mt-2 w-70 rounded-[var(--radius)] border border-border bg-card p-3 text-left shadow-md"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">Designing after &ldquo;{anchorTitle}&rdquo;</p>
        <AppButton variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close node chat">
          ✕
        </AppButton>
      </div>
      {history.length > 0 && (
        <div className="mb-2 flex max-h-32 flex-col gap-1.5 overflow-y-auto" aria-live="polite">
          {history.map((m, i) => (
            <p
              key={i}
              className={`max-w-full text-sm break-words ${
                m.from === 'dad' ? 'self-end rounded-2xl rounded-br-sm bg-primary px-2.5 py-1 text-primary-foreground' : 'self-start text-muted-foreground'
              }`}
            >
              {m.text}
            </p>
          ))}
        </div>
      )}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input, showDropdown ? options[Math.min(active, options.length - 1)]!.pick : undefined);
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          aria-label={`Add after ${anchorTitle}`}
          aria-expanded={showDropdown}
          aria-activedescendant={showDropdown ? `nodechat-opt-${Math.min(active, options.length - 1)}` : undefined}
          role="combobox"
          aria-autocomplete="list"
          placeholder="Name a step type, or just describe it…"
          autoComplete="off"
          value={input}
          disabled={busy}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && showDropdown) {
              e.preventDefault();
              setActive((a) => (a + 1) % options.length);
            } else if (e.key === 'ArrowUp' && showDropdown) {
              e.preventDefault();
              setActive((a) => (a - 1 + options.length) % options.length);
            } else if (e.key === 'Escape') {
              if (open) setOpen(false);
              else onClose();
            }
          }}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
      </form>
      {showDropdown && (
        <ul role="listbox" aria-label="Matching steps" className="mt-1 max-h-44 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md">
          {options.map((o, i) => {
            const header = o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={`${o.group}-${o.title}`}>
                {header && (
                  <p role="presentation" className="px-2.5 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
                    {header}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  id={`nodechat-opt-${i}`}
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => submit(input, o.pick)}
                  className={`flex w-full flex-col px-2.5 py-1 text-left ${
                    i === active ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <span className="text-sm font-medium">{o.title}</span>
                  <span className="text-xs opacity-80">{o.summary}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

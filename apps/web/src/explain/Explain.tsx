import { useEffect, useState } from 'react';
import { postExplain, type ExplainTarget } from '../api.ts';
import AppButton from '../design/AppButton.tsx';
import {
  dispatchTellMeMore,
  tellMeMoreMessage,
  useAltClickExplain,
} from './useAltClickExplain.ts';

// "Explain anything" (M5 Task 6): a small `?` button opening a popover with
// the POST /api/explain text, plus "Tell me more", which sends
// "Tell me more about <label>" to the agent. Alt-clicking any
// [data-explain] element opens the same popover at the pointer (the global
// root is mounted once in App; the listener lives in useAltClickExplain.ts).
// The popover is a plain absolutely-positioned panel, not a Radix popover:
// alt-click needs pointer positioning anyway, and this stays test-friendly.

export interface ExplainPopoverProps {
  target: ExplainTarget;
  label: string;
  /** Test/placement seam; default dispatches TELL_ME_MORE_EVENT. */
  onTellMeMore?: (message: string) => void;
  onClose(): void;
}

/**
 * The shared popover body: fetches once on mount, then text + actions. A new
 * target must REMOUNT (callers pass key={target JSON}), never update props
 * in place — so there is no in-effect state reset to lint about.
 */
export function ExplainPopover({ target, label, onTellMeMore, onClose }: ExplainPopoverProps) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Stringified: the target is a fresh object per render, but its JSON is
  // stable — the effect must fetch once per mount, not per render.
  const key = JSON.stringify(target);
  useEffect(() => {
    let cancelled = false;
    postExplain(JSON.parse(key) as ExplainTarget).then(
      (res) => {
        if (!cancelled) setText(res.text);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const handleTellMeMore = (): void => {
    const message = tellMeMoreMessage(label);
    if (onTellMeMore) onTellMeMore(message);
    else dispatchTellMeMore(label);
  };

  return (
    <div
      role="dialog"
      aria-label={`About ${label}`}
      className="w-72 rounded-[var(--radius)] border border-border bg-card p-4 text-left shadow-lg"
    >
      {failed ? (
        <p role="alert" className="text-base text-destructive">
          Couldn&apos;t explain that. Try again.
        </p>
      ) : text === null ? (
        <p className="text-base text-muted-foreground">Finding out…</p>
      ) : (
        <p className="text-base">{text}</p>
      )}
      <div className="mt-3 flex gap-2">
        <AppButton onClick={handleTellMeMore}>Tell me more</AppButton>
        <AppButton variant="outline" onClick={onClose}>
          Close
        </AppButton>
      </div>
    </div>
  );
}

export interface ExplainProps {
  target: ExplainTarget;
  label: string;
  onTellMeMore?: (message: string) => void;
}

/**
 * The `?` button: 24 px visual in a 40 px hit area. The click stops
 * propagation (it lives inside clickable run rows and canvas cards) and
 * carries `nodrag` so ReactFlow never starts a drag from it.
 */
export default function Explain({ target, label, onTellMeMore }: ExplainProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`Explain ${label}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="nodrag flex size-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold"
        >
          ?
        </span>
      </button>
      {open && (
        <span className="absolute top-full left-0 z-50 mt-1">
          <ExplainPopover
            key={JSON.stringify(target)}
            target={target}
            label={label}
            onTellMeMore={onTellMeMore}
            onClose={() => setOpen(false)}
          />
        </span>
      )}
    </span>
  );
}

/** The floating alt-click popover; mounted once in App. */
export function AltClickExplainRoot({ onTellMeMore }: { onTellMeMore?: (message: string) => void }) {
  const { at, close } = useAltClickExplain();
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, close]);
  if (!at) return null;
  return (
    <div className="fixed z-[100]" style={{ left: at.x, top: at.y }}>
      <ExplainPopover
        key={`${at.x}:${at.y}:${JSON.stringify(at.target)}`}
        target={at.target}
        label={at.label}
        onTellMeMore={onTellMeMore}
        onClose={close}
      />
    </div>
  );
}

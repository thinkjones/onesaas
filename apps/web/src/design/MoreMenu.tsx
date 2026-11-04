import Ellipsis from 'lucide-react/icons/ellipsis';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../api.ts';

const ARM_MS = 5000;

/**
 * The bar's ⋯ menu: everything an automation can do that shouldn't sit in the
 * strip. Delete only lives here and still takes a second, explicit confirm.
 */
export default function MoreMenu({
  onRename,
  onCopy,
  onUnpublish,
  onDelete,
  deleting,
}: {
  onRename(): void;
  onCopy(): void;
  /** Present only while the automation is published. */
  onUnpublish?: () => void;
  onDelete(): void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const { settings, update } = useSettings();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const soundOn = settings?.sound.on ?? false;

  return (
    <div ref={root} className="more-menu">
      <button
        type="button"
        className="ic"
        aria-label="More: rename, copy, sound, delete"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ background: 'transparent', border: 0, boxShadow: 'none', padding: 0 }}
        onClick={() => {
          setArmed(false);
          setOpen((o) => !o);
        }}
      >
        <Ellipsis size={17} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="More">
          <button type="button" role="menuitem" onClick={run(onRename)}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={run(onCopy)}>
            Copy name and id
          </button>
          {settings && (
            <button
              type="button"
              role="menuitem"
              onClick={() => update({ sound: { ...settings.sound, on: !soundOn } })}
            >
              {soundOn ? 'Turn sound off' : 'Turn sound on'}
            </button>
          )}
          {onUnpublish && (
            <button type="button" role="menuitem" onClick={run(onUnpublish)}>
              Unpublish
            </button>
          )}
          <span className="rule" />
          <button
            type="button"
            role="menuitem"
            data-danger="true"
            disabled={deleting}
            onClick={armed ? run(onDelete) : () => setArmed(true)}
          >
            {armed ? 'Yes, delete' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}

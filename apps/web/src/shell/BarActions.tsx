import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BAR_SLOT_ID } from './barSlot.ts';

/**
 * Puts a screen's actions into the floating bar. Without a bar on the page
 * (a screen rendered on its own) they stay in place, so they're never lost.
 */
export default function BarActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the slot only exists after commit.
    setSlot(document.getElementById(BAR_SLOT_ID));
  }, []);
  return slot ? createPortal(children, slot) : <>{children}</>;
}

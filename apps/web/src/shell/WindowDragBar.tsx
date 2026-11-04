import GripHorizontal from 'lucide-react/icons/grip-horizontal';
import { isTauri } from '../api.ts';

/**
 * The desktop window has no title bar of its own, so its two top corners stand
 * in: the left one sits behind the window buttons, the right one holds the grip.
 * Browsers bring their own title bar.
 */
export default function WindowDragBar() {
  if (!isTauri()) return null;
  return (
    <>
      <div data-tauri-drag-region data-testid="window-drag-left" className="window-corner" data-side="left" />
      <div
        data-tauri-drag-region
        data-testid="window-drag-right"
        className="window-corner"
        data-side="right"
        title="Drag to move the window"
      >
        <GripHorizontal aria-hidden />
      </div>
    </>
  );
}

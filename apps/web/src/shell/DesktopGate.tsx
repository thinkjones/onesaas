import { useEffect, useState, type ReactNode } from 'react';

/** The owner is desktop: below this viewport width the app gates to a message. */
export const DESKTOP_MIN_WIDTH_PX = 1280;

export const GATE_MESSAGE = 'This works best on a bigger screen. Try a laptop or desktop.';

/**
 * Full-screen gate on narrow viewports (phones, small tablets). Follows
 * resizes so docking/undocking a monitor just works.
 */
export default function DesktopGate({
  children,
  allowNarrow = false,
}: {
  children: ReactNode;
  allowNarrow?: boolean;
}) {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  if (!allowNarrow && width < DESKTOP_MIN_WIDTH_PX) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 text-center">
        <p className="max-w-md text-xl">{GATE_MESSAGE}</p>
      </div>
    );
  }
  return <>{children}</>;
}

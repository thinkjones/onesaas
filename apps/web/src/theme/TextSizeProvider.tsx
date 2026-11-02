import { useEffect, type ReactNode } from 'react';
import { rootFontSize } from './sizing.ts';

export type TextSize = 'normal' | 'large' | 'xlarge';

interface TextSizeProviderProps {
  textSize: TextSize;
  children: ReactNode;
}

/**
 * Applies the stored text size to <html> (`data-text-size` + a pinned root
 * font size, so it never depends on stylesheet load order). Light/dark mode
 * is NOT handled here: the Craft system follows `prefers-color-scheme`
 * (see styles/tokens.css). Values arrive from `useSettings` (see App.tsx).
 */
export default function TextSizeProvider({ textSize, children }: TextSizeProviderProps) {
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.textSize = textSize;
    el.style.fontSize = `${rootFontSize(textSize)}px`;
  }, [textSize]);
  return <>{children}</>;
}

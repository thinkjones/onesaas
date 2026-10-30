import { useEffect, type ReactNode } from 'react';
import { rootFontSize } from './sizing.ts';
import './themes.css';

export type Theme = 'morning' | 'evening' | 'workshop';
export type TextSize = 'normal' | 'large' | 'xlarge';

interface ThemeProviderProps {
  theme: Theme;
  textSize: TextSize;
  children: ReactNode;
}

/**
 * Selects the token set (`data-theme`) and text size (`data-text-size`) on
 * `<html>`, and pins the root font size inline so it never depends on
 * stylesheet load order. Values arrive from `useSettings` (see App.tsx).
 */
export default function ThemeProvider({ theme, textSize, children }: ThemeProviderProps) {
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.dataset.textSize = textSize;
    el.style.fontSize = `${rootFontSize(theme, textSize)}px`;
  }, [theme, textSize]);
  return <>{children}</>;
}

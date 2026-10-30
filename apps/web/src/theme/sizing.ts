import type { TextSize, Theme } from './ThemeProvider.tsx';

/** Root font size: 17/19/21px by text size, and Workshop adds 3px. */
export function rootFontSize(theme: Theme, textSize: TextSize): number {
  const base = textSize === 'normal' ? 17 : textSize === 'large' ? 19 : 21;
  return base + (theme === 'workshop' ? 3 : 0);
}

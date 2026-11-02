import type { TextSize } from './TextSizeProvider.tsx';

/** Root font size: 17/19/21px by text size. */
export function rootFontSize(textSize: TextSize): number {
  return textSize === 'normal' ? 17 : textSize === 'large' ? 19 : 21;
}

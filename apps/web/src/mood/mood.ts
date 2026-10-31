/**
 * M5 Task 4 mood constants. They live here (not in MoodBackdrop.tsx) so the
 * component file exports components only.
 */

/** Bundled Muse Image defaults (businessWhat 'small family business'). */
export const DEFAULT_MOOD_IMAGES = [
  '/mood/default-1.jpg',
  '/mood/default-2.jpg',
  '/mood/default-3.jpg',
  '/mood/default-4.jpg',
];

/** Crossfade to the next image every 45 s (Global Constraints). */
export const MOOD_CROSSFADE_MS = 45_000;

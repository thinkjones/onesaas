import sharp from 'sharp';
import type { FileStore } from '../files/store.js';
import type { ImageModels } from '../models/image.js';
import type { SettingsStore } from '../settings/store.js';

// M5 Task 4: calm watercolor mood backgrounds drawn with Muse Image. One set
// is 4 scenes of the owner's business; the bundled defaults use
// DEFAULT_MOOD_BUSINESS_WHAT. Generation runs in the background (POST
// /api/mood/generate) and onboarding keeps the bundled images until a set
// lands — a failed generate degrades to the successes, never an error page.

/** businessWhat for the bundled default set (public/mood/default-*.jpg). */
export const DEFAULT_MOOD_BUSINESS_WHAT = 'small family business';

/** The fixed prompt template (plan-exact). */
export function moodPrompt(scene: string): string {
  return `Soft, calm watercolor illustration of ${scene}, gentle morning light, muted warm palette, lots of empty space, no text, no people's faces.`;
}

/** The 4 fixed scenes (plan-exact). */
export function moodScenes(businessWhat: string): string[] {
  return [
    `the inside of a ${businessWhat}`,
    `the front of a ${businessWhat} on a quiet street`,
    `the tools and materials of a ${businessWhat} on a workbench`,
    `a cup of coffee on the counter of a ${businessWhat}`,
  ];
}

async function mimeFor(bytes: Buffer): Promise<string> {
  try {
    const format = (await sharp(bytes).metadata()).format;
    if (format === 'jpeg') return 'image/jpeg';
    if (format === 'webp') return 'image/webp';
    if (format === 'gif') return 'image/gif';
    return 'image/png';
  } catch {
    return 'image/png';
  }
}

export interface MoodDeps {
  image: Pick<ImageModels, 'generate'>;
  files: FileStore;
  settings: SettingsStore;
}

/**
 * Generates the 4 mood images in parallel via `image.generate`, saves each
 * with source `mood`, stores the ids on `settings.moodFileIds`, and returns
 * them in scene order. A failed generate (or save) is skipped, so one
 * failure still stores the 3 that worked. When all 4 fail the stored set is
 * left untouched and returned, so the caller emits the stored value.
 */
export async function generateMoodSet(
  d: MoodDeps,
  o: { businessWhat: string },
): Promise<string[]> {
  const prompts = moodScenes(o.businessWhat).map(moodPrompt);
  const settled = await Promise.allSettled(
    prompts.map(async (prompt): Promise<string> => {
      const bytes = await d.image.generate({ prompt });
      const ref = await d.files.saveGenerated(bytes, await mimeFor(bytes), 'mood');
      return ref.fileId;
    }),
  );
  // allSettled preserves input order, so the survivors stay in scene order.
  const ids = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  // Total failure must not wipe a prior good set: keep the stored ids and
  // return them so the emitted event matches what is stored.
  if (ids.length === 0) return d.settings.get().moodFileIds;
  d.settings.update({ moodFileIds: ids });
  return ids;
}

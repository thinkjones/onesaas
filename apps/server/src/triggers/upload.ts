import { readFile } from 'node:fs/promises';
import { SAMPLE_FILE_ID } from '@dad/shared';
import type { FileStore } from '../files/store.js';

export { SAMPLE_FILE_ID };

// The upload trigger is driven by HTTP (POST /api/workflows/:id/upload in
// app.ts), not by the extension bridge, so unlike the email triggers this
// module registers nothing: it owns the bundled sample photo instead.
//
// The catalog sample for trigger.upload points at SAMPLE_FILE_ID, so "Try
// it" runs need these bytes in the store. index.ts awaits ensureSamplePhoto
// before listening (createServer stays synchronous for tests).
const SAMPLE_ASSET_URL = new URL('../../assets/sample-mug.jpg', import.meta.url);

/** Seed the bundled mug photo under the sample id; a no-op when present. */
export async function ensureSamplePhoto(files: FileStore): Promise<void> {
  try {
    await files.read(SAMPLE_FILE_ID);
    return;
  } catch {
    // Missing row or bytes: seed below.
  }
  const buf = Buffer.from(await readFile(SAMPLE_ASSET_URL));
  await files.saveUpload(buf, 'image/jpeg', { id: SAMPLE_FILE_ID });
}

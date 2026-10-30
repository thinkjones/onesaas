import { readFileSync } from 'node:fs';
import OpenAI from 'openai';
import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import { createImageModels } from '../src/models/image.js';

// Live API coverage for models/image.ts: exercises the real images.edit path
// and verifies the SAM metadata (include_confidence) is actually honored.
// Skipped without MODEL_API_KEY; never faked.
const LIVE = !!process.env['MODEL_API_KEY'];

function mugDataUrl(): string {
  const photo = readFileSync(new URL('../../../scripts/fixtures/mug.jpg', import.meta.url));
  return `data:image/jpeg;base64,${photo.toString('base64')}`;
}

describe.skipIf(!LIVE)('models/image live', () => {
  test(
    'segment() finds the mug with nonzero confidence',
    async () => {
      const apiKey = process.env['MODEL_API_KEY']!;
      const models = createImageModels({
        client: new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey }),
        fetch,
        apiKey,
      });
      const dataUrl = mugDataUrl();
      const { masks } = await models.segment({ imageDataUrl: dataUrl, prompt: 'mug' });
      expect(masks.length).toBeGreaterThan(0);
      // Metadata acceptance: include_confidence must yield real scores, not
      // zeros (zeros would silently demote best-pick to first-found).
      expect(masks.some((m) => m.score > 0)).toBe(true);
      // The mask must be photo-sized and parse as an image.
      const meta = await sharp(masks[0]!.maskPng).metadata();
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    },
    120000,
  );

  test(
    'edit() returns real image bytes',
    async () => {
      const apiKey = process.env['MODEL_API_KEY']!;
      const models = createImageModels({
        client: new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey }),
        fetch,
        apiKey,
      });
      const dataUrl = mugDataUrl();
      const out = await models.edit({ imageDataUrl: dataUrl, instruction: 'make the mug blue' });
      expect(out.length).toBeGreaterThan(1000);
      const meta = await sharp(out).metadata();
      expect(meta.format).toBeDefined();
    },
    120000,
  );
});

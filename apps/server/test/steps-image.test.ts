import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog, type FileRef } from '@dad/shared';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { openDb, type Database } from '../src/db/connection.js';
import { createRepo } from '../src/db/repo.js';
import { createFileStore, type FileStore } from '../src/files/store.js';
import type { Gateway } from '../src/models/gateway.js';
import type { ImageModels } from '../src/models/image.js';
import { executors, type StepContext } from '../src/steps/registry.js';
import { createTableStore } from '../src/tables/store.js';

// A 100x100 red square, generated in-test (no fixtures).
async function redSquare(): Promise<Buffer> {
  return sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

// A 100x100 single-channel mask PNG: white rect (x0,y0,w,h), black elsewhere.
async function maskWithRect(x0: number, y0: number, w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(100 * 100, 0);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) raw[y * 100 + x] = 255;
  }
  return sharp(raw, { raw: { width: 100, height: 100, channels: 1 } })
    .toColorspace('b-w')
    .png()
    .toBuffer();
}

describe('image steps', () => {
  let db: Database;
  let files: FileStore;
  let image: ImageModels;
  let ctx: StepContext;

  beforeEach(() => {
    db = openDb(':memory:');
    createRepo(db);
    files = createFileStore({ db, dir: mkdtempSync(join(tmpdir(), 'dad-image-')) });
    // The fake `image` models object: segment/generate/edit are spies the
    // tests program per case. Image steps never touch the chat gateway.
    image = { segment: vi.fn(), generate: vi.fn(), edit: vi.fn() };
    ctx = {
      gateway: {} as Gateway,
      tables: createTableStore(openDb(':memory:')),
      bridge: { call: vi.fn() },
      signal: new AbortController().signal,
      image,
      files,
    };
  });

  afterEach(() => {
    db.close();
  });

  test('image.cutout applies the mask and crops to the box', async () => {
    const ref = await files.saveUpload(await redSquare(), 'image/png');
    // Box [10,10,40,40] but the white mask rect is strictly INSIDE it, so
    // the crop corners must be transparent while the center stays opaque.
    vi.mocked(image.segment).mockResolvedValue({
      masks: [{ box: [10, 10, 40, 40], maskPng: await maskWithRect(20, 20, 20, 20), score: 0.9 }],
    });
    const result = await executors['image.cutout']!({ thing: 'mug' }, { file: ref }, ctx);
    expect(result.why).toBe('Cut the mug out of your photo.');
    expect(result.model).toBe('sam-3.1');

    const out = (result.output as { file: FileRef }).file;
    expect(out.mime).toBe('image/png');
    const { buf } = await files.read(out.fileId);
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(40);
    expect(meta.hasAlpha).toBe(true);
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    // Crop corner = original (10,10): outside the white rect -> alpha 0.
    expect(data[3]).toBe(0);
    // Crop center = original (30,30): inside the white rect -> opaque red.
    const center = (20 * 40 + 20) * 4;
    expect(Array.from(data.slice(center, center + 4))).toEqual([255, 0, 0, 255]);
  });

  test('image.cutout with no masks fails with the exact message', async () => {
    const ref = await files.saveUpload(await redSquare(), 'image/png');
    vi.mocked(image.segment).mockResolvedValue({ masks: [] });
    await expect(executors['image.cutout']!({ thing: 'mug' }, { file: ref }, ctx)).rejects.toThrow(
      "I couldn't find the mug in this photo. Try a clearer photo or a different word.",
    );
  });

  test('image.generate passes the cutout as a reference data URL via saveGenerated muse-image', async () => {
    const cutout = await files.saveUpload(await redSquare(), 'image/png');
    const made = await redSquare();
    vi.mocked(image.generate).mockResolvedValue(made);
    const result = await executors['image.generate']!(
      { style: 'bright, friendly Instagram post' },
      { text: 'a red mug', reference: cutout },
      ctx,
    );
    expect(result.why).toBe('Made a new picture: bright, friendly Instagram post.');
    expect(result.model).toBe('muse-image-1.0');

    expect(image.generate).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(image.generate).mock.calls[0]![0];
    expect(sent.references).toEqual([await files.dataUrl(cutout.fileId)]);

    const out = (result.output as { file: FileRef }).file;
    const row = db.prepare('SELECT source FROM files WHERE id = ?').get(out.fileId) as {
      source: string;
    };
    expect(row.source).toBe('muse-image');
  });

  test('image costs are recorded as 0.0025 and 0.01', async () => {
    const ref = await files.saveUpload(await redSquare(), 'image/png');
    vi.mocked(image.segment).mockResolvedValue({
      masks: [{ box: [0, 0, 100, 100], maskPng: await maskWithRect(0, 0, 100, 100), score: 1 }],
    });
    vi.mocked(image.generate).mockResolvedValue(await redSquare());
    vi.mocked(image.edit).mockResolvedValue(await redSquare());

    const cut = await executors['image.cutout']!({ thing: 'mug' }, { file: ref }, ctx);
    expect(cut.costUsd).toBe(0.0025);
    const gen = await executors['image.generate']!({ style: 'playful' }, { text: 'a mug' }, ctx);
    expect(gen.costUsd).toBe(0.01);
    const ed = await executors['image.edit']!(
      { instruction: 'make it blue' },
      { file: ref },
      ctx,
    );
    expect(ed.costUsd).toBe(0.01);
    expect(ed.model).toBe('muse-image-1.0');
  });

  test('catalog holds the three image steps as enrich', () => {
    for (const type of ['image.cutout', 'image.generate', 'image.edit']) {
      expect(catalog[type]?.kind).toBe('enrich');
      expect(executors[type]).toBeTypeOf('function');
    }
    expect(catalog['image.cutout']?.configSchema.safeParse({ thing: 'mug' }).success).toBe(true);
    expect(
      catalog['image.generate']?.inputSchema.safeParse({ text: 'hi' }).success,
    ).toBe(true);
    expect(
      catalog['image.edit']?.configSchema.safeParse({ instruction: 'do it' }).success,
    ).toBe(true);
  });
});

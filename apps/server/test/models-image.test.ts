import type OpenAI from 'openai';
import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createImageModels, type ImageModels } from '../src/models/image.js';

// Sabotage switch for the raster pipeline: when true, sharp's resize throws,
// simulating an operational failure inside rasterToPhotoMask (M1). Photo
// metadata and PNG encoding still use the real sharp.
const { sharpState } = vi.hoisted(() => ({ sharpState: { failResize: false } }));
vi.mock('sharp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sharp')>();
  const realSharp = actual.default;
  const mocked = (...args: unknown[]) => {
    const pipeline = (realSharp as (...a: unknown[]) => unknown)(...args) as {
      resize: (...a: never[]) => unknown;
    };
    if (sharpState.failResize) {
      pipeline.resize = () => {
        throw new Error('sharp resize failed (injected)');
      };
    }
    return pipeline;
  };
  return { ...actual, default: mocked };
});

const PHOTO = 100;

async function photoDataUrl(): Promise<string> {
  const bytes = await sharp({
    create: { width: PHOTO, height: PHOTO, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

// Valid one_bit payloads, precomputed once with the parser's own deterministic
// encoder (encodeSegmentationMask is internal-only, not exported by index):
// P10 = 10x10 all-ones; P20 = 20x20 with a centered 10x10 white square.
const P10 = "!!!!!'y:Htq(J";
const P20 = '!!!!!/B^$?h=+gaX!]]5$';

function maskToken(w: number, h: number, payload: string): string {
  return `<|mask;x=0;y=0;data=${h},${w},${payload};c=0.8|>`;
}

function boxToken(x1: number, y1: number, x2: number, y2: number, w: number, h: number): string {
  return `<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${w};h=${h};c=0.9|>`;
}

function samBody(text: string) {
  return { output: [{ content: [{ type: 'output_text', text }] }] };
}

function jsonFetch(body: string): ReturnType<typeof vi.fn> {
  return vi.fn(async () =>
    Response.json(samBody(body)),
  );
}

function testModels(fetchImpl: ReturnType<typeof vi.fn>): {
  models: ImageModels;
  client: { images: { generate: ReturnType<typeof vi.fn>; edit: ReturnType<typeof vi.fn> } };
} {
  const client = { images: { generate: vi.fn(), edit: vi.fn() } };
  const models = createImageModels({
    client: client as unknown as Pick<OpenAI, 'images'>,
    fetch: fetchImpl as unknown as typeof fetch,
    apiKey: 'test-key',
  });
  return { models, client };
}

afterEach(() => {
  sharpState.failResize = false;
});

describe('M1: mask-pipeline failures', () => {
  test('invalid mask payload still falls back to a box fill', async () => {
    // Corrupt payload: the parser pre-validation rejects it, leaving a
    // box-only record, so segment() must synthesize the cutout from the box.
    const text = `<0f>0${boxToken(10, 10, 29, 29, 100, 100)}<|mask;x=0;y=0;data=20,20,!x;c=0.8|>`;
    const { models } = testModels(jsonFetch(text));
    const { masks } = await models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' });
    expect(masks).toHaveLength(1);
    expect(masks[0]!.box).toEqual([10, 10, 20, 20]);
    // Box fill: every pixel inside the box is opaque in the photo-sized mask.
    const { data, info } = await sharp(masks[0]!.maskPng)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(PHOTO);
    expect(info.height).toBe(PHOTO);
    const px = (x: number, y: number): number => data[(y * PHOTO + x) * info.channels]!;
    expect(px(10, 10)).toBe(255);
    expect(px(29, 29)).toBe(255);
    expect(px(0, 0)).toBe(0);
    expect(px(9, 10)).toBe(0);
  });

  test('sharp failure in the raster pipeline throws instead of box-filling', async () => {
    // 10x10 raster over a 20x20 box forces the sharp resize path, which the
    // mock sabotages. Old behavior swallowed this into a box-fill success.
    const text = `<0f>0${boxToken(10, 10, 29, 29, 100, 100)}${maskToken(10, 10, P10)}`;
    const { models } = testModels(jsonFetch(text));
    sharpState.failResize = true;
    await expect(
      models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' }),
    ).rejects.toThrow('sharp resize failed (injected)');
  });
});

describe('M2: coordinate-frame mismatch', () => {
  test('box outside the photo frame throws instead of clamping silently', async () => {
    // Valid in the token frame (1000x1000) but the photo is 100x100: clamping
    // would cut the wrong region and report success.
    const text = `<0f>0${boxToken(100, 100, 199, 199, 1000, 1000)}<|mask;x=0;y=0;data=20,20,!x;c=0.8|>`;
    const { models } = testModels(jsonFetch(text));
    await expect(
      models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' }),
    ).rejects.toThrow('segmentation coordinates did not match this photo');
  });

  test('partially overlapping box (scaled frame) throws too', async () => {
    // A 2x-scale frame: box (90,90)-(119,119) in a 200x200 frame overlaps the
    // 100x100 photo but is not in photo pixels. The mask-record path must
    // throw as well, not stretch the raster into the clamped box.
    const text = `<0f>0${boxToken(90, 90, 119, 119, 200, 200)}${maskToken(10, 10, P10)}`;
    const { models } = testModels(jsonFetch(text));
    await expect(
      models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' }),
    ).rejects.toThrow('segmentation coordinates did not match this photo');
  });

  test('in-frame box still cuts out', async () => {
    const text = `<0f>0${boxToken(10, 10, 29, 29, 100, 100)}<|mask;x=0;y=0;data=20,20,!x;c=0.8|>`;
    const { models } = testModels(jsonFetch(text));
    const { masks } = await models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' });
    expect(masks).toHaveLength(1);
    expect(masks[0]!.box).toEqual([10, 10, 20, 20]);
  });
});

describe('M3: segment() grammar answers', () => {
  test('mask record cuts the precise mask and keeps its confidence', async () => {
    // 20x20 raster exactly covering the 20x20 box; the white square sits
    // strictly inside, so the box corners must stay transparent.
    const text = `<0f>0${boxToken(10, 10, 29, 29, 100, 100)}${maskToken(20, 20, P20)}`;
    const { models } = testModels(jsonFetch(text));
    const { masks } = await models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' });
    expect(masks).toHaveLength(1);
    expect(masks[0]!.box).toEqual([10, 10, 20, 20]);
    expect(masks[0]!.score).toBe(0.8);
    const { data, info } = await sharp(masks[0]!.maskPng)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number): number => data[(y * PHOTO + x) * info.channels]!;
    expect(px(10, 10)).toBe(0); // box corner, outside the white square
    expect(px(20, 20)).toBe(255); // center of the white square
    expect(px(0, 0)).toBe(0);
  });

  test('malformed grammar yields no masks', async () => {
    const { models } = testModels(jsonFetch('just some words, no grammar here'));
    const { masks } = await models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' });
    expect(masks).toEqual([]);
  });

  test('SAM HTTP error throws loud', async () => {
    const fetchImpl = vi.fn(async () => new Response('badness', { status: 500 }));
    const { models } = testModels(fetchImpl);
    await expect(
      models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' }),
    ).rejects.toThrow('SAM segmentation failed: HTTP 500');
  });

  test('unparseable SAM body throws loud', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not json{{{', { headers: { 'Content-Type': 'application/json' } }),
    );
    const { models } = testModels(fetchImpl);
    await expect(
      models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' }),
    ).rejects.toThrow();
  });

  test('invalid image data URL throws', async () => {
    const { models } = testModels(jsonFetch(''));
    await expect(models.segment({ imageDataUrl: 'nope', prompt: 'mug' })).rejects.toThrow(
      'Invalid image data URL',
    );
  });

  test('segment requests one_bit masks with confidence metadata', async () => {
    const fetchImpl = jsonFetch('nothing');
    const { models } = testModels(fetchImpl);
    await models.segment({ imageDataUrl: await photoDataUrl(), prompt: 'mug' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://api.meta.ai/v1/responses');
    const body = JSON.parse(init.body) as {
      model: string;
      metadata: Record<string, string>;
      input: unknown[];
    };
    expect(body.model).toBe('sam-3.1');
    expect(body.metadata).toEqual({ mask_encoding: 'one_bit', include_confidence: 'true' });
    expect(body.input).toHaveLength(1);
  });
});

describe('M3: generate()/edit() imageBytes branches', () => {
  test('generate without references uses images.generate b64_json', async () => {
    const { models, client } = testModels(jsonFetch(''));
    const bytes = Buffer.from('fake-png-bytes');
    client.images.generate.mockResolvedValue({ data: [{ b64_json: bytes.toString('base64') }] });
    const out = await models.generate({ prompt: 'a red mug' });
    expect(out).toEqual(bytes);
    expect(client.images.generate).toHaveBeenCalledTimes(1);
    expect(client.images.edit).not.toHaveBeenCalled();
  });

  test('generate with a reference routes to images.edit', async () => {
    const { models, client } = testModels(jsonFetch(''));
    const bytes = Buffer.from('fake-edit-bytes');
    client.images.edit.mockResolvedValue({ data: [{ b64_json: bytes.toString('base64') }] });
    const out = await models.generate({ prompt: 'make it pop', references: [await photoDataUrl()] });
    expect(out).toEqual(bytes);
    expect(client.images.edit).toHaveBeenCalledTimes(1);
    expect(client.images.generate).not.toHaveBeenCalled();
  });

  test('edit downloads the url branch via fetch', async () => {
    const imageBytes = Buffer.from('downloaded-bytes');
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://cdn.example.com/out.png');
      return new Response(imageBytes);
    });
    const { models, client } = testModels(fetchImpl);
    client.images.edit.mockResolvedValue({ data: [{ url: 'https://cdn.example.com/out.png' }] });
    const out = await models.edit({ imageDataUrl: await photoDataUrl(), instruction: 'make it blue' });
    expect(Buffer.from(out)).toEqual(imageBytes);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('failed image download throws loud', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const { models, client } = testModels(fetchImpl);
    client.images.edit.mockResolvedValue({ data: [{ url: 'https://cdn.example.com/out.png' }] });
    await expect(
      models.edit({ imageDataUrl: await photoDataUrl(), instruction: 'make it blue' }),
    ).rejects.toThrow('Generated image download failed: HTTP 500');
  });

  test('empty image response throws loud', async () => {
    const { models, client } = testModels(jsonFetch(''));
    client.images.edit.mockResolvedValue({ data: [] });
    await expect(
      models.edit({ imageDataUrl: await photoDataUrl(), instruction: 'make it blue' }),
    ).rejects.toThrow('Image generation returned no image data.');
  });
});

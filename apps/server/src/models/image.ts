import {
  decodeMaskToRaster,
  InvalidSegmentationMaskError,
  parseImageStream,
  recordsOfKind,
} from '@meta-sam/parser';
import type { ResponsesEvent } from '@meta-sam/parser';
import type OpenAI from 'openai';
import sharp from 'sharp';

// Image models: SAM 3.1 segmentation plus Muse Image generate/edit. Shapes
// follow scripts/smoke-models.ts (SAM request body, muse-image-1.0 response
// handling); the engine never calls this module directly — the image.step
// executors do, through StepContext.image.
//
// SAM answers in the special-token grammar documented at
// https://dev.meta.ai/docs/sam/reading-segmentation (`<0f>0<|box;...|><|mask;...|>`).
// Mask payloads are decoded with the official @meta-sam/parser (it reads the
// per-mask encoding marker, so `lossless` and `one_bit` both work); we ask
// for compact `one_bit` masks plus per-record confidence.

export const META_BASE_URL = 'https://api.meta.ai/v1';
const BASE_URL = META_BASE_URL;

export const SAM_MODEL = 'sam-3.1';
export const MUSE_IMAGE_MODEL = 'muse-image-1.0';

/**
 * One SAM match. Box is [left, top, width, height] in PHOTO pixels (the
 * executor feeds it straight to sharp's extract), already clamped to the
 * photo. maskPng is the match's alpha mask at photo size (white = object);
 * when a record carries no decodable mask it is synthesized by filling the
 * box, so cutout still works.
 */
export interface ImageMask {
  box: [number, number, number, number];
  maskPng: Buffer;
  score: number;
}

export interface ImageModels {
  segment(o: { imageDataUrl: string; prompt: string }): Promise<{ masks: ImageMask[] }>;
  generate(o: { prompt: string; references?: string[] }): Promise<Buffer>;
  edit(o: { imageDataUrl: string; instruction: string }): Promise<Buffer>;
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; mime: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Invalid image data URL.');
  return { mime: match[1]!, bytes: Buffer.from(match[2]!, 'base64') };
}

// The grammar text lives in message output_text parts. Walk the envelope for
// exactly those (the parser is strict: surrounding junk yields no records).
function extractOutputTexts(body: unknown): string | undefined {
  const output = (body as { output?: unknown }).output;
  if (!Array.isArray(output)) return undefined;
  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if ((part as { type?: unknown }).type === 'output_text') {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string') parts.push(text);
      }
    }
  }
  return parts.length > 0 ? parts.join('') : undefined;
}

// Fallback when the envelope shape drifts: every string anywhere, same walk
// as the smoke script. Usually too noisy to parse (which reads as no masks),
// but costs nothing to try.
function collectText(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'text' && typeof value === 'string') out.push(value);
      else collectText(value, out);
    }
  }
}

function fallbackTexts(body: unknown): string {
  const texts: string[] = [];
  collectText((body as { output?: unknown }).output ?? body, texts);
  return texts.join('\n');
}

function clampBox(
  left: number,
  top: number,
  right: number,
  bottom: number,
  width: number,
  height: number,
): [number, number, number, number] | undefined {
  const rl = Math.round(left);
  const rt = Math.round(top);
  const rr = Math.round(right);
  const rb = Math.round(bottom);
  const l = Math.min(Math.max(rl, 0), width - 1);
  const t = Math.min(Math.max(rt, 0), height - 1);
  const r = Math.min(Math.max(rr, l + 1), width);
  const b = Math.min(Math.max(rb, t + 1), height);
  // The parser validates boxes against the answer's own token frame, which
  // need not be photo pixels. Clamping a mismatched frame would cut the wrong
  // region and report success, so any clamp mutation throws loud instead.
  if (l !== rl || t !== rt || r !== rr || b !== rb) {
    throw new Error(
      `SAM segmentation coordinates did not match this photo (box [${rl},${rt},${rr},${rb}] vs photo ${width}x${height}).`,
    );
  }
  if (r - l < 1 || b - t < 1) return undefined;
  return [l, t, r - l, b - t];
}

async function boxFillMask(
  box: [number, number, number, number],
  width: number,
  height: number,
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height, 0);
  const [l, t, w, h] = box;
  for (let y = t; y < t + h; y++) {
    for (let x = l; x < l + w; x++) raw[y * width + x] = 255;
  }
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

// Paste the decoded raster (0/1 bytes covering `bounds` exactly) into a
// photo-sized alpha mask. A raster/bounds size mismatch is resized with
// nearest-neighbor so the binary mask stays binary.
async function rasterToPhotoMask(
  raster: Uint8Array,
  rasterWidth: number,
  rasterHeight: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  photoWidth: number,
  photoHeight: number,
): Promise<{ box: [number, number, number, number]; maskPng: Buffer } | undefined> {
  const box = clampBox(bounds.left, bounds.top, bounds.right, bounds.bottom, photoWidth, photoHeight);
  if (!box) return undefined;
  const [l, t, w, h] = box;
  let px: Uint8Array | Buffer = raster;
  let pw = rasterWidth;
  let ph = rasterHeight;
  if (pw !== w || ph !== h) {
    const grey = Buffer.from(raster).map((v) => (v ? 255 : 0));
    px = await sharp(grey, { raw: { width: pw, height: ph, channels: 1 } })
      .resize(w, h, { kernel: 'nearest' })
      .raw()
      .toBuffer();
    pw = w;
    ph = h;
  }
  const full = Buffer.alloc(photoWidth * photoHeight, 0);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (px[y * pw + x]) full[(t + y) * photoWidth + (l + x)] = 255;
    }
  }
  const maskPng = await sharp(full, { raw: { width: photoWidth, height: photoHeight, channels: 1 } })
    .png()
    .toBuffer();
  return { box, maskPng };
}

async function parseMasks(body: unknown, width: number, height: number): Promise<ImageMask[]> {
  // (const, not narrowed let: the event generator below closes over it.)
  const text = extractOutputTexts(body) ?? fallbackTexts(body);
  // The parser consumes a Responses event stream; replay the complete answer
  // as a single done event (non-streaming callers have no deltas to feed).
  async function* events(): AsyncGenerator<ResponsesEvent> {
    yield {
      type: 'response.output_text.done',
      text,
      item_id: 'msg_0',
      output_index: 0,
      content_index: 0,
    };
    yield { type: 'response.completed' };
  }
  let result;
  try {
    result = await parseImageStream(events()).finalResult;
  } catch (err) {
    throw new Error(
      `SAM segmentation returned an unreadable answer: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (result.outcome.status !== 'completed') return [];
  const masks: ImageMask[] = [];
  const maskedIds = new Set<string>();
  for (const record of recordsOfKind(result.records, 'mask')) {
    maskedIds.add(record.objectId);
    const score = record.confidence ?? 0;
    // Only a broken mask payload falls through to the box fill below. The
    // parser pre-validates payloads at parse time, so this ~never fires;
    // operational failures (sharp in the raster pipeline) must throw loud
    // rather than degrade silently into a rectangular cutout.
    let raster: Uint8Array | undefined;
    try {
      raster = decodeMaskToRaster(record.mask);
    } catch (err) {
      if (!(err instanceof InvalidSegmentationMaskError)) throw err;
    }
    if (raster) {
      const placed = await rasterToPhotoMask(
        raster,
        record.mask.width,
        record.mask.height,
        record.bounds,
        width,
        height,
      );
      if (placed) {
        masks.push({ box: placed.box, maskPng: placed.maskPng, score });
        continue;
      }
    }
    const box = clampBox(
      record.bounds.left,
      record.bounds.top,
      record.bounds.right,
      record.bounds.bottom,
      width,
      height,
    );
    if (box) masks.push({ box, maskPng: await boxFillMask(box, width, height), score });
  }
  // Box-only records (no mask token): the object was found, so cut its box.
  for (const record of recordsOfKind(result.records, 'box')) {
    if (maskedIds.has(record.objectId)) continue;
    const box = clampBox(record.left, record.top, record.right, record.bottom, width, height);
    if (box) {
      masks.push({ box, maskPng: await boxFillMask(box, width, height), score: record.confidence ?? 0 });
    }
  }
  // Best first; the executor also picks the max, so ties are harmless.
  masks.sort((a, b) => b.score - a.score);
  return masks;
}

export function createImageModels(d: {
  client: Pick<OpenAI, 'images'>;
  fetch: typeof fetch;
  apiKey: string;
}): ImageModels {
  // The muse-image-1.0 response shape, per the smoke script: b64_json inline
  // or a URL to download.
  async function imageBytes(res: OpenAI.Images.ImagesResponse): Promise<Buffer> {
    const first = res.data?.[0];
    if (first?.b64_json) return Buffer.from(first.b64_json, 'base64');
    if (first?.url) {
      const dl = await d.fetch(first.url);
      if (!dl.ok) throw new Error(`Generated image download failed: HTTP ${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
    throw new Error('Image generation returned no image data.');
  }

  function uploadFile(bytes: Buffer, mime: string, name: string): File {
    return new File([new Uint8Array(bytes)], name, { type: mime });
  }

  return {
    async segment(o: { imageDataUrl: string; prompt: string }): Promise<{ masks: ImageMask[] }> {
      const res = await d.fetch(`${BASE_URL}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${d.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: SAM_MODEL,
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                { type: 'input_text', text: o.prompt },
                { type: 'input_image', image_url: o.imageDataUrl },
              ],
            },
          ],
          // Compact one-bit masks (the parser reads each mask's own marker,
          // so a lossless answer still decodes) plus per-record confidence.
          metadata: { mask_encoding: 'one_bit', include_confidence: 'true' },
        }),
      });
      if (!res.ok) {
        throw new Error(`SAM segmentation failed: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const body: unknown = await res.json();
      const { bytes } = parseDataUrl(o.imageDataUrl);
      const meta = await sharp(bytes).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (!width || !height) return { masks: [] };
      return { masks: await parseMasks(body, width, height) };
    },

    async generate(o: { prompt: string; references?: string[] }): Promise<Buffer> {
      // A reference turns generation into an image edit grounded on it.
      if (o.references && o.references.length > 0) {
        const { bytes, mime } = parseDataUrl(o.references[0]!);
        const res = await d.client.images.edit({
          model: MUSE_IMAGE_MODEL,
          image: uploadFile(bytes, mime, 'reference.png'),
          prompt: o.prompt,
        });
        return imageBytes(res);
      }
      const res = await d.client.images.generate({ model: MUSE_IMAGE_MODEL, prompt: o.prompt });
      return imageBytes(res);
    },

    async edit(o: { imageDataUrl: string; instruction: string }): Promise<Buffer> {
      const { bytes, mime } = parseDataUrl(o.imageDataUrl);
      const res = await d.client.images.edit({
        model: MUSE_IMAGE_MODEL,
        image: uploadFile(bytes, mime, 'input.png'),
        prompt: o.instruction,
      });
      return imageBytes(res);
    },
  };
}

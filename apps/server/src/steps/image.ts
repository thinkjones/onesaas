import type { FileRef } from '@dad/shared';
import sharp from 'sharp';
import type { FileStore } from '../files/store.js';
import type { ImageModels } from '../models/image.js';
import { MUSE_IMAGE_MODEL, SAM_MODEL } from '../models/image.js';
import { callCostUsd } from '../models/pricing.js';
import type { Executor, StepContext } from './registry.js';

function deps(ctx: StepContext): { image: ImageModels; files: FileStore } {
  if (!ctx.image || !ctx.files) throw new Error('Image steps are not available on this server.');
  return { image: ctx.image, files: ctx.files };
}

// Mask -> alpha, cropped to the box. Two sharp 0.35 quirks (both probed, not
// guessed): removeAlpha in the SAME chain as joinChannel drops the joined
// band, and .extract() chained after .joinChannel() is silently ignored. So
// each stage is its own pipeline with a materialized buffer between them.
async function applyMask(
  original: Buffer,
  maskPng: Buffer,
  box: [number, number, number, number],
): Promise<Buffer> {
  const meta = await sharp(original).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("That doesn't look like a photo.");
  const maskSingle = await sharp(maskPng)
    .resize(width, height, { fit: 'fill' })
    .extractChannel(0)
    .toBuffer();
  const rgb = meta.hasAlpha ? await sharp(original).removeAlpha().toBuffer() : original;
  const joined = await sharp(rgb).joinChannel(maskSingle).png().toBuffer();
  const [left, top, w, h] = clampBox(box, width, height);
  return sharp(joined).extract({ left, top, width: w, height: h }).png().toBuffer();
}

function clampBox(
  box: [number, number, number, number],
  width: number,
  height: number,
): [number, number, number, number] {
  let [left, top, w, h] = box.map((n) => Math.round(n)) as [number, number, number, number];
  left = Math.min(Math.max(left, 0), width - 1);
  top = Math.min(Math.max(top, 0), height - 1);
  w = Math.min(Math.max(w, 1), width - left);
  h = Math.min(Math.max(h, 1), height - top);
  return [left, top, w, h];
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

export const cutoutExecutor: Executor = async (config, input, ctx) => {
  const { image, files } = deps(ctx);
  const thing = config.thing as string;
  const file = input.file as FileRef;
  const { buf, mime } = await files.read(file.fileId);
  const { masks } = await image.segment({
    imageDataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    prompt: thing,
  });
  if (masks.length === 0) {
    throw new Error(
      `I couldn't find the ${thing} in this photo. Try a clearer photo or a different word.`,
    );
  }
  const best = masks.reduce((a, b) => (b.score > a.score ? b : a));
  const cut = await applyMask(buf, best.maskPng, best.box);
  const ref = await files.saveGenerated(cut, 'image/png', 'cutout');
  return {
    output: { file: ref },
    why: `Cut the ${thing} out of your photo.`,
    model: SAM_MODEL,
    costUsd: callCostUsd(SAM_MODEL),
  };
};

export const generateExecutor: Executor = async (config, input, ctx) => {
  const { image, files } = deps(ctx);
  const style = config.style as string;
  const text = input.text as string | undefined;
  const reference = input.reference as FileRef | undefined;
  const references = reference ? [await files.dataUrl(reference.fileId)] : undefined;
  const prompt = text ? `${style}: ${text}` : style;
  const bytes = await image.generate({ prompt, references });
  const ref = await files.saveGenerated(bytes, await mimeFor(bytes), 'muse-image');
  return {
    output: { file: ref },
    why: `Made a new picture: ${style}.`,
    model: MUSE_IMAGE_MODEL,
    costUsd: callCostUsd(MUSE_IMAGE_MODEL),
  };
};

export const editExecutor: Executor = async (config, input, ctx) => {
  const { image, files } = deps(ctx);
  const instruction = config.instruction as string;
  const file = input.file as FileRef;
  const bytes = await image.edit({
    imageDataUrl: await files.dataUrl(file.fileId),
    instruction,
  });
  const ref = await files.saveGenerated(bytes, await mimeFor(bytes), 'muse-image');
  return {
    output: { file: ref },
    why: `Edited your photo: ${instruction}.`,
    model: MUSE_IMAGE_MODEL,
    costUsd: callCostUsd(MUSE_IMAGE_MODEL),
  };
};

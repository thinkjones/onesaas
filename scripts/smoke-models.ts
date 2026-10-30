/**
 * Model smoke test. Run with: pnpm tsx scripts/smoke-models.ts
 *
 * Prints one check/cross line per model (Spark, Wonder, Image, Image-edit,
 * SAM, Transcribe, Glimmer). Needs MODEL_API_KEY in the environment.
 * The SAM check sends the production metadata (one_bit masks + confidence)
 * and fails if the answer carries no nonzero confidence.
 * Glimmer needs GLIMMER_BASE_URL too, and prints "skipped" without it.
 * The SAM photo defaults to scripts/fixtures/mug.jpg; override with
 * SMOKE_PHOTO_PATH.
 *
 * Live-run notes (API shape differences vs the docs):
 * - Not yet run against the live API (no MODEL_API_KEY in this
 *   environment at implementation time). Fill in below when it runs.
 * - Per the docs, SAM returns special-token output_text with one
 *   `<|mask;...|>` token per match; this script counts those tokens.
 * - Per the docs, /v1/asr/transcribe takes a `sessionId` query param
 *   plus multipart `request` (JSON) and `audio` (WAV) parts, and
 *   returns `{ transcript, ... }`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';

const BASE_URL = 'https://api.meta.ai/v1';

// Run from the repo root: pnpm tsx scripts/smoke-models.ts
const rootDir = process.cwd();
const photoPath = process.env['SMOKE_PHOTO_PATH'] ?? join(rootDir, 'scripts', 'fixtures', 'mug.jpg');
const helloPath = join(rootDir, 'scripts', 'fixtures', 'hello.wav');

function fail(model: string, err: unknown): boolean {
  const detail = err instanceof Error ? err.message : String(err);
  console.log(`\u2717 ${model}: ${detail.split('\n')[0]}`);
  return false;
}

async function checkSpark(client: OpenAI): Promise<boolean> {
  try {
    const res = await client.chat.completions.create({
      model: 'muse-spark-1.3',
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    });
    const text = res.choices[0]?.message.content;
    if (!text) throw new Error('empty content');
    console.log(`\u2713 spark: ${JSON.stringify(text)}`);
    return true;
  } catch (err) {
    return fail('spark', err);
  }
}

async function checkWonder(client: OpenAI): Promise<boolean> {
  try {
    const res = await client.chat.completions.create({
      model: 'muse-wonder-1.0',
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    });
    const text = res.choices[0]?.message.content;
    if (!text) throw new Error('empty content');
    console.log(`\u2713 wonder: ${JSON.stringify(text)}`);
    return true;
  } catch (err) {
    return fail('wonder', err);
  }
}

async function imageResponseBytes(
  res: OpenAI.Images.ImagesResponse,
): Promise<{ bytes: Buffer; via: string }> {
  const first = res.data?.[0];
  if (first?.b64_json) return { bytes: Buffer.from(first.b64_json, 'base64'), via: 'b64_json' };
  if (first?.url) {
    const dl = await fetch(first.url);
    if (!dl.ok) throw new Error(`image download failed: HTTP ${dl.status}`);
    return { bytes: Buffer.from(await dl.arrayBuffer()), via: 'url' };
  }
  throw new Error('image response had neither b64_json nor url');
}

async function checkImage(client: OpenAI): Promise<boolean> {
  try {
    const res = await client.images.generate({
      model: 'muse-image-1.0',
      prompt: 'soft watercolor of a small shop counter at dawn',
    });
    const { bytes, via } = await imageResponseBytes(res);
    mkdirSync(join(rootDir, 'data'), { recursive: true });
    const outPath = join(rootDir, 'data', 'smoke-image.png');
    writeFileSync(outPath, bytes);
    console.log(`\u2713 image: wrote data/smoke-image.png (${bytes.length} bytes via ${via})`);
    return true;
  } catch (err) {
    return fail('image', err);
  }
}

async function checkImageEdit(client: OpenAI): Promise<boolean> {
  try {
    const photo = readFileSync(photoPath);
    const res = await client.images.edit({
      model: 'muse-image-1.0',
      image: new File([new Uint8Array(photo)], 'input.jpg', { type: 'image/jpeg' }),
      prompt: 'make the background a soft warm gradient, keep the subject unchanged',
    });
    const { bytes, via } = await imageResponseBytes(res);
    mkdirSync(join(rootDir, 'data'), { recursive: true });
    const outPath = join(rootDir, 'data', 'smoke-image-edit.png');
    writeFileSync(outPath, bytes);
    console.log(`\u2713 image-edit: wrote data/smoke-image-edit.png (${bytes.length} bytes via ${via})`);
    return true;
  } catch (err) {
    return fail('image-edit', err);
  }
}

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

async function checkSam(apiKey: string): Promise<boolean> {
  try {
    const photo = readFileSync(photoPath);
    const dataUrl = `data:image/jpeg;base64,${photo.toString('base64')}`;
    const res = await fetch(`${BASE_URL}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sam-3.1',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'mug' },
              { type: 'input_image', image_url: dataUrl },
            ],
          },
        ],
        // Mirror production (apps/server/src/models/image.ts): compact masks
        // plus per-record confidence. The acceptance check below fails if the
        // API ignores the confidence flag (all scores would read as 0 and
        // best-pick would silently degrade to first-found).
        metadata: { mask_encoding: 'one_bit', include_confidence: 'true' },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body: unknown = await res.json();
    const texts: string[] = [];
    collectText((body as { output?: unknown }).output ?? body, texts);
    const joined = texts.join('\n');
    const masks = (joined.match(/<\|mask;/g) ?? []).length;
    const confidences = [...joined.matchAll(/;c=([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/g)]
      .map((m) => Number(m[1]))
      .filter((c) => Number.isFinite(c) && c > 0);
    if (masks > 0 && confidences.length === 0) {
      throw new Error(
        `metadata ignored? ${masks} mask(s) but no nonzero ;c= confidence in the answer`,
      );
    }
    console.log(`\u2713 sam: ${masks} mask(s), ${confidences.length} nonzero confidence(s)`);
    return true;
  } catch (err) {
    return fail('sam', err);
  }
}

async function checkTranscribe(apiKey: string): Promise<boolean> {
  try {
    const audio = readFileSync(helloPath);
    const form = new FormData();
    form.append(
      'request',
      new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], {
        type: 'application/json',
      }),
    );
    form.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'hello.wav');
    const sessionId = `smoke-${Date.now()}`;
    const res = await fetch(`${BASE_URL}/asr/transcribe?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { transcript?: unknown };
    if (!body.transcript) throw new Error('empty content');
    console.log(`\u2713 transcribe: ${JSON.stringify(body.transcript)}`);
    return true;
  } catch (err) {
    return fail('transcribe', err);
  }
}

async function checkGlimmer(): Promise<boolean> {
  const baseURL = process.env['GLIMMER_BASE_URL'];
  if (!baseURL) {
    console.log('○ glimmer: skipped (GLIMMER_BASE_URL not set)');
    return true;
  }
  try {
    const client = new OpenAI({ baseURL, apiKey: process.env['MODEL_API_KEY'] ?? 'smoke' });
    const res = await client.chat.completions.create({
      model: 'muse-glimmer-1.0',
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    });
    const text = res.choices[0]?.message.content;
    if (!text) throw new Error('empty content');
    console.log(`\u2713 glimmer: ${JSON.stringify(text)}`);
    return true;
  } catch (err) {
    return fail('glimmer', err);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env['MODEL_API_KEY'];
  if (!apiKey) {
    console.log('\u2717 spark: MODEL_API_KEY not set');
    console.log('\u2717 wonder: MODEL_API_KEY not set');
    console.log('\u2717 image: MODEL_API_KEY not set');
    console.log('\u2717 image-edit: MODEL_API_KEY not set');
    console.log('\u2717 sam: MODEL_API_KEY not set');
    console.log('\u2717 transcribe: MODEL_API_KEY not set');
    await checkGlimmer();
    process.exitCode = 1;
    return;
  }
  const client = new OpenAI({ baseURL: BASE_URL, apiKey });
  const results = [
    await checkSpark(client),
    await checkWonder(client),
    await checkImage(client),
    await checkImageEdit(client),
    await checkSam(apiKey),
    await checkTranscribe(apiKey),
    await checkGlimmer(),
  ];
  if (results.includes(false)) process.exitCode = 1;
}

void main();

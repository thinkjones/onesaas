import { mkdtempSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb, type Database } from '../src/db/connection.js';
import { createRepo } from '../src/db/repo.js';
import { createFileStore, type FileStore } from '../src/files/store.js';
import type { ImageModels } from '../src/models/image.js';
import { generateMoodSet } from '../src/mood/generate.js';
import { createSettingsStore, type SettingsStore } from '../src/settings/store.js';

// M5 Task 4: mood images + design-mode backdrop (server half).

function testStores(): { db: Database; files: FileStore; settings: SettingsStore } {
  const db = openDb(':memory:');
  createRepo(db);
  const dir = mkdtempSync(join(tmpdir(), 'dad-mood-'));
  return { db, files: createFileStore({ db, dir }), settings: createSettingsStore(db) };
}

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 210, g: 190, b: 170 } },
  })
    .png()
    .toBuffer();
}

function fakeImage(impl: (o: { prompt: string }) => Promise<Buffer>): ImageModels {
  return { generate: vi.fn(impl) } as unknown as ImageModels;
}

describe('generateMoodSet', () => {
  let db: Database;
  let files: FileStore;
  let settings: SettingsStore;

  beforeEach(() => {
    ({ db, files, settings } = testStores());
  });

  afterEach(() => {
    db.close();
  });

  test('calls generate 4 times with prompts containing the business and "no text", and stores 4 ids', async () => {
    const prompts: string[] = [];
    const png = await tinyPng();
    const image = fakeImage(async (o) => {
      prompts.push(o.prompt);
      return png;
    });

    const ids = await generateMoodSet({ image, files, settings }, { businessWhat: 'hardware store' });

    expect(image.generate).toHaveBeenCalledTimes(4);
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      expect(prompt).toContain('hardware store');
      expect(prompt).toContain('no text');
    }
    // Distinct prompts (4 scenes) and distinct stored files.
    expect(new Set(prompts).size).toBe(4);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(settings.get().moodFileIds).toEqual(ids);
    for (const id of ids) {
      const { mime } = await files.read(id);
      expect(mime).toBe('image/png');
    }
  });

  test('one generate failure still stores the 3 that worked', async () => {
    const png = await tinyPng();
    let calls = 0;
    const image = fakeImage(async () => {
      calls += 1;
      if (calls === 2) throw new Error('image backend down');
      return png;
    });

    const ids = await generateMoodSet({ image, files, settings }, { businessWhat: 'bakery' });

    expect(image.generate).toHaveBeenCalledTimes(4);
    expect(ids).toHaveLength(3);
    expect(settings.get().moodFileIds).toEqual(ids);
  });

  test('all-4 failure preserves the prior stored set instead of wiping it', async () => {
    settings.update({ moodFileIds: ['old-1', 'old-2', 'old-3', 'old-4'] });
    const image = fakeImage(async () => {
      throw new Error('image backend down');
    });

    const ids = await generateMoodSet({ image, files, settings }, { businessWhat: 'bakery' });

    expect(image.generate).toHaveBeenCalledTimes(4);
    expect(ids).toEqual(['old-1', 'old-2', 'old-3', 'old-4']);
    expect(settings.get().moodFileIds).toEqual(['old-1', 'old-2', 'old-3', 'old-4']);
  });
});

describe('mood routes', () => {
  let db: Database;
  let files: FileStore;
  let settings: SettingsStore;

  beforeEach(() => {
    ({ db, files, settings } = testStores());
  });

  afterEach(() => {
    db.close();
  });

  test('GET /api/mood before any generation returns empty ids and generating false', async () => {
    const app = createApp({ files, appSettings: settings });
    const res = await app.request('/api/mood');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fileIds: [], generating: false });
  });

  test('POST /api/mood/generate returns 202 and the set lands on GET /api/mood', async () => {
    const png = await tinyPng();
    // A deferred generate so `generating: true` is observable mid-run.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const image = fakeImage(async () => {
      await gate;
      return png;
    });
    const events = new EventEmitter();
    const app = createApp({
      files,
      appSettings: settings,
      image,
      engine: { events } as never,
    });
    settings.update({ businessWhat: 'family hardware store' });

    const post = await app.request('/api/mood/generate', { method: 'POST' });
    expect(post.status).toBe(202);

    const mid = (await (await app.request('/api/mood')).json()) as {
      fileIds: string[];
      generating: boolean;
    };
    expect(mid.generating).toBe(true);

    release();
    // The background run settles asynchronously: poll for completion.
    let done = { fileIds: [] as string[], generating: true };
    for (let i = 0; i < 100; i++) {
      done = (await (await app.request('/api/mood')).json()) as typeof done;
      if (!done.generating) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(done.generating).toBe(false);
    expect(done.fileIds).toHaveLength(4);
  });

  test('a { type: mood, fileIds } event fires on the events bus when the run finishes', async () => {
    const png = await tinyPng();
    const image = fakeImage(async () => png);
    const events = new EventEmitter();
    const app = createApp({
      files,
      appSettings: settings,
      image,
      engine: { events } as never,
    });
    const seen = new Promise<unknown>((resolve) => {
      const onEvent = (e: unknown): void => {
        if (typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'mood') {
          events.off('event', onEvent);
          resolve(e);
        }
      };
      events.on('event', onEvent);
    });

    const post = await app.request('/api/mood/generate', { method: 'POST' });
    expect(post.status).toBe(202);
    const evt = (await seen) as { type: string; fileIds: string[] };
    expect(evt.type).toBe('mood');
    expect(evt.fileIds).toHaveLength(4);
  });
});

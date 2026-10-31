import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
// NOTE: the CLI lives at repo-root scripts/demo-reset.ts, but this test
// imports the implementation from src/demoReset.ts: tsc's rootDir forbids
// importing outside apps/server (TS6059), so the testable core lives in the
// package and the root script re-exports these same functions. The Step 4 dry
// run exercises the real root CLI end to end.
import { demoReset, isServerLive, saveDemoProfile } from '../src/demoReset.js';
import { openDb } from '../src/db/connection.js';
import { createRepo } from '../src/db/repo.js';
import { createFileStore } from '../src/files/store.js';
import { createServer } from '../src/main.js';
import { createSettingsStore } from '../src/settings/store.js';

// M5 Task 8: demo-reset against a temp data dir.
//
// Verification always re-opens the DB with openDb + createRepo directly, NEVER
// with createServer: the composition root seeds flow 1 into an empty store,
// so booting it would mask the "no workflows" assertion.

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'dad-demo-reset-'));
}

function dbFileFor(dataDir: string): string {
  return join(dataDir, 'app.db');
}

function filesDirFor(dataDir: string): string {
  return join(dataDir, 'files');
}

async function tinyJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 210, g: 190, b: 170 } },
  })
    .jpeg()
    .toBuffer();
}

/** Build a "lived-in" state: profile settings, one mood image, one extra workflow. */
async function seedLivedIn(dataDir: string): Promise<{ moodId: string }> {
  const dbFile = dbFileFor(dataDir);
  const filesDir = filesDirFor(dataDir);
  const { db, repo, files } = createServer({ dbFile, filesDir });
  const settings = createSettingsStore(db);
  try {
    settings.update({
      businessName: "Dad's Hardware",
      businessWhat: 'a family hardware store',
      timezone: 'America/New_York',
      theme: 'evening',
      textSize: 'large',
      sound: { on: true, volume: 0.25 },
      onboarded: true,
    });
    const ref = await files.saveUpload(await tinyJpeg(), 'image/jpeg', { id: 'mood-test-1' });
    settings.update({ moodFileIds: [ref.fileId] });
    repo.createWorkflow({ name: 'Lived-in flow 2', description: 'must not survive reset' });
    return { moodId: ref.fileId };
  } finally {
    db.close();
  }
}

function readFresh(dataDir: string): {
  settings: ReturnType<ReturnType<typeof createSettingsStore>['get']>;
  workflowIds: string[];
} {
  const db = openDb(dbFileFor(dataDir));
  try {
    const settings = createSettingsStore(db).get();
    const workflowIds = createRepo(db)
      .listWorkflows()
      .map((w) => w.id);
    return { settings, workflowIds };
  } finally {
    db.close();
  }
}

describe('saveDemoProfile + demoReset --keep-profile', () => {
  test('restores the saved profile and mood images with no workflows', async () => {
    const dataDir = makeDataDir();
    const { moodId } = await seedLivedIn(dataDir);

    await saveDemoProfile({ dataDir });
    expect(existsSync(join(dataDir, 'demo-profile.json'))).toBe(true);

    // Trash the live state so the restore has something to prove.
    {
      const db = openDb(dbFileFor(dataDir));
      try {
        createSettingsStore(db).update({ businessName: 'Trashed', theme: 'morning' });
      } finally {
        db.close();
      }
    }

    await demoReset({ dataDir, keepProfile: true, checkLive: false });

    const { settings, workflowIds } = readFresh(dataDir);
    expect(settings.businessName).toBe("Dad's Hardware");
    expect(settings.businessWhat).toBe('a family hardware store');
    expect(settings.timezone).toBe('America/New_York');
    expect(settings.theme).toBe('evening');
    expect(settings.textSize).toBe('large');
    expect(settings.onboarded).toBe(true);
    expect(settings.moodFileIds).toEqual([moodId]);
    expect(workflowIds).toEqual([]);

    // The mood image bytes survived the files/ wipe and are readable again.
    const db = openDb(dbFileFor(dataDir));
    try {
      const files = createFileStore({ db, dir: filesDirFor(dataDir) });
      const got = await files.read(moodId);
      expect(got.mime).toBe('image/jpeg');
      const meta = await sharp(got.buf).metadata();
      expect(meta.width).toBe(16);
      expect(meta.height).toBe(16);
    } finally {
      db.close();
    }
  });

  test('--with-flow1 seeds exactly flow 1; without it there are no workflows', async () => {
    const withFlow = makeDataDir();
    await demoReset({ dataDir: withFlow, withFlow1: true, checkLive: false });
    expect(readFresh(withFlow).workflowIds).toEqual(['flow-1']);

    const bare = makeDataDir();
    await demoReset({ dataDir: bare, checkLive: false });
    const fresh = readFresh(bare);
    expect(fresh.workflowIds).toEqual([]);
    // A bare reset is factory-default settings (profile untouched: none saved).
    expect(fresh.settings.businessName).toBeUndefined();
    expect(fresh.settings.theme).toBe('morning');
  });

  test('a bare reset wipes the db and files but leaves the rest of the data dir alone', async () => {
    const dataDir = makeDataDir();
    await seedLivedIn(dataDir);
    mkdirSync(filesDirFor(dataDir), { recursive: true });
    writeFileSync(join(filesDirFor(dataDir), 'junk.bin'), 'junk');
    writeFileSync(join(dataDir, 'operator-note.txt'), 'do not delete');

    await demoReset({ dataDir, checkLive: false });

    expect(readFresh(dataDir).workflowIds).toEqual([]);
    expect(existsSync(filesDirFor(dataDir))).toBe(true);
    expect(existsSync(join(filesDirFor(dataDir), 'junk.bin'))).toBe(false);
    expect(existsSync(join(dataDir, 'operator-note.txt'))).toBe(true);
  });

  test('--keep-profile with a missing demo-profile.json fails loudly and deletes nothing', async () => {
    const dataDir = makeDataDir();
    await seedLivedIn(dataDir);

    await expect(demoReset({ dataDir, keepProfile: true, checkLive: false })).rejects.toThrow(
      /demo-profile\.json/,
    );

    // The profile is validated BEFORE anything destructive runs.
    expect(existsSync(dbFileFor(dataDir))).toBe(true);
    const { settings, workflowIds } = readFresh(dataDir);
    expect(settings.businessName).toBe("Dad's Hardware");
    expect(workflowIds.length).toBeGreaterThan(0);
  });
});

describe('server-live safety', () => {
  test('isServerLive is true only when something accepts on the port', async () => {
    const server = createTcpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('no address');
    try {
      await expect(isServerLive('127.0.0.1', address.port)).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    await expect(isServerLive('127.0.0.1', address.port)).resolves.toBe(false);
  });

  test('demoReset refuses while the server port answers', async () => {
    const dataDir = makeDataDir();
    const server = createTcpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('no address');
    try {
      await expect(
        demoReset({ dataDir, port: address.port, checkLive: true }),
      ).rejects.toThrow(/server.*(live|running|stop)/i);
      expect(existsSync(dbFileFor(dataDir))).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

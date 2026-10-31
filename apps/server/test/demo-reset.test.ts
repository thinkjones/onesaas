import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, test, vi } from 'vitest';
// NOTE: the CLI entry is repo-root scripts/demo-reset.ts, but this test
// imports the implementation from src/demoReset.ts: tsc's rootDir forbids
// importing outside apps/server (TS6059), so the testable core — including
// runDemoResetCli, the argv parser the root wrapper forwards to — lives in the
// package. The Step 4 dry run exercises the real root CLI end to end.
import {
  demoReset,
  demoResetHelpText,
  isServerLive,
  runDemoResetCli,
  saveDemoProfile,
} from '../src/demoReset.js';
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

/** A loud failure must leave the lived-in state fully intact: db, settings,
 * workflows AND readable mood bytes. */
async function expectLivedInIntact(dataDir: string, moodId: string): Promise<void> {
  expect(existsSync(dbFileFor(dataDir))).toBe(true);
  const { settings, workflowIds } = readFresh(dataDir);
  expect(settings.businessName).toBe("Dad's Hardware");
  expect(workflowIds.length).toBeGreaterThan(0);
  const db = openDb(dbFileFor(dataDir));
  try {
    const files = createFileStore({ db, dir: filesDirFor(dataDir) });
    const got = await files.read(moodId);
    expect(got.mime).toBe('image/jpeg');
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
    const { moodId } = await seedLivedIn(dataDir);

    await expect(demoReset({ dataDir, keepProfile: true, checkLive: false })).rejects.toThrow(
      /demo-profile\.json/,
    );

    // The profile is validated BEFORE anything destructive runs.
    await expectLivedInIntact(dataDir, moodId);
  });
});

describe('corrupt demo profiles fail loudly and delete nothing', () => {
  // Each case mutates a freshly snapshotted valid profile (a string return
  // overwrites the file raw), then --keep-profile must reject while the
  // lived-in state survives untouched — mirroring the missing-profile test.
  const cases: Array<{ name: string; corrupt: (p: Record<string, any>) => unknown }> = [
    { name: 'bad JSON', corrupt: () => 'oops not json{{{' },
    { name: 'non-object JSON', corrupt: () => [1, 2, 3] },
    {
      name: 'wrong version',
      corrupt: (p) => ({ ...p, version: 999 }),
    },
    {
      name: 'settings not an object',
      corrupt: (p) => ({ ...p, settings: 'evening' }),
    },
    {
      name: 'bad theme',
      corrupt: (p) => ({ ...p, settings: { ...p.settings, theme: 'noon' } }),
    },
    {
      name: 'bad moodFileIds type',
      corrupt: (p) => ({ ...p, settings: { ...p.settings, moodFileIds: 'mood-test-1' } }),
    },
    {
      name: 'moodImages not an array',
      corrupt: (p) => ({ ...p, moodImages: {} }),
    },
    {
      name: 'mood image not referenced by settings',
      corrupt: (p) => ({
        ...p,
        moodImages: [{ ...p.moodImages[0], fileId: 'ghost-image' }],
      }),
    },
    {
      name: 'moodFileIds entry with no bytes',
      corrupt: (p) => ({
        ...p,
        settings: { ...p.settings, moodFileIds: [...p.settings.moodFileIds, 'ghost-id'] },
      }),
    },
    {
      name: 'mood image with non-image mime',
      corrupt: (p) => ({
        ...p,
        moodImages: [{ ...p.moodImages[0], mime: 'text/plain' }],
      }),
    },
    {
      name: 'mood image with invalid base64',
      corrupt: (p) => ({
        ...p,
        moodImages: [{ ...p.moodImages[0], dataBase64: '!!!not-base64!!!' }],
      }),
    },
    {
      name: 'scalar garbage: businessName',
      corrupt: (p) => ({ ...p, settings: { ...p.settings, businessName: 42 } }),
    },
    {
      name: 'scalar garbage: timezone',
      corrupt: (p) => ({ ...p, settings: { ...p.settings, timezone: 7 } }),
    },
    {
      name: 'scalar garbage: textSize',
      corrupt: (p) => ({ ...p, settings: { ...p.settings, textSize: 'huge' } }),
    },
    {
      name: 'scalar garbage: onboarded',
      corrupt: (p) => ({ ...p, settings: { ...p.settings, onboarded: 'yes' } }),
    },
    {
      name: 'scalar garbage: sound.volume',
      corrupt: (p) => ({
        ...p,
        settings: { ...p.settings, sound: { on: true, volume: 'loud' } },
      }),
    },
  ];

  test.each(cases)('$name', async ({ corrupt }) => {
    const dataDir = makeDataDir();
    const { moodId } = await seedLivedIn(dataDir);
    await saveDemoProfile({ dataDir });

    const profilePath = join(dataDir, 'demo-profile.json');
    const mutated = corrupt(JSON.parse(readFileSync(profilePath, 'utf8')));
    writeFileSync(profilePath, typeof mutated === 'string' ? mutated : JSON.stringify(mutated));

    await expect(demoReset({ dataDir, keepProfile: true, checkLive: false })).rejects.toThrow(
      /Cannot use/,
    );
    await expectLivedInIntact(dataDir, moodId);
  });
});

describe('runDemoResetCli argv validation', () => {
  // Drives the real argv parser the root wrapper forwards to (temp dirs only).
  test.each([['--keepprofile'], ['--data-dir=foo'], ['--keep_profile']])(
    'unknown flag %s exits 1 with usage and touches nothing',
    async (flag) => {
      const dataDir = makeDataDir();
      const { moodId } = await seedLivedIn(dataDir);
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(
          runDemoResetCli(['--data-dir', dataDir, flag], { checkLive: false }),
        ).resolves.toBe(1);
        expect(err.mock.calls.join('\n')).toMatch(/Usage:/);
      } finally {
        err.mockRestore();
      }
      await expectLivedInIntact(dataDir, moodId);
    },
  );

  // Unknown short flag, stray positional, and a trailing --data-dir with no value.
  test.each([[['-x']], [['oops']], [['--data-dir']]])(
    'stray token %s exits 1 without resetting',
    async (extra) => {
      const dataDir = makeDataDir();
      const { moodId } = await seedLivedIn(dataDir);
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(
          runDemoResetCli(['--data-dir', dataDir, ...extra], { checkLive: false }),
        ).resolves.toBe(1);
      } finally {
        err.mockRestore();
      }
      await expectLivedInIntact(dataDir, moodId);
    },
  );

  // A flag-like --data-dir value must not be swallowed: `--data-dir -h`
  // is a usage error (exit 1), never a help request or a wipe into a junk
  // `-h` dir; `--data-dir -x` likewise fails loudly per the unknown-short-
  // flag guarantee.
  test.each([[['-h']], [['-x']]])(
    '--data-dir %s exits 1 with usage and creates nothing',
    async (flagValue) => {
      const dataDir = makeDataDir();
      const { moodId } = await seedLivedIn(dataDir);
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(
          runDemoResetCli(['--data-dir', ...flagValue], { checkLive: false }),
        ).resolves.toBe(1);
        expect(err.mock.calls.join('\n')).toMatch(/--data-dir needs a directory argument/);
        expect(err.mock.calls.join('\n')).toMatch(/Usage:/);
      } finally {
        err.mockRestore();
      }
      await expectLivedInIntact(dataDir, moodId);
      for (const v of flagValue) {
        expect(existsSync(join(process.cwd(), v))).toBe(false);
      }
    },
  );

  test.each([
    [['--save-profile', '--keep-profile']],
    [['--save-profile', '--with-flow1']],
  ])('--save-profile combined with %s exits 1 and snapshots nothing', async (flags) => {
    const dataDir = makeDataDir();
    const { moodId } = await seedLivedIn(dataDir);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        runDemoResetCli(['--data-dir', dataDir, ...flags], { checkLive: false }),
      ).resolves.toBe(1);
      expect(err.mock.calls.join('\n')).toMatch(/cannot be combined/);
    } finally {
      err.mockRestore();
    }
    expect(existsSync(join(dataDir, 'demo-profile.json'))).toBe(false);
    await expectLivedInIntact(dataDir, moodId);
  });

  test.each([['--help'], ['-h']])('%s exits 0 and touches nothing', async (flag) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const untouched = join(makeDataDir(), 'never-created');
      await expect(runDemoResetCli(['--data-dir', untouched, flag])).resolves.toBe(0);
      expect(existsSync(untouched)).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  test('help documents itself and the exit-code contract', () => {
    expect(demoResetHelpText()).toMatch(/-h, --help/);
    expect(demoResetHelpText()).toMatch(/Exit codes: 0 on success, 1 on any failure/);
    expect(demoResetHelpText()).toMatch(/cannot be combined/);
  });

  test('bare reset through the CLI entry returns 0 with factory defaults', async () => {
    const dataDir = makeDataDir();
    await seedLivedIn(dataDir);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runDemoResetCli(['--data-dir', dataDir], { checkLive: false })).resolves.toBe(0);
    } finally {
      log.mockRestore();
    }
    const fresh = readFresh(dataDir);
    expect(fresh.workflowIds).toEqual([]);
    expect(fresh.settings.theme).toBe('morning');
  });

  test('--save-profile through the CLI entry snapshots and returns 0', async () => {
    const dataDir = makeDataDir();
    await seedLivedIn(dataDir);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        runDemoResetCli(['--data-dir', dataDir, '--save-profile'], { checkLive: false }),
      ).resolves.toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(existsSync(join(dataDir, 'demo-profile.json'))).toBe(true);
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

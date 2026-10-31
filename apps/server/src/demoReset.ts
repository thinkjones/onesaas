// Demo reset core: wipe local state back to a clean demo start. The CLI entry
// is repo-root scripts/demo-reset.ts (`pnpm demo:reset`): a thin wrapper that
// forwards argv to runDemoResetCli below and exits with its code. All logic
// lives HERE (not in the root script) because tsc's rootDir forbids
// apps/server/test from importing anything outside apps/server (TS6059),
// while vitest resolves it fine — so the testable core must be inside the
// package. The Step 4 dry run exercises the real root CLI end to end.
//
// Usage: pnpm demo:reset [--keep-profile] [--with-flow1] [--save-profile]
//   [--data-dir DIR]   (run with the server STOPPED; default data dir `data`)
//   --keep-profile  restore business profile, theme and mood images from
//                   data/demo-profile.json (fails loudly if it is missing)
//   --with-flow1    keep the M1 flow-1 seed; without it the fresh DB holds NO
//                   workflows (flows 2 and 4 are always built live in the demo)
//   --save-profile  snapshot the CURRENT data dir into demo-profile.json and
//                   exit without resetting (one-time setup before recording)
//
// data/demo-profile.json format (versioned, written by --save-profile):
//   { version: 1, settings: <full Settings doc incl. moodFileIds>,
//     moodImages: [{ fileId, mime, dataBase64 }] }
// Mood images are stored as base64 IN the profile: data/files/ is wiped by
// the reset, so bytes kept anywhere under files/ would not survive. The
// profile itself lives directly in data/ and the reset only ever deletes
// data/app.db* and data/files/, so it survives on disk untouched.
//
// Safety (three layers):
// 1. Live-server check: the codebase has no pidfile convention (index.ts just
//    serve()s), so the script connects to 127.0.0.1:PORT (PORT env or 8787)
//    and refuses when something answers. A TCP probe is the smallest robust
//    option: no new files to go stale, no operator discipline to forget.
// 2. The profile (when --keep-profile) is loaded AND validated before
//    anything is deleted, so a missing/corrupt profile leaves state intact.
// 3. Every deletion is resolved against the data dir and asserted to stay
//    inside it; nothing outside the data dir is ever touched.
//
// The wipe itself is sequential, not atomic: a crash mid-wipe can leave a
// half-reset data dir, and recovery is simply re-running the reset.
//
// The fresh DB is built by the real composition root (createServer), which is
// also the M1 seed path (flow1.json + customers table) — no second flow-1
// definition. Without --with-flow1 the auto-seeded flow 1 is removed again
// (DELETE on the workflows table: no deleteWorkflow API exists, and a demo
// script must not grow the shared Repo surface). Mood images are restored
// through the standard upload path (saveUpload with pinned ids).
//
// The exported functions take explicit paths/options and never touch
// process.exit, so test/demo-reset.test.ts can exercise them against a temp
// dir. Only the root CLI wrapper exits.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import { openDb } from './db/connection.js';
import { createFileStore } from './files/store.js';
import { createServer } from './main.js';
import { createSettingsStore, type Settings } from './settings/store.js';

export const DEMO_PROFILE_VERSION = 1;
export const DEMO_PROFILE_NAME = 'demo-profile.json';

export interface DemoMoodImage {
  fileId: string;
  mime: string;
  dataBase64: string;
}

export interface DemoProfile {
  version: number;
  settings: Settings;
  moodImages: DemoMoodImage[];
}

export interface DemoResetOptions {
  dataDir: string;
  keepProfile?: boolean;
  withFlow1?: boolean;
  /** TCP live-server check; the CLI leaves this on, tests pass false. */
  checkLive?: boolean;
  /** Override the probed port (default: PORT env or 8787). */
  port?: number;
}

/** True when something accepts TCP on host:port (the server looks live). */
export function isServerLive(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolveLive) => {
    const socket = connect({ host, port });
    const done = (live: boolean): void => {
      socket.destroy();
      resolveLive(live);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

function assertInside(dataDir: string, target: string): string {
  const root = resolve(dataDir) + sep;
  const resolved = resolve(target);
  if (resolved !== resolve(dataDir) && !resolved.startsWith(root)) {
    throw new Error(`Refusing to touch ${target}: outside the data dir ${dataDir}`);
  }
  return resolved;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isValidBase64(s: string): boolean {
  if (s.length === 0 || s.length % 4 !== 0) return false;
  try {
    return Buffer.from(s, 'base64').toString('base64') === s;
  } catch {
    return false;
  }
}

/** Parse + validate a demo profile; throws a loud error on any problem. */
export function parseDemoProfile(raw: string, source: string): DemoProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Cannot use ${source}: not valid JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`Cannot use ${source}: expected a JSON object`);
  if (parsed['version'] !== DEMO_PROFILE_VERSION) {
    throw new Error(
      `Cannot use ${source}: version ${String(parsed['version'])}, expected ${DEMO_PROFILE_VERSION}`,
    );
  }
  const settings = parsed['settings'];
  if (!isRecord(settings)) throw new Error(`Cannot use ${source}: settings must be an object`);
  // Theme allowlist mirrors the Theme union in settings/store.ts — update both
  // when adding a theme, or saved profiles using it become unloadable.
  if (
    settings['theme'] !== undefined &&
    settings['theme'] !== 'morning' &&
    settings['theme'] !== 'evening' &&
    settings['theme'] !== 'workshop'
  ) {
    throw new Error(`Cannot use ${source}: settings.theme is not a known theme`);
  }
  // Scalar fields fail loudly on wrong types: the settings store would silently
  // coerce garbage (businessName: 42) to defaults, hiding a corrupt profile.
  for (const key of ['businessName', 'businessWhat', 'timezone'] as const) {
    if (settings[key] !== undefined && typeof settings[key] !== 'string') {
      throw new Error(`Cannot use ${source}: settings.${key} must be a string`);
    }
  }
  // TextSize allowlist mirrors the TextSize union in settings/store.ts (same
  // rule as theme above).
  if (
    settings['textSize'] !== undefined &&
    settings['textSize'] !== 'normal' &&
    settings['textSize'] !== 'large' &&
    settings['textSize'] !== 'xlarge'
  ) {
    throw new Error(`Cannot use ${source}: settings.textSize is not a known text size`);
  }
  if (settings['onboarded'] !== undefined && typeof settings['onboarded'] !== 'boolean') {
    throw new Error(`Cannot use ${source}: settings.onboarded must be a boolean`);
  }
  const sound = settings['sound'];
  if (sound !== undefined) {
    if (!isRecord(sound)) throw new Error(`Cannot use ${source}: settings.sound must be an object`);
    if (sound['on'] !== undefined && typeof sound['on'] !== 'boolean') {
      throw new Error(`Cannot use ${source}: settings.sound.on must be a boolean`);
    }
    if (
      sound['volume'] !== undefined &&
      (typeof sound['volume'] !== 'number' || sound['volume'] < 0 || sound['volume'] > 1)
    ) {
      throw new Error(`Cannot use ${source}: settings.sound.volume must be a number 0..1`);
    }
  }
  if (
    settings['moodFileIds'] !== undefined &&
    (!Array.isArray(settings['moodFileIds']) ||
      !settings['moodFileIds'].every((id) => typeof id === 'string'))
  ) {
    throw new Error(`Cannot use ${source}: settings.moodFileIds must be a string array`);
  }
  const moodImages = parsed['moodImages'];
  if (!Array.isArray(moodImages)) {
    throw new Error(`Cannot use ${source}: moodImages must be an array`);
  }
  for (const img of moodImages) {
    if (
      !isRecord(img) ||
      typeof img['fileId'] !== 'string' ||
      img['fileId'].length === 0 ||
      typeof img['mime'] !== 'string' ||
      !img['mime'].startsWith('image/') ||
      typeof img['dataBase64'] !== 'string' ||
      !isValidBase64(img['dataBase64'])
    ) {
      throw new Error(
        `Cannot use ${source}: every mood image needs { fileId, image/* mime, valid dataBase64 }`,
      );
    }
  }
  const ids = new Set((settings['moodFileIds'] as string[] | undefined) ?? []);
  for (const img of moodImages as DemoMoodImage[]) {
    if (!ids.has(img.fileId)) {
      throw new Error(`Cannot use ${source}: mood image ${img.fileId} is not in settings.moodFileIds`);
    }
  }
  // Cross-check both directions: a moodFileIds entry with no bytes would
  // restore settings referencing nonexistent files (later 404s).
  const withBytes = new Set((moodImages as DemoMoodImage[]).map((img) => img.fileId));
  for (const id of ids) {
    if (!withBytes.has(id)) {
      throw new Error(
        `Cannot use ${source}: settings.moodFileIds entry ${id} has no image in moodImages`,
      );
    }
  }
  return parsed as unknown as DemoProfile;
}

/** Snapshot the current data dir's profile + mood bytes into demo-profile.json. */
export async function saveDemoProfile(o: { dataDir: string }): Promise<string> {
  const dbFile = assertInside(o.dataDir, join(o.dataDir, 'app.db'));
  const filesDir = assertInside(o.dataDir, join(o.dataDir, 'files'));
  const profilePath = assertInside(o.dataDir, join(o.dataDir, DEMO_PROFILE_NAME));
  if (!existsSync(dbFile)) {
    throw new Error(`Nothing to snapshot: no database at ${dbFile} (is this the data dir?)`);
  }
  const db = openDb(dbFile);
  try {
    const settings = createSettingsStore(db).get();
    const files = createFileStore({ db, dir: filesDir });
    const moodImages: DemoMoodImage[] = [];
    for (const fileId of settings.moodFileIds) {
      let buf: Buffer;
      let mime: string;
      try {
        ({ buf, mime } = await files.read(fileId));
      } catch {
        throw new Error(
          `Cannot snapshot: mood image ${fileId} has no readable bytes (re-generate moods first)`,
        );
      }
      moodImages.push({ fileId, mime, dataBase64: buf.toString('base64') });
    }
    const profile: DemoProfile = { version: DEMO_PROFILE_VERSION, settings, moodImages };
    mkdirSync(dirname(profilePath), { recursive: true });
    writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n');
    return profilePath;
  } finally {
    db.close();
  }
}

/** Delete app.db* + files/, rebuild a fresh DB, optionally restore the profile. */
export async function demoReset(o: DemoResetOptions): Promise<void> {
  const dataDir = resolve(o.dataDir);
  const dbFile = assertInside(dataDir, join(dataDir, 'app.db'));
  const filesDir = assertInside(dataDir, join(dataDir, 'files'));
  const profilePath = assertInside(dataDir, join(dataDir, DEMO_PROFILE_NAME));

  // Validate the profile BEFORE deleting anything: a missing/corrupt profile
  // must leave the current state untouched, never silently reset to blank.
  let profile: DemoProfile | undefined;
  if (o.keepProfile) {
    if (!existsSync(profilePath)) {
      throw new Error(
        `Cannot --keep-profile: ${profilePath} does not exist. ` +
          `Run "pnpm demo:reset --save-profile" first (with the demo profile set up), ` +
          `or reset without --keep-profile for a blank state.`,
      );
    }
    profile = parseDemoProfile(readFileSync(profilePath, 'utf8'), profilePath);
  }

  if (o.checkLive !== false) {
    const port = o.port ?? Number(process.env['PORT'] ?? 8787);
    if (await isServerLive('127.0.0.1', port)) {
      throw new Error(
        `The server looks live on 127.0.0.1:${port} — stop it first (demo:reset deletes the database out from under a running server).`,
      );
    }
  }

  rmSync(dbFile, { force: true });
  rmSync(`${dbFile}-wal`, { force: true });
  rmSync(`${dbFile}-shm`, { force: true });
  rmSync(filesDir, { recursive: true, force: true });
  // Leave the standard layout in place (the file store only mkdirs lazily).
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(filesDir, { recursive: true });

  // Fresh DB via the real composition root (DDL + M1 flow-1 seed + customers).
  const { db, files } = createServer({ dbFile, filesDir });
  try {
    if (!o.withFlow1) {
      db.prepare('DELETE FROM workflows WHERE id = ?').run('flow-1');
    }
    if (profile) {
      // Images first (pinned ids), then the settings doc that references them.
      // Restore re-encodes via saveUpload (saveGenerated takes no pinned id),
      // so byte drift per reset cycle is expected — never assert byte equality.
      for (const img of profile.moodImages) {
        await files.saveUpload(Buffer.from(img.dataBase64, 'base64'), img.mime, { id: img.fileId });
      }
      createSettingsStore(db).update(profile.settings);
    }
  } finally {
    db.close();
  }
}

export interface DemoResetCliOptions {
  /** TCP live-server check; the CLI leaves this on, tests pass false. */
  checkLive?: boolean;
  /** Override the probed port (default: PORT env or 8787). */
  port?: number;
}

/** The --help text (also printed to stderr after any usage error). */
export function demoResetHelpText(): string {
  return `Usage: pnpm demo:reset [--keep-profile] [--with-flow1] [--save-profile] [--data-dir DIR] [-h|--help]

  --keep-profile  restore business profile, theme and mood images from
                  <data-dir>/demo-profile.json (fails if it is missing)
  --with-flow1    keep the M1 flow-1 seed; otherwise the fresh DB has no
                  workflows (flows 2 and 4 are always built live)
  --save-profile  snapshot the current data dir to demo-profile.json and exit
                  (cannot be combined with --keep-profile or --with-flow1)
  --data-dir DIR  data dir (default: data)
  -h, --help      show this help and exit

Exit codes: 0 on success, 1 on any failure (bad flags, live server,
missing/corrupt profile, snapshot errors).

Run with the server stopped; the script refuses when 127.0.0.1:PORT answers.`;
}

export function printDemoResetHelp(): void {
  console.log(demoResetHelpText());
}

/** Print a usage error plus the help text; always maps to exit code 1. */
function usageError(message: string): number {
  console.error(`${message}\n\n${demoResetHelpText()}`);
  return 1;
}

/** Argv entry for `pnpm demo:reset`: parse argv strictly, run, return the
 * process exit code (0 ok / 1 any failure). Unknown flags and stray
 * positionals fail loudly with exit 1: silently ignoring a typoed
 * --keep-profile would wipe to a blank state instead of restoring. Only the
 * thin root wrapper maps the return value to process.exitCode. */
export async function runDemoResetCli(
  argv: string[],
  o: DemoResetCliOptions = {},
): Promise<number> {
  const args = new Set<string>();
  let dataDir = 'data';
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] as string;
    if (tok === '--data-dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        return usageError('--data-dir needs a directory argument');
      }
      dataDir = value;
      i++;
      continue;
    }
    if (
      tok === '--keep-profile' ||
      tok === '--with-flow1' ||
      tok === '--save-profile' ||
      tok === '--help' ||
      tok === '-h'
    ) {
      args.add(tok);
      continue;
    }
    return tok.startsWith('-')
      ? usageError(`Unknown flag ${tok}`)
      : usageError(`Unexpected argument ${tok}`);
  }
  if (args.has('--help') || args.has('-h')) {
    printDemoResetHelp();
    return 0;
  }
  // --save-profile snapshots and exits, so a sibling reset-mode flag could only
  // express a misunderstanding — reject loudly rather than silently dropping it.
  if (args.has('--save-profile') && (args.has('--keep-profile') || args.has('--with-flow1'))) {
    return usageError(
      '--save-profile snapshots and exits, so it cannot be combined with --keep-profile or --with-flow1',
    );
  }
  try {
    if (args.has('--save-profile')) {
      const saved = await saveDemoProfile({ dataDir });
      console.log(`Saved demo profile to ${saved}`);
      return 0;
    }
    await demoReset({
      dataDir,
      keepProfile: args.has('--keep-profile'),
      withFlow1: args.has('--with-flow1'),
      checkLive: o.checkLive,
      port: o.port,
    });
    console.log(
      `Demo reset complete (${resolve(dataDir)}): fresh database, ` +
        `${args.has('--keep-profile') ? 'profile restored' : 'blank settings'}, ` +
        `${args.has('--with-flow1') ? 'flow 1 seeded' : 'no workflows'}.`,
    );
    return 0;
  } catch (err) {
    console.error(`demo:reset failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

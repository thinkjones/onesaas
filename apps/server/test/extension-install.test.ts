import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { ExtensionUnavailable, installExtension } from '../src/extension/install.js';
import { createServer } from '../src/main.js';

function folderWithManifest(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ext-'));
  writeFileSync(join(dir, 'manifest.json'), version);
  mkdirSync(join(dir, 'chunks'));
  writeFileSync(join(dir, 'chunks', 'a.js'), version);
  return dir;
}

test('the desktop app copies the extension to the home folder, then shows it', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const show = vi.fn();
  const path = installExtension({ home, bundled: folderWithManifest('v1'), show });
  expect(path).toBe(join(home, 'OneSaaS Extension'));
  expect(readFileSync(join(path, 'chunks', 'a.js'), 'utf8')).toBe('v1');
  expect(show).toHaveBeenCalledWith(path);
});

test('getting it again updates the same folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const show = vi.fn();
  installExtension({ home, bundled: folderWithManifest('v1'), show });
  const path = installExtension({ home, bundled: folderWithManifest('v2'), show });
  expect(readFileSync(join(path, 'manifest.json'), 'utf8')).toBe('v2');
});

test('from source there is no copy: the build folder is used as it is', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const fromSource = folderWithManifest('v1');
  const path = installExtension({ home, bundled: join(home, 'nope'), fromSource, show: vi.fn() });
  expect(path).toBe(fromSource);
  expect(existsSync(join(home, 'OneSaaS Extension'))).toBe(false);
});

test('with no build anywhere it says so', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  expect(() => installExtension({ home, bundled: join(home, 'a'), fromSource: join(home, 'b'), show: vi.fn() })).toThrow(ExtensionUnavailable);
});

test('a plain cross-site form post cannot trigger it', async () => {
  const { app } = createServer({ dbFile: ':memory:' });
  const res = await app.request('/api/extension/install', { method: 'POST' });
  expect(res.status).toBe(415);
});

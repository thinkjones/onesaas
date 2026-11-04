// Bundles apps/server for the Tauri sidecar into src-tauri/resources/:
//   app/dist/server.mjs  esbuild ESM bundle (natives + ws external)
//   assets/              server disk assets (sample photo)
//   extension/           the built Chrome extension
//   node_modules/        native closure (sharp, better-sqlite3, ws + runtime deps)
// Plus node installed as src-tauri/bin/server-<triple>: shell().sidecar("server")
// spawns the node binary with app/dist/server.mjs as its arg.
// Layout note: app/dist/ depth preserves the server's
// new URL('../../assets/…', import.meta.url) with zero server changes.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'src-tauri', 'resources');
const require = createRequire(path.join(root, 'package.json'));
const esbuildBin = path.join(
  path.dirname(require.resolve('esbuild/package.json')),
  'bin',
  'esbuild',
);

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'app', 'dist'), { recursive: true });

execFileSync(
  esbuildBin,
  [
    path.join(root, 'apps', 'server', 'src', 'index.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--external:better-sqlite3',
    '--external:sharp',
    '--external:ws',
    `--outfile=${path.join(out, 'app', 'dist', 'server.mjs')}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);

cpSync(path.join(root, 'apps', 'server', 'assets'), path.join(out, 'assets'), {
  recursive: true,
});

// The built Chrome extension, for setup to copy somewhere Chrome can load it from.
cpSync(path.join(root, 'apps', 'extension', '.output', 'chrome-mv3'), path.join(out, 'extension'), {
  recursive: true,
});

// Native closure: resolve from the REALPATH (pnpm symlinks break sibling
// resolution); @img platform packs have no main entry (resolve from sharp's
// sibling dir).
const sharpReal = realpathSync(
  path.join(root, 'apps', 'server', 'node_modules', 'sharp', 'package.json'),
);
const req = createRequire(sharpReal);
function pkgDir(name) {
  let dir = path.dirname(req.resolve(name));
  while (!existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return dir;
}
for (const name of [
  'sharp',
  'better-sqlite3',
  'detect-libc',
  'semver',
  '@img/colour',
  'node-addon-api',
  'ws',
]) {
  cpSync(pkgDir(name), path.join(out, 'node_modules', name), { recursive: true });
}
const sharpSibs = path.dirname(pkgDir('sharp'));
const tripleShort = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
for (const name of [`@img/sharp-${tripleShort}`, `@img/sharp-libvips-${tripleShort}`]) {
  const src = path.join(sharpSibs, ...name.split('/'));
  if (!existsSync(path.join(src, 'package.json'))) throw new Error(`missing ${src}`);
  cpSync(src, path.join(out, 'node_modules', name), { recursive: true });
}
// Tauri sidecars live in src-tauri/bin/<name>-<triple>; install node AS the
// sidecar binary so shell().sidecar("server") spawns it.
const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
const binDir = path.join(root, 'src-tauri', 'bin');
mkdirSync(binDir, { recursive: true });
cpSync(process.execPath, path.join(binDir, `server-${triple}`));
chmodSync(path.join(binDir, `server-${triple}`), 0o755);

for (const f of [
  'app/dist/server.mjs',
  'node_modules/better-sqlite3',
  'node_modules/sharp',
  'node_modules/ws',
  'assets/sample-mug.jpg',
  'extension/manifest.json',
]) {
  if (!existsSync(path.join(out, f))) throw new Error(`missing sidecar output: ${f}`);
}
console.log('desktop server staged in', out);

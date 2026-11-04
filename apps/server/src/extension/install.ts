import { execFile } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// In the desktop app this file is bundled to resources/app/dist/server.mjs, with
// the extension beside it at resources/extension.
const BUNDLED = fileURLToPath(new URL('../../extension', import.meta.url));
// Run from source, apps/extension's own build is already a normal folder.
const FROM_SOURCE = fileURLToPath(new URL('../../../extension/.output/chrome-mv3', import.meta.url));

export class ExtensionUnavailable extends Error {}

function reveal(folder: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  // Showing the folder is a nicety: the path is on screen either way.
  execFile(opener, [folder], () => {});
}

/**
 * Puts the Chrome extension somewhere Chrome's folder picker can reach, and
 * returns where. Chrome can't easily browse inside an .app, so the desktop app
 * copies it out: into the home folder, because Documents would need a permission
 * prompt. Copying again updates it in place, so Chrome keeps loading the same folder.
 */
export function installExtension(opts?: {
  home?: string;
  bundled?: string;
  fromSource?: string;
  show?: (folder: string) => void;
}): string {
  const bundled = opts?.bundled ?? BUNDLED;
  const fromSource = opts?.fromSource ?? FROM_SOURCE;
  const show = opts?.show ?? reveal;
  if (existsSync(join(bundled, 'manifest.json'))) {
    const folder = join(opts?.home ?? homedir(), 'OneSaaS Extension');
    cpSync(bundled, folder, { recursive: true, force: true });
    show(folder);
    return folder;
  }
  if (existsSync(join(fromSource, 'manifest.json'))) {
    show(fromSource);
    return fromSource;
  }
  throw new ExtensionUnavailable("I can't find the extension. Run pnpm start to build it.");
}

// CLI wrapper for `pnpm demo:reset`. The importable implementation lives in
// apps/server/src/demoReset.ts (format, safety and design documented there);
// this file only parses argv and exits. Importing this module never exits.
import { resolve } from 'node:path';
import {
  demoReset,
  saveDemoProfile,
  type DemoProfile,
  type DemoResetOptions,
} from '../apps/server/src/demoReset.js';

export { demoReset, saveDemoProfile };
export type { DemoProfile, DemoResetOptions };

function printHelp(): void {
  console.log(`Usage: pnpm demo:reset [--keep-profile] [--with-flow1] [--save-profile] [--data-dir DIR]

  --keep-profile  restore business profile, theme and mood images from
                  <data-dir>/demo-profile.json (fails if it is missing)
  --with-flow1    keep the M1 flow-1 seed; otherwise the fresh DB has no
                  workflows (flows 2 and 4 are always built live)
  --save-profile  snapshot the current data dir to demo-profile.json and exit
  --data-dir DIR  data dir (default: data)

Run with the server stopped; the script refuses when 127.0.0.1:PORT answers.`);
}

async function cli(argv: string[]): Promise<number> {
  const args = new Set(argv);
  let dataDir = 'data';
  const dirFlag = argv.indexOf('--data-dir');
  if (dirFlag !== -1) {
    const value = argv[dirFlag + 1];
    if (!value || value.startsWith('--')) {
      console.error('--data-dir needs a directory argument');
      return 1;
    }
    dataDir = value;
  }
  if (args.has('--help') || args.has('-h')) {
    printHelp();
    return 0;
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

// No top-level await: the root package is CJS, so tsx compiles this as CJS
// (same convention as scripts/run-flow1.ts). Importing this module never
// exits; only direct execution runs the CLI.
const invokedAs = process.argv[1] ?? '';
if (invokedAs.endsWith('demo-reset.ts') || invokedAs.endsWith('demo-reset.js')) {
  void cli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
